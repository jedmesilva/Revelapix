import { sql } from "drizzle-orm";
import { bigint, boolean, check, pgTable, timestamp } from "drizzle-orm/pg-core";

export const prizeFundAccountsTable = pgTable(
  "revela_prize_fund_accounts",
  {
    isTest: boolean("is_test").primaryKey().notNull(),
    grossPurchasesCents: bigint("gross_purchases_cents", { mode: "number" }).notNull().default(0),
    contributionCents: bigint("contribution_cents", { mode: "number" }).notNull().default(0),
    awardedCents: bigint("awarded_cents", { mode: "number" }).notNull().default(0),
    pendingAwardsCents: bigint("pending_awards_cents", { mode: "number" }).notNull().default(0),
    initialized: boolean("initialized").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("revela_prize_fund_amounts_nonnegative", sql`
      ${table.grossPurchasesCents} >= 0
      and ${table.contributionCents} >= 0
      and ${table.awardedCents} >= 0
      and ${table.pendingAwardsCents} >= 0
    `),
    check(
      "revela_prize_fund_pending_within_awards",
      sql`${table.pendingAwardsCents} <= ${table.awardedCents}`,
    ),
  ],
);

export type PrizeFundAccount = typeof prizeFundAccountsTable.$inferSelect;
