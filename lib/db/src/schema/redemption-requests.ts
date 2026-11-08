import { sql } from "drizzle-orm";
import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cellsTable, redemptionStatusEnum } from "./cells";
import { usersTable } from "./users";

export const redemptionRequestsTable = pgTable(
  "revela_redemption_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    cellId: integer("cell_id").notNull().references(() => cellsTable.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    status: redemptionStatusEnum("status").notNull().default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("revela_redemption_requests_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("revela_redemption_active_cell_unique")
      .on(table.cellId)
      .where(sql`${table.status} in ('requested', 'under_review', 'approved', 'processing')`),
  ],
);

export type RedemptionRequest = typeof redemptionRequestsTable.$inferSelect;
