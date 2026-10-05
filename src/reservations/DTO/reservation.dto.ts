import z from "zod";

export const reservationItemSchema = z.object({
  productId: z.string().nonempty("Product ID is required"),
  quantity: z
  .number()
  .int('quantity must be an integer')
  .min(1, 'Quantity must be at least 1')
  .max(100, "Quantity cannot exceed 100"),
});

export const reservationSchema = z.object({
  items: z
    .array(reservationItemSchema)
    .min(1, 'At least one item is required')
    .max(10, 'Maximum 10 items per reservation'),
}).refine(
  (data)=> {
    const productIds = data.items.map(item=>item.productId)
    const uniqueIds = new Set(productIds)
    return productIds.length === uniqueIds.size
  }, {
    message: 'duplicate products in same reservation',
    path: ['items']
  });

export type ReservationDTO = z.infer<typeof reservationSchema>;