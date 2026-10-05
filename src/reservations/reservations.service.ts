import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB_PROVIDER, type DrizzleDB } from 'src/database/database.module';
import { idempotencyRecords, products, reservationHistory, reservationItems, reservations } from 'src/database/schemas';
import { normalizeItems } from './utils/helpers/normalizer';
import { ReservationDTO } from './DTO/reservation.dto';

@Injectable()
export class ReservationsService {
    constructor(@Inject(DB_PROVIDER) private readonly db: DrizzleDB) {}


  async createReservation(body: ReservationDTO, idempotencyKey: string, userId: string) {
    await this.db.transaction(async (tx) => {
        const existing = await tx.select().from(idempotencyRecords).where(
            eq(idempotencyRecords.idempotencyKey, idempotencyKey)
        );
        if (existing.length > 0) {
            if (normalizeItems(body) === existing[0].normalizedItems) {
                // should return successful response without creating a new reservation
                return existing[0].reservationId;
            }
            throw new Error('Duplicate request with the same idempotency key but different items');
        }

        const reserved = await tx.insert(reservations).values({
            userId: userId,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
        }).returning({ id: reservations.id });

        for (const item of body.items) {
            //for each item, check if there's enough inventory and update the reserved count
            const [product] = await tx.select({
                reserved: products.reserved,
                onHand: products.onHand,
            }).from(products).where(eq(products.id, item.productId));

            //does the product exist at all?
            if (!product) {
                throw new Error(`Product ${item.productId} not found`);
            }

            //does the product have enough inventory to reserve the requested quantity?
            if (product.reserved + item.quantity > product.onHand) {
                throw new Error(`Not enough inventory for product ${item.productId}`);
            }

            //it exists and has enough inventory, so update the reserved count
            await tx.update(products).set({
                reserved: sql`${products.reserved} + ${item.quantity}`,
            }).where(eq(products.id, item.productId));

            //create a reservation item record for this product
            await tx.insert(reservationItems).values({
                reservationId: reserved[0].id,
                productId: item.productId,
                quantity: item.quantity,
            });
        }

        await tx.insert(idempotencyRecords).values({
            userId: userId,
            idempotencyKey: idempotencyKey,
            normalizedItems: normalizeItems(body),
            reservationId: reserved[0].id,
        });

        return reserved[0];

    });
  }

  async getReservation(reservationId: string, userId: string) {
    const queryResult = await this.db.select().from(reservations).where(
        and(eq(reservations.id, reservationId),
        eq(reservations.userId, userId)
    )); 

    if (queryResult.length === 0) {
        throw new Error('Reservation not found or does not belong to the user');
    }

    return queryResult[0];
  }

  async confirmReservation(reservationId: string, userId: string) {
    await this.db.transaction(async (tx) => {
        const reservation = await tx.select().from(reservations).where(
            and(eq(reservations.id, reservationId),
            eq(reservations.userId, userId)
        ));

        if (reservation.length === 0) {
            throw new Error('Reservation not found or does not belong to the user');
        }

        if (reservation[0].expiresAt < new Date()) {
            throw new Error('Reservation has expired');
        }

        if (reservation[0].status !== 'HELD') {
            if (reservation[0].status === 'CONFIRMED') {
                return { message: 'Reservation already confirmed' };
            }
            throw new Error('Reservation is not in a confirmable state');
        }

        await tx.update(reservations).set({
            status: 'CONFIRMED',
        }).where(eq(reservations.id, reservationId));

        const reservedItems = await tx.select().from(reservationItems).where(
            eq(reservationItems.reservationId, reservationId)
        );

        for (const item of reservedItems) {
            await tx.update(products).set({
                reserved: sql`${products.reserved} - ${item.quantity}`,
                onHand: sql`${products.onHand} - ${item.quantity}`,
            }).where(eq(products.id, item.productId));
        }

        await tx.delete(idempotencyRecords).where(eq(idempotencyRecords.reservationId, reservationId));

        await tx.update(reservationHistory).set({
            oldStatus: reservation[0].status,
            newStatus: 'CONFIRMED',
            transitionedAt: new Date(),
            actor: userId,
        }).where(eq(reservationHistory.reservationId, reservationId));
    });

    return { message: 'Reservation confirmed' };
  }

  async cancelReservation(reservationId: string, userId: string) {
    await this.db.transaction(async (tx) => {
        const now = new Date();
        const reservation = await tx.select().from(reservations).where(
            and(eq(reservations.id, reservationId),
            eq(reservations.userId, userId)
        ));

        if (reservation.length === 0) {
            throw new Error('Reservation not found or does not belong to the user');
        }

        if (reservation[0].status !== 'HELD') {
            if (reservation[0].status === 'CANCELLED') {
                return { message: 'Reservation already cancelled' };
            }
            throw new Error('Reservation is not in a cancellable state');
        }

        await tx.update(reservations).set({
            status: 'CANCELLED',
            updatedAt: now,
        }).where(eq(reservations.id, reservationId));

        const reservedItems = await tx.select().from(reservationItems).where(
            eq(reservationItems.reservationId, reservationId)
        );

        for (const item of reservedItems) {
            await tx.update (products).set({
                reserved: sql`${products.reserved} - ${item.quantity}`,
            }).where(eq(products.id, item.productId));
        }

        await tx.delete(idempotencyRecords).where(eq(idempotencyRecords.reservationId, reservationId));

        await tx.insert(reservationHistory).values({
            reservationId: reservationId,
            userId: userId,
            oldStatus: reservation[0].status,
            newStatus: 'CANCELLED',
            actor: userId,
            transitionedAt: now,
        });
    });

    return { message: 'Reservation cancelled' };
  }
}
