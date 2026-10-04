import { integer, pgTable, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { reservations } from "./reservations";
import { products } from "./products";
import { randomUUID } from "node:crypto";

export const reservationItems = pgTable("reservation_items", {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
    uniqueProductPerReservation: unique().on(table.reservationId, table.productId),
}))