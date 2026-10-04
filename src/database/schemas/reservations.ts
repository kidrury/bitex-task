import { pgEnum, uuid } from "drizzle-orm/pg-core"
import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core"

export const reservationStatus = pgEnum("reservation_status", ["HELD", "CONFIRMED", "CANCELLED", "EXPIRED"]);
export const reservations = pgTable("reservations", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    status: reservationStatus("status").notNull().default("HELD"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    updatedAt: timestamp("updated_at"),
})