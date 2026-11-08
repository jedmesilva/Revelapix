import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "revela_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    googleSubject: text("google_subject"),
    chances: integer("chances").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("revela_users_email_unique").on(table.email),
    uniqueIndex("revela_users_google_subject_unique").on(table.googleSubject),
  ],
);

export type User = typeof usersTable.$inferSelect;
