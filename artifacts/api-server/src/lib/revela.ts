import { and, asc, desc, eq, lte } from "drizzle-orm";
import { cellsTable, chancePlansTable, db, ordersTable, type User, usersTable } from "@workspace/db";

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
  await db.insert(cellsTable).values(rows).onConflictDoNothing();
  boardInitialized = true;
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
  };
}

export async function getRevelaState(user: User | null) {
  await ensureBoard();
  const now = new Date();
  await expireReservations(now);

  const cells = await db.select().from(cellsTable).orderBy(cellsTable.id);
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
    cells: cells.map((cell) => {
      const isMine = Boolean(user && cell.ownerUserId === user.id);
      return {
        id: cell.id,
        phase: cell.phase,
        isMine,
        redeemed: isMine && cell.redeemed,
        redemptionStatus: isMine
          ? cell.redemptionStatus ?? (cell.redeemed ? "redeemed" : null)
          : null,
        prizeValueCents: cell.phase === "open" ? cell.prizeValueCents : null,
        prizeKind: cell.phase === "open" ? cell.prizeKind : null,
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
