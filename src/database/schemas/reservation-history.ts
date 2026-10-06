import { pgTable, uuid, timestamp, text } from "drizzle-orm/pg-core";
import { reservationStatus } from "./reservations";



export const reservationHistory = pgTable("reservation_history", {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull(),
    userId: uuid("user_id").notNull(),
    oldStatus: reservationStatus("old_status"),
    newStatus: reservationStatus("new_status").notNull(),
    actor: text("actor").notNull(),
    transitionedAt: timestamp("transitioned_at").notNull().defaultNow(),
})