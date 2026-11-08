import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { redemptionRequestsTable } from "./redemption-requests";
import { usersTable } from "./users";

export const redemptionRequestEventsTable = pgTable(
  "revela_redemption_request_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().references(() => redemptionRequestsTable.id, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("revela_redemption_request_events_request_idx").on(table.requestId, table.createdAt)],
);

export type RedemptionRequestEvent = typeof redemptionRequestEventsTable.$inferSelect;
