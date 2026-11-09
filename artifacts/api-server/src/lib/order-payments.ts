import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  cashLedgerLockQuery,
  cashTransactionsTable,
  cellsTable,
  db,
  ordersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  cancelEfiPixCharge,
  EfiApiError,
  getEfiEnvironment,
  getEfiPixCharge,
  isEfiConfigured,
  type EfiCharge,
} from "./efi-pix";
import { drawPrizeForCell, getPrizeFundAccount, recordPackagePurchaseContribution } from "./prize-fund";

const EXPIRED_CHARGE_STATUSES = new Set([
  "REMOVIDA_PELO_PSP",
  "REMOVIDA_PELO_USUARIO_RECEBEDOR",
]);

function isVerifiedPaidCharge(charge: EfiCharge, txid: string, amountCents: number): boolean {
  return charge.txid === txid
    && charge.status === "CONCLUIDA"
    && charge.amountCents === amountCents
    && charge.payments.some(
      (payment) => payment.txid === txid && payment.amountCents === amountCents,
    );
}

function isMissingEfiChargeError(error: unknown): boolean {
  return error instanceof EfiApiError
    && (error.statusCode === 404 || error.code === "cobranca_nao_encontrada");
}

async function expireEfiOrder(orderId: string, force = false): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(ordersTable)
      .where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.status, "pending"),
        isNotNull(ordersTable.providerTxid),
      ))
      .for("update");
    if (!order || (!force && order.expiresAt > now)) return;

    await tx.update(ordersTable)
      .set({ status: "expired" })
      .where(eq(ordersTable.id, order.id));
    if (order.cellId !== null) {
      await tx.update(cellsTable).set({
        phase: "closed",
        reservedByUserId: null,
        reservedUntil: null,
      }).where(and(
        eq(cellsTable.id, order.cellId),
        eq(cellsTable.phase, "reserved"),
        eq(cellsTable.reservedByUserId, order.userId),
      ));
    }
  });
}

async function cancelActiveEfiCharge(
  orderId: string,
  txid: string,
  amountCents: number,
): Promise<void> {
  try {
    await cancelEfiPixCharge(txid);
  } catch (error) {
    // Efí may reject a duplicate cancellation or a charge paid just before this request.
    if (!(error instanceof EfiApiError)) throw error;
  }

  let finalCharge: EfiCharge;
  try {
    finalCharge = await getEfiPixCharge(txid);
  } catch (error) {
    if (isMissingEfiChargeError(error)) {
      await expireEfiOrder(orderId, true);
      return;
    }
    throw error;
  }

  if (finalCharge.txid !== txid || finalCharge.amountCents !== amountCents) {
    throw new Error("Efí charge changed while it was being closed.");
  }
  if (finalCharge.status === "CONCLUIDA") {
    if (!isVerifiedPaidCharge(finalCharge, txid, amountCents)) {
      throw new Error("Efí marked the charge complete without a matching Pix receipt.");
    }
    await recordVerifiedEfiPayment(orderId, finalCharge);
  } else if (EXPIRED_CHARGE_STATUSES.has(finalCharge.status)) {
    await expireEfiOrder(orderId, true);
  } else {
    throw new EfiApiError("Efí did not confirm the Pix cancellation.");
  }
}

async function recordVerifiedEfiPayment(orderId: string, charge: EfiCharge): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);
    await getPrizeFundAccount(tx, true);

    const [order] = await tx.select().from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update");
    if (!order || order.status !== "pending" || !order.providerTxid) return;
    if (!isVerifiedPaidCharge(charge, order.providerTxid, order.amountCents)) {
      throw new Error("Efí payment status did not match the order.");
    }

    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, order.userId))
      .for("update");
    if (!user) throw new Error("The order owner no longer exists.");

    const [cell] = order.cellId !== null
      ? await tx.select().from(cellsTable).where(eq(cellsTable.id, order.cellId)).for("update")
      : [];
    if (
      order.cellId !== null
      && (!cell || cell.phase !== "reserved" || cell.reservedByUserId !== order.userId)
    ) {
      throw new Error("The paid order no longer owns its reserved cell.");
    }

    const paidAt = charge.payments.find(
      (payment) => payment.txid === order.providerTxid && payment.amountCents === order.amountCents,
    )?.paidAt ?? new Date();
    const isTest = getEfiEnvironment() === "homologation";
    const addedChances = order.packCount - (order.cellId !== null ? 1 : 0);

    await tx.update(ordersTable)
      .set({ status: "paid", paidAt })
      .where(eq(ordersTable.id, order.id));
    await tx.insert(cashTransactionsTable).values({
      type: "package_purchase",
      amountCents: order.amountCents,
      orderId: order.id,
      isTest,
      createdByUserId: order.userId,
      createdAt: paidAt,
    });
    await recordPackagePurchaseContribution(tx, order.amountCents, isTest);
    await tx.update(usersTable)
      .set({ chances: user.chances + addedChances })
      .where(eq(usersTable.id, order.userId));

    if (cell && order.cellId !== null) {
      const draw = await drawPrizeForCell(tx, cell.id, order.userId, isTest);
      if (!draw) throw new Error("No eligible prize items are available.");
    }
  });
}

export async function cancelPendingEfiOrder(orderId: string): Promise<void> {
  const [order] = await db.select().from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order || order.status !== "pending") return;
  if (!order.providerTxid || !order.pixPayload.trim()) {
    throw new EfiApiError("The Pix charge is not ready to cancel.");
  }

  let charge: EfiCharge;
  try {
    charge = await getEfiPixCharge(order.providerTxid);
  } catch (error) {
    if (isMissingEfiChargeError(error)) {
      await expireEfiOrder(order.id, true);
      return;
    }
    throw error;
  }

  if (charge.txid !== order.providerTxid || charge.amountCents !== order.amountCents) {
    throw new Error("Efí charge does not match the stored order.");
  }
  if (charge.status === "CONCLUIDA") {
    if (!isVerifiedPaidCharge(charge, order.providerTxid, order.amountCents)) {
      throw new Error("Efí marked the charge complete without a matching Pix receipt.");
    }
    await recordVerifiedEfiPayment(order.id, charge);
    return;
  }
  if (EXPIRED_CHARGE_STATUSES.has(charge.status)) {
    await expireEfiOrder(order.id, true);
    return;
  }
  if (charge.status !== "ATIVA") {
    throw new EfiApiError("Efí did not confirm that the Pix can be cancelled.");
  }

  await cancelActiveEfiCharge(order.id, order.providerTxid, order.amountCents);
}

export async function reconcileEfiOrder(orderId: string): Promise<void> {
  const [order] = await db.select().from(ordersTable)
    .where(and(
      eq(ordersTable.id, orderId),
      eq(ordersTable.status, "pending"),
      isNotNull(ordersTable.providerTxid),
    ))
    .limit(1);
  if (!order?.providerTxid) return;

  let charge: EfiCharge;
  try {
    charge = await getEfiPixCharge(order.providerTxid);
  } catch (error) {
    if (isMissingEfiChargeError(error) && order.expiresAt <= new Date()) {
      await expireEfiOrder(order.id);
      return;
    }
    throw error;
  }

  if (charge.txid !== order.providerTxid || charge.amountCents !== order.amountCents) {
    throw new Error("Efí charge does not match the stored order.");
  }

  if (charge.status === "CONCLUIDA") {
    if (!isVerifiedPaidCharge(charge, order.providerTxid, order.amountCents)) {
      throw new Error("Efí marked the charge complete without a matching Pix receipt.");
    }
    await recordVerifiedEfiPayment(order.id, charge);
    return;
  }

  if (charge.pixCopyPaste && charge.pixCopyPaste !== order.pixPayload) {
    await db.update(ordersTable)
      .set({ pixPayload: charge.pixCopyPaste })
      .where(and(
        eq(ordersTable.id, order.id),
        eq(ordersTable.status, "pending"),
        eq(ordersTable.providerTxid, order.providerTxid),
      ));
  }

  if (EXPIRED_CHARGE_STATUSES.has(charge.status)) {
    await expireEfiOrder(order.id, true);
    return;
  }

  if (order.expiresAt > new Date() || charge.status !== "ATIVA") return;

  await cancelActiveEfiCharge(order.id, order.providerTxid, order.amountCents);
}

export function startEfiOrderReconciliation(): void {
  let running = false;

  const reconcilePendingOrders = async () => {
    if (running || !isEfiConfigured()) return;
    running = true;
    try {
      const pendingOrders = await db.select({ id: ordersTable.id })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.status, "pending"),
          isNotNull(ordersTable.providerTxid),
        ))
        .orderBy(asc(ordersTable.createdAt))
        .limit(20);

      for (const order of pendingOrders) {
        try {
          await reconcileEfiOrder(order.id);
        } catch (error) {
          logger.warn({ err: error, orderId: order.id }, "Could not reconcile Efí Pix order");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Efí Pix reconciliation failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void reconcilePendingOrders();
  }, 15_000);
  timer.unref();
  void reconcilePendingOrders();
}
