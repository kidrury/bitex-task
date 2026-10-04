import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core"

export const reservations = pgTable("reservations", {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at"),
})