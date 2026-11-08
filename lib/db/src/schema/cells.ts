import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { itemsTable } from "./items";
import { usersTable } from "./users";

export const cellPhaseEnum = pgEnum("revela_cell_phase", ["closed", "reserved", "open"]);
export const prizeKindEnum = pgEnum("revela_prize_kind", ["image", "stat", "icon"]);
export const redemptionStatusEnum = pgEnum("revela_redemption_status", [
  "requested",
  "rejected",
  "cancelled",
  "under_review",
  "redeemed",
  "approved",
  "processing",
]);

export const cellsTable = pgTable(
  "revela_cells",
  {
    id: integer("id").primaryKey(),
    phase: cellPhaseEnum("phase").notNull().default("closed"),
    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    redeemed: boolean("redeemed").notNull().default(false),
    redemptionStatus: text("redemption_status"),
    // Legacy fields are retained until production data has been backfilled safely.
    prizeValueCents: integer("prize_value_cents").notNull(),
    prizeKind: prizeKindEnum("prize_kind").notNull(),
    itemId: integer("item_id").references(() => itemsTable.id, { onDelete: "restrict" }),
    reservedByUserId: uuid("reserved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  },
  (table) => [index("revela_cells_item_id_idx").on(table.itemId)],
).enableRLS();

export type Cell = typeof cellsTable.$inferSelect;
