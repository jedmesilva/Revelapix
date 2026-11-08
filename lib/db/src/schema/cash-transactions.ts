import { sql } from "drizzle-orm";
import {
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
import { ordersTable } from "./orders";
import { redemptionRequestsTable } from "./redemption-requests";
import { usersTable } from "./users";

export const cashTransactionTypeEnum = pgEnum("revela_cash_transaction_type", [
  "package_purchase",
  "redemption_payout",
]);

export const cashTransactionsTable = pgTable(
  "revela_cash_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: cashTransactionTypeEnum("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "restrict" }),
    redemptionRequestId: uuid("redemption_request_id").references(() => redemptionRequestsTable.id, { onDelete: "restrict" }),
    isTest: boolean("is_test").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("revela_cash_transactions_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "revela_cash_transactions_source_matches_type",
      sql`(${table.type} = 'package_purchase' and ${table.orderId} is not null and ${table.redemptionRequestId} is null)
        or (${table.type} = 'redemption_payout' and ${table.redemptionRequestId} is not null and ${table.orderId} is null)`,
    ),
    uniqueIndex("revela_cash_transactions_order_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    uniqueIndex("revela_cash_transactions_redemption_unique")
      .on(table.redemptionRequestId)
      .where(sql`${table.redemptionRequestId} is not null`),
    index("revela_cash_transactions_created_idx").on(table.createdAt),
  ],
);

export type CashTransaction = typeof cashTransactionsTable.$inferSelect;
