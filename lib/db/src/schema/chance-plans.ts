import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const chancePlansTable = pgTable(
  "revela_chance_plans",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    chances: integer("chances").notNull(),
    priceCents: integer("price_cents").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    check("revela_chance_plans_chances_positive", sql`${table.chances} > 0`),
    check("revela_chance_plans_price_positive", sql`${table.priceCents} > 0`),
  ],
);

export type ChancePlan = typeof chancePlansTable.$inferSelect;
