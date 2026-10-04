import z from "zod";

export const reservationItemSchema = z.object({
  productId: z.string().nonempty("Product ID is required"),
  quantity: z.number().int().positive("Quantity must be a positive integer").max(100, "Quantity cannot exceed 100"),
});

export const reservationSchema = z.object({
  items: z.array(reservationItemSchema).nonempty("At least one item is required"),
});

export type ReservationDTO = z.infer<typeof reservationSchema>;