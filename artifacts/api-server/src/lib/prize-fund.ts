import { randomInt } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  cashTransactionsTable,
  cellsTable,
  db,
  itemsTable,
  prizeAwardsTable,
  prizeFundAccountsTable,
} from "@workspace/db";

const FUND_CONTRIBUTION_BPS = 3_000;
const MAX_SINGLE_AWARD_BPS = 3_000;
const BASIS_POINTS = 10_000;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function percentageOfCents(amountCents: number, basisPoints: number): number {
  return Number((BigInt(amountCents) * BigInt(basisPoints)) / BigInt(BASIS_POINTS));
}

export function prizeFundUsesTestMoney(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function getPrizeFundAccount(
  tx: Transaction,
  isTest: boolean,
) {
  await tx.insert(prizeFundAccountsTable).values({ isTest }).onConflictDoNothing();
  const [existingAccount] = await tx.select().from(prizeFundAccountsTable)
    .where(eq(prizeFundAccountsTable.isTest, isTest))
    .for("update");
  if (!existingAccount) {
    throw new Error("Could not initialize the prize fund account.");
  }
  if (existingAccount.initialized) return existingAccount;

  const [purchaseTotals] = await tx.select({
    grossCents: sql<string>`coalesce(sum(${cashTransactionsTable.amountCents}), 0)::text`,
  }).from(cashTransactionsTable)
    .where(and(
      eq(cashTransactionsTable.type, "package_purchase"),
      eq(cashTransactionsTable.isTest, isTest),
    ));
  const grossPurchasesCents = Number(purchaseTotals?.grossCents ?? 0);

  const legacyAwards = await tx.select({
    cellId: cellsTable.id,
    userId: cellsTable.ownerUserId,
    itemId: cellsTable.itemId,
    amountCents: cellsTable.prizeValueCents,
    redeemed: cellsTable.redeemed,
  }).from(cellsTable)
    .innerJoin(itemsTable, eq(itemsTable.id, cellsTable.itemId))
    .where(and(
      eq(cellsTable.phase, "open"),
      eq(itemsTable.type, "pix"),
      isNotNull(cellsTable.ownerUserId),
    ));

  if (legacyAwards.length > 0) {
    await tx.insert(prizeAwardsTable).values(legacyAwards.map((award) => ({
      cellId: award.cellId,
      userId: award.userId!,
      itemId: award.itemId!,
      amountCents: award.amountCents,
      isTest,
      status: award.redeemed ? "paid" as const : "awarded" as const,
      prizeFundAvailableCentsAtAward: 0,
      maxPixAwardCentsAtAward: 0,
      paidAt: award.redeemed ? new Date() : null,
    }))).onConflictDoNothing();
  }

  const [awardTotals] = await tx.select({
    awardedCents: sql<string>`coalesce(sum(${prizeAwardsTable.amountCents}), 0)::text`,
    pendingAwardsCents: sql<string>`coalesce(sum(case
      when ${prizeAwardsTable.status} = 'awarded' then ${prizeAwardsTable.amountCents}
      else 0 end), 0)::text`,
  }).from(prizeAwardsTable)
    .where(eq(prizeAwardsTable.isTest, isTest));

  const [initializedAccount] = await tx.update(prizeFundAccountsTable)
    .set({
      grossPurchasesCents,
      contributionCents: percentageOfCents(grossPurchasesCents, FUND_CONTRIBUTION_BPS),
      awardedCents: Number(awardTotals?.awardedCents ?? 0),
      pendingAwardsCents: Number(awardTotals?.pendingAwardsCents ?? 0),
      initialized: true,
      updatedAt: new Date(),
    })
    .where(eq(prizeFundAccountsTable.isTest, isTest))
    .returning();

  if (!initializedAccount) {
    throw new Error("Could not initialize the prize fund account.");
  }
  return initializedAccount;
}

export async function recordPackagePurchaseContribution(
  tx: Transaction,
  amountCents: number,
  isTest: boolean,
): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Package purchase contribution requires a positive amount.");
  }

  const account = await getPrizeFundAccount(tx, isTest);
  const grossPurchasesCents = account.grossPurchasesCents + amountCents;
  const contributionCents = percentageOfCents(grossPurchasesCents, FUND_CONTRIBUTION_BPS);
  const [updatedAccount] = await tx.update(prizeFundAccountsTable)
    .set({
      grossPurchasesCents,
      contributionCents,
      updatedAt: new Date(),
    })
    .where(eq(prizeFundAccountsTable.isTest, isTest))
    .returning();
  if (!updatedAccount) {
    throw new Error("Could not add the package purchase to the prize fund.");
  }
}

export async function getPrizeFundSnapshot(
  tx: Transaction,
  isTest: boolean,
) {
  const account = await getPrizeFundAccount(tx, isTest);
  const [cashTotals] = await tx.select({
    outgoingCents: sql<string>`coalesce(sum(${cashTransactionsTable.amountCents}), 0)::text`,
  }).from(cashTransactionsTable)
    .where(and(
      eq(cashTransactionsTable.type, "redemption_payout"),
      eq(cashTransactionsTable.isTest, isTest),
    ));

  const cashBalanceCents = account.grossPurchasesCents - Number(cashTotals?.outgoingCents ?? 0);
  const prizeFundAvailableCents = account.contributionCents - account.awardedCents;
  const cashAvailableCents = cashBalanceCents - account.pendingAwardsCents;
  const availableForAwardsCents = Math.max(
    0,
    Math.min(prizeFundAvailableCents, cashAvailableCents),
  );

  return {
    account,
    cashBalanceCents,
    cashAvailableCents,
    prizeFundAvailableCents,
    pendingAwardsCents: account.pendingAwardsCents,
    availableForAwardsCents,
    maxPixAwardCents: percentageOfCents(availableForAwardsCents, MAX_SINGLE_AWARD_BPS),
  };
}

export async function drawPrizeForCell(
  tx: Transaction,
  cellId: number,
  userId: string,
  isTest: boolean,
) {
  const snapshot = await getPrizeFundSnapshot(tx, isTest);
  const activeItems = await tx.select().from(itemsTable)
    .where(eq(itemsTable.isActive, true));
  const eligibleItems = activeItems.filter((item) =>
    item.type === "image"
    || (item.valueCents !== null && item.valueCents <= snapshot.maxPixAwardCents)
  );
  if (eligibleItems.length === 0) return null;

  // Each active catalog entry is one equally weighted draw entry.
  const item = eligibleItems[randomInt(eligibleItems.length)];
  if (!item) return null;

  if (item.type === "pix") {
    const amountCents = item.valueCents;
    if (amountCents === null || amountCents <= 0 || amountCents > snapshot.maxPixAwardCents) {
      throw new Error("Selected Pix prize is not eligible for the current fund.");
    }

    await tx.insert(prizeAwardsTable).values({
      cellId,
      userId,
      itemId: item.id,
      amountCents,
      isTest,
      status: "awarded",
      prizeFundAvailableCentsAtAward: Math.max(0, snapshot.prizeFundAvailableCents),
      maxPixAwardCentsAtAward: snapshot.maxPixAwardCents,
    });
    const [updatedAccount] = await tx.update(prizeFundAccountsTable)
      .set({
        awardedCents: sql`${prizeFundAccountsTable.awardedCents} + ${amountCents}`,
        pendingAwardsCents: sql`${prizeFundAccountsTable.pendingAwardsCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(prizeFundAccountsTable.isTest, isTest))
      .returning();
    if (!updatedAccount) {
      throw new Error("Could not reserve the Pix prize in the fund.");
    }
  }

  const [updatedCell] = await tx.update(cellsTable)
    .set({
      phase: "open",
      ownerUserId: userId,
      redeemed: false,
      redemptionStatus: null,
      prizeValueCents: item.type === "pix" ? item.valueCents! : 0,
      prizeKind: item.type === "pix" ? "stat" : "image",
      itemId: item.id,
      reservedByUserId: null,
      reservedUntil: null,
    })
    .where(eq(cellsTable.id, cellId))
    .returning();
  if (!updatedCell) {
    throw new Error("Could not reveal the selected prize.");
  }

  return { cell: updatedCell, item };
}

export async function markPrizeAwardPaid(
  tx: Transaction,
  cellId: number,
) {
  const [award] = await tx.select().from(prizeAwardsTable)
    .where(eq(prizeAwardsTable.cellId, cellId))
    .for("update");
  if (!award) {
    throw new Error("The revealed Pix prize has no fund reservation.");
  }
  if (award.status === "paid") {
    throw new Error("The Pix prize has already been paid.");
  }

  const account = await getPrizeFundAccount(tx, award.isTest);
  if (account.pendingAwardsCents < award.amountCents) {
    throw new Error("The prize fund reservation is inconsistent.");
  }

  const [updatedAward] = await tx.update(prizeAwardsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(prizeAwardsTable.id, award.id))
    .returning();
  await tx.update(prizeFundAccountsTable)
    .set({
      pendingAwardsCents: account.pendingAwardsCents - award.amountCents,
      updatedAt: new Date(),
    })
    .where(eq(prizeFundAccountsTable.isTest, award.isTest));

  return updatedAward;
}
