import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cellsTable } from "./cells";
import { itemsTable } from "./items";
import { usersTable } from "./users";

export const prizeAwardStatusEnum = pgEnum("revela_prize_award_status", ["awarded", "paid"]);

export const prizeAwardsTable = pgTable(
  "revela_prize_awards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cellId: integer("cell_id").notNull().references(() => cellsTable.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    itemId: integer("item_id").notNull().references(() => itemsTable.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    isTest: boolean("is_test").notNull(),
    status: prizeAwardStatusEnum("status").notNull().default("awarded"),
    prizeFundAvailableCentsAtAward: bigint("prize_fund_available_cents_at_award", { mode: "number" }).notNull(),
    maxPixAwardCentsAtAward: bigint("max_pix_award_cents_at_award", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    check("revela_prize_awards_amount_positive", sql`${table.amountCents} > 0`),
    check("revela_prize_awards_snapshot_nonnegative", sql`
      ${table.prizeFundAvailableCentsAtAward} >= 0
      and ${table.maxPixAwardCentsAtAward} >= 0
    `),
    uniqueIndex("revela_prize_awards_cell_unique").on(table.cellId),
    index("revela_prize_awards_test_status_idx").on(table.isTest, table.status),
  ],
).enableRLS();

export type PrizeAward = typeof prizeAwardsTable.$inferSelect;
