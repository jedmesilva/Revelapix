import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

export const SESSION_COOKIE = "revela_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, saltHex, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex || expectedHex.length !== 128) {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export async function getSessionUser(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 32) return null;
  const now = new Date();
  const [record] = await db
    .select({ user: usersTable, tokenHash: sessionsTable.tokenHash })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(eq(sessionsTable.tokenHash, hashToken(token)), gt(sessionsTable.expiresAt, now)))
    .limit(1);
  return record?.user ?? null;
}

export async function createSession(userId: string, res: Response): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") {
    await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(token)));
  }
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}
