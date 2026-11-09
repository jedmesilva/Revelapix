import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import {
  cellsTable,
  chancePlansTable,
  db,
  itemsTable,
  ordersTable,
  type Cell,
  type Item,
  type User,
  usersTable,
} from "@workspace/db";

export const CELL_COUNT = 1_000_000;
export const RESERVATION_MS = 120_000;

const LEGACY_CELL_COUNT = 84;
let boardInitialized = false;

export class BoardNotReadyError extends Error {
  constructor() {
    super("The cell board has not been fully seeded.");
    this.name = "BoardNotReadyError";
  }
}

export async function ensureLegacyCatalog(): Promise<void> {
  if (boardInitialized) return;
  await db.transaction(async (tx) => {
    // Migrate existing demo prizes into the item catalog without changing cell ownership or status.
    const cellsWithoutItems = await tx
      .select()
      .from(cellsTable)
      .where(and(
        isNull(cellsTable.itemId),
        lte(cellsTable.id, LEGACY_CELL_COUNT - 1),
      ))
      .for("update");
    if (cellsWithoutItems.length === 0) return;

    const catalogRows = cellsWithoutItems.map((cell) => {
      const isPix = cell.prizeKind === "stat";
      return {
        code: `legacy-cell-${cell.id}`,
        name: isPix ? `Prêmio Pix da célula ${cell.id + 1}` : `Imagem da célula ${cell.id + 1}`,
        type: isPix ? "pix" as const : "image" as const,
        valueCents: isPix ? cell.prizeValueCents : null,
        imagePath: null,
      };
    });
    await tx.insert(itemsTable).values(catalogRows).onConflictDoNothing();

    const codes = catalogRows.map((item) => item.code);
    const savedItems = await tx
      .select({ id: itemsTable.id, code: itemsTable.code })
      .from(itemsTable)
      .where(inArray(itemsTable.code, codes));
    const itemIdByCode = new Map(savedItems.map((item) => [item.code, item.id]));

    for (const cell of cellsWithoutItems) {
      const itemId = itemIdByCode.get(`legacy-cell-${cell.id}`);
      if (itemId === undefined) {
        throw new Error(`Could not create the catalog item for cell ${cell.id}.`);
      }
      await tx
        .update(cellsTable)
        .set({ itemId })
        .where(and(eq(cellsTable.id, cell.id), isNull(cellsTable.itemId)));
    }
  });
  boardInitialized = true;
}

function getPublicImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const segments = imagePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
    throw new Error("Catalog image paths must be relative paths without traversal segments.");
  }
  return `/api/storage/public-objects/${segments.map(encodeURIComponent).join("/")}`;
}

export async function expireReservations(now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(ordersTable)
      .set({ status: "expired" })
      .where(and(
        eq(ordersTable.status, "pending"),
        lte(ordersTable.expiresAt, now),
        isNull(ordersTable.providerTxid),
      ));
    await tx
      .update(cellsTable)
      .set({
        phase: "closed",
        reservedByUserId: null,
        reservedUntil: null,
      })
      .where(and(eq(cellsTable.phase, "reserved"), lte(cellsTable.reservedUntil, now)));
  });
}

export function toUserSummary(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    chances: user.chances,
    hasPassword: user.passwordHash !== null,
  };
}

function toCellState(cell: Cell, item: Item | null, user: User | null) {
  if (cell.phase === "open" && (!cell.itemId || !item)) {
    throw new Error(`Revealed cell ${cell.id} is missing its catalog item.`);
  }
  const isMine = Boolean(user && cell.ownerUserId === user.id);
  return {
    id: cell.id,
    phase: cell.phase,
    isMine,
    redeemed: isMine && cell.redeemed,
    redemptionStatus: isMine
      ? cell.redemptionStatus ?? (cell.redeemed ? "redeemed" : null)
      : null,
    item: cell.phase === "open" && item
      ? {
          id: item.id,
          type: item.type,
          name: item.name,
          valueCents: item.type === "pix" ? item.valueCents : null,
          imageUrl: item.type === "image" ? getPublicImageUrl(item.imagePath) : null,
        }
      : null,
    reservedUntil: cell.phase === "reserved" && cell.reservedUntil
      ? cell.reservedUntil.toISOString()
      : null,
  };
}

export async function getCellWindow(
  user: User | null,
  view: "all" | "mine",
  start: number,
  limit: number,
) {
  await ensureLegacyCatalog();

  if (view === "all") {
    const safeStart = Math.min(start, CELL_COUNT);
    const safeLimit = Math.min(limit, CELL_COUNT - safeStart);
    const rows = await db
      .select({ cell: cellsTable, item: itemsTable })
      .from(cellsTable)
      .leftJoin(itemsTable, eq(cellsTable.itemId, itemsTable.id))
      .where(and(
        gte(cellsTable.id, safeStart),
        lt(cellsTable.id, safeStart + safeLimit),
      ))
      .orderBy(asc(cellsTable.id));

    if (rows.length !== safeLimit) {
      throw new BoardNotReadyError();
    }
    return {
      start: safeStart,
      total: CELL_COUNT,
      cells: rows.map(({ cell, item }) => toCellState(cell, item, user)),
    };
  }

  if (!user) {
    throw new Error("The personal cell view requires a session.");
  }
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(cellsTable)
    .where(eq(cellsTable.ownerUserId, user.id));
  const total = countRow?.total ?? 0;
  const rows = await db
    .select({ cell: cellsTable, item: itemsTable })
    .from(cellsTable)
    .leftJoin(itemsTable, eq(cellsTable.itemId, itemsTable.id))
    .where(eq(cellsTable.ownerUserId, user.id))
    .orderBy(asc(cellsTable.id))
    .limit(limit)
    .offset(start);
  return {
    start,
    total,
    cells: rows.map(({ cell, item }) => toCellState(cell, item, user)),
  };
}

export async function getRevelaState(user: User | null) {
  await ensureLegacyCatalog();
  const now = new Date();
  await expireReservations(now);

  const [mineCount] = user
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(cellsTable)
        .where(eq(cellsTable.ownerUserId, user.id))
    : [{ count: 0 }];
  const plans = await db
    .select()
    .from(chancePlansTable)
    .where(eq(chancePlansTable.isActive, true))
    .orderBy(asc(chancePlansTable.chances));
  const latestOrder = user
    ? await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.userId, user.id))
        .orderBy(desc(ordersTable.createdAt))
        .limit(1)
    : [];
  const order = latestOrder[0];

  return {
    user: user ? toUserSummary(user) : null,
    cellCount: CELL_COUNT,
    myCellCount: mineCount?.count ?? 0,
    packs: plans.map((plan) => ({
      id: plan.id,
      n: plan.chances,
      priceCents: plan.priceCents,
    })),
    order: order
      ? {
          id: order.id,
          pack: { n: order.packCount, priceCents: order.amountCents },
          cellId: order.cellId,
          status: order.status,
          payload: order.pixPayload,
          createdAt: order.createdAt.toISOString(),
          expiresAt: order.expiresAt.toISOString(),
        }
      : null,
    serverTime: now.toISOString(),
    testPaymentsEnabled: process.env.NODE_ENV !== "production",
  };
}

