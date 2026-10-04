import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { reservations } from "./reservations";



export const idempotencyRecords = pgTable("idempotency_records", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    normalizedItems: text("normalized_items").notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
}, (table) => ({
    uniqueUserIdempotencyKey: unique().on(table.userId, table.idempotencyKey),
}))