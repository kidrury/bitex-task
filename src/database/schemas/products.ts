import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    onHand: integer("on_hand").notNull(),
    reserved: integer("reserved").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
})