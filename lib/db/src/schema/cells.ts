import { boolean, integer, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const cellPhaseEnum = pgEnum("revela_cell_phase", ["closed", "reserved", "open"]);
export const prizeKindEnum = pgEnum("revela_prize_kind", ["image", "stat", "icon"]);

export const cellsTable = pgTable("revela_cells", {
  id: integer("id").primaryKey(),
  phase: cellPhaseEnum("phase").notNull().default("closed"),
  ownerUserId: uuid("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  redeemed: boolean("redeemed").notNull().default(false),
  prizeValueCents: integer("prize_value_cents").notNull(),
  prizeKind: prizeKindEnum("prize_kind").notNull(),
  reservedByUserId: uuid("reserved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
});

export type Cell = typeof cellsTable.$inferSelect;
