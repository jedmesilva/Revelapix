import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  cellsTable,
  chancePlansTable,
  db,
  itemsTable,
  ordersTable,
  type User,
  usersTable,
} from "@workspace/db";

export const CELL_COUNT = 84;
export const RESERVATION_MS = 120_000;

const prizeKinds = ["image", "stat", "icon", "stat", "image", "stat", "image"] as const;
let boardInitialized = false;

export function prizeValueCents(id: number): number {
  return 590 + ((id * 37) % 95) * 100;
}

export function prizeKind(id: number): (typeof prizeKinds)[number] {
  return prizeKinds[id % prizeKinds.length];
}

export async function ensureBoard(): Promise<void> {
  if (boardInitialized) return;
  const rows = Array.from({ length: CELL_COUNT }, (_, id) => ({
    id,
    prizeValueCents: prizeValueCents(id),
    prizeKind: prizeKind(id),
  }));

  await db.transaction(async (tx) => {
    await tx.insert(cellsTable).values(rows).onConflictDoNothing();

    // Migrate existing demo prizes into the item catalog without changing cell ownership or status.
    const cellsWithoutItems = await tx
      .select()
      .from(cellsTable)
      .where(isNull(cellsTable.itemId))
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
      .where(and(eq(ordersTable.status, "pending"), lte(ordersTable.expiresAt, now)));
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
    isAdmin: user.isAdmin,
  };
}

export async function getRevelaState(user: User | null) {
  await ensureBoard();
  const now = new Date();
  await expireReservations(now);

  const cells = await db
    .select({ cell: cellsTable, item: itemsTable })
    .from(cellsTable)
    .leftJoin(itemsTable, eq(cellsTable.itemId, itemsTable.id))
    .orderBy(cellsTable.id);
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
    cells: cells.map(({ cell, item }) => {
      if (cell.itemId === null || item === null) {
        throw new Error(`Cell ${cell.id} is missing its catalog item.`);
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
    }),
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

const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

function crc16(value: string): string {
  let crc = 0xffff;
  for (let i = 0; i < value.length; i += 1) {
    crc ^= value.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function makeDemonstrationPixPayload(packCount: number, priceCents: number): string {
  const transactionId = `TEST${packCount}${Date.now().toString(36)}`.toUpperCase().slice(0, 25);
  const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", "teste@exemplo.com");
  const additionalData = tlv("05", transactionId);
  const payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", (priceCents / 100).toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", "LANCE TESTE") +
    tlv("60", "SAO PAULO") +
    tlv("62", additionalData) +
    "6304";
  return payload + crc16(payload);
}
