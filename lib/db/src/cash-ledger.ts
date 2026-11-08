import { sql } from "drizzle-orm";

// Serializes transactions that read or change the real cash balance or active reservations.
export const cashLedgerLockQuery = sql`SELECT pg_advisory_xact_lock(1381327698, 1)`;
