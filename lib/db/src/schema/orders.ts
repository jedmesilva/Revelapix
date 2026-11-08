import { integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { cellsTable } from "./cells";
import { chancePlansTable } from "./chance-plans";
import { usersTable } from "./users";

export const orderStatusEnum = pgEnum("revela_order_status", ["pending", "paid", "expired"]);

export const ordersTable = pgTable("revela_orders", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  packId: varchar("pack_id", { length: 64 }).references(() => chancePlansTable.id, { onDelete: "set null" }),
  packCount: integer("pack_count").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  cellId: integer("cell_id").references(() => cellsTable.id, { onDelete: "set null" }),
  pixPayload: text("pix_payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}).enableRLS();
