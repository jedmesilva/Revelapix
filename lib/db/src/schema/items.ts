import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const itemTypeEnum = pgEnum("revela_item_type", ["pix", "image"]);

export const itemsTable = pgTable(
  "revela_items",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 100 }).notNull(),
    name: text("name").notNull(),
    type: itemTypeEnum("type").notNull(),
    valueCents: integer("value_cents"),
    // Relative path inside PUBLIC_OBJECT_SEARCH_PATHS, for example "items/prize.webp".
    imagePath: text("image_path"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("revela_items_code_unique").on(table.code),
    check(
      "revela_items_content_matches_type",
      sql`(
        (${table.type} = 'pix' AND ${table.valueCents} IS NOT NULL AND ${table.valueCents} > 0 AND ${table.imagePath} IS NULL)
        OR
        (${table.type} = 'image' AND ${table.valueCents} IS NULL)
      )`,
    ),
  ],
);

export type Item = typeof itemsTable.$inferSelect;
