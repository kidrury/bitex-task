import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { reservationItems } from "./reservation-items";



export const idempotencyRecords = pgTable("idempotency_records", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    normalizedItems: text("normalized_items").notNull(),
    reservationItem: text("reservation_items").notNull().references(() => reservationItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
    uniqueUserIdempotencyKey: unique().on(table.userId, table.idempotencyKey),
}))