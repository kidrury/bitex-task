import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { DB_PROVIDER, type DrizzleDB } from 'src/database/database.module';
import { idempotencyRecords, products, reservationHistory, reservationItems, reservations } from 'src/database/schemas';
import { normalizeItems, sortItemsForLocking } from './utils/helpers/normalizer';
import { ReservationDTO } from './DTO/reservation.dto';

@Injectable()
export class ReservationsService {
    constructor(@Inject(DB_PROVIDER) private readonly db: DrizzleDB) {}


  async createReservation(body: ReservationDTO, idempotencyKey: string, userId: string) {
    const normalized = normalizeItems(body);

    const existing = await this.db.select().from(idempotencyRecords).where(
    and(
      eq(idempotencyRecords.userId, userId),
      eq(idempotencyRecords.idempotencyKey, idempotencyKey)
    )
    );

    if (existing.length > 0) {
        if (normalized !== existing[0].normalizedItems) {
            throw new ConflictException('Idempotency key reused with different items');
        }
        // exact same reservation, so we return the existing one instead of creating a new one
        return await this.getReservation(existing[0].reservationId, userId);
    } 
    try {
        return await this.db.transaction(async (tx) => {
            const reserved = await tx.insert(reservations).values({
                userId: userId,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
            }).returning();

            for (const item of sortItemsForLocking(body.items)) {
                //for each item, check if there's enough inventory and update the reserved count
                const [product] = await tx.select({
                    reserved: products.reserved,
                    onHand: products.onHand,
                }).from(products).where(eq(products.id, item.productId)).for('update');

                //does the product exist at all?
                if (!product) {
                    throw new NotFoundException(`Product ${item.productId} not found`);
                }

                //does the product have enough inventory to reserve the requested quantity?
                if (product.reserved + item.quantity > product.onHand) {
                    throw new ConflictException(`Not enough inventory for product ${item.productId}`);
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

            await tx.insert(reservationHistory).values({
                reservationId: reserved[0].id,
                userId,
                oldStatus: null,
                newStatus: 'HELD',
                actor: 'customer',
                transitionedAt: new Date(),
            });

            return reserved[0];

        });
    } catch (error) {
        const err = error as {
            code?: string;
            cause?: {
                code?: string;
            };
        };

        const errorCode = err.code ?? err.cause?.code;

        if (errorCode === '23505') {// one of the requests failed because of a unique constraint violation
            const retried = await this.db.select().from(idempotencyRecords).where(
                and(
                    eq(idempotencyRecords.userId, userId),
                    eq(idempotencyRecords.idempotencyKey, idempotencyKey)
                )
            );
            if (retried.length > 0) {
                if (normalized !== retried[0].normalizedItems) {
                    throw new ConflictException('Idempotency key reused with different items');
                }
                // exact same reservation, so we return the existing one instead of creating a new one
                return await this.getReservation(retried[0].reservationId, userId);
            } 
        }
        throw error;
    }
  }

  async getReservation(reservationId: string, userId: string) {
    const queryResult = await this.db.select().from(reservations).where(
        and(
            eq(reservations.id, reservationId),
            eq(reservations.userId, userId)
        )
    );

    if (queryResult.length === 0) {
        throw new NotFoundException('Reservation not found or does not belong to the user');
    }

    return queryResult[0];
  }

  async confirmReservation(reservationId: string, userId: string) {
    const result = await this.db.transaction(async (tx) => {
        const reservation = await tx.select().from(reservations).where(
            and(
                eq(reservations.id, reservationId),
                eq(reservations.userId, userId)
            )
        ).for('update');

        if (reservation.length === 0) {
            throw new NotFoundException('Reservation not found or does not belong to the user');
        }

        if (reservation[0].status !== 'HELD') {
            //idempotency check
            if (reservation[0].status === 'CONFIRMED') {
                return { outcome:"ALREADY_CONFIRMED" ,message: 'Reservation already confirmed', reservation: reservation[0] };
            }
            throw new ConflictException('Reservation is not in a confirmable state');
        }

        const now = new Date();

        if (reservation[0].expiresAt <= now) {
            await tx.update(reservations).set({
                status: 'EXPIRED',
                updatedAt: now,
            }).where(eq(reservations.id, reservationId));

            const item = await tx.select().from(reservationItems).where(
                eq(reservationItems.reservationId, reservationId)
            );

            for (const i of item) {
                await tx.update(products).set({
                    reserved: sql`${products.reserved} - ${i.quantity}`,
                }).where(eq(products.id, i.productId));
            }

            await tx.insert(reservationHistory).values({
                reservationId: reservationId,
                userId: userId,
                oldStatus: reservation[0].status,
                newStatus: 'EXPIRED',
                actor: "system",
                transitionedAt: now,
            });
            return {outcome: "EXPIRED"}
            // throw new ConflictException('Reservation has expired');
        }


        const [updatedReservation] = await tx.update(reservations).set({
            status: 'CONFIRMED',
            updatedAt: now,
        }).where(eq(reservations.id, reservationId)).returning();

        const reservedItems = await tx.select().from(reservationItems).where(
            eq(reservationItems.reservationId, reservationId)
        );

        for (const item of reservedItems) {
            await tx.update(products).set({
                reserved: sql`${products.reserved} - ${item.quantity}`,
                onHand: sql`${products.onHand} - ${item.quantity}`,
            }).where(eq(products.id, item.productId));
        }

        await tx.insert(reservationHistory).values({
            reservationId: reservationId,
            userId: userId,
            oldStatus: reservation[0].status,
            newStatus: 'CONFIRMED',
            actor: 'customer',
            transitionedAt: now,
        });

        return {outcome: "CONFIRMED", message: "reservation confirmed", reservation: updatedReservation};
    });
    if (result.outcome === "EXPIRED") {
        throw new ConflictException('Reservation has expired');
    }

    return result.reservation;
  }

  async cancelReservation(reservationId: string, userId: string) {
    const result = await this.db.transaction(async (tx) => {
        const reservation = await tx.select().from(reservations).where(
            and(
                eq(reservations.id, reservationId),
                eq(reservations.userId, userId)
            )
        ).for('update');

        if (reservation.length === 0) {
            throw new NotFoundException('Reservation not found or does not belong to the user');
        }

        if (reservation[0].status !== 'HELD') {
            //idempotency check
            if (reservation[0].status === 'CANCELLED') {
                return { outcome: "ALREADY_CANCELLED", message: 'Reservation already cancelled', reservation: reservation[0]};
            }
            throw new ConflictException('Reservation is not in a cancellable state');
        }

        const now = new Date();

        if (reservation[0].expiresAt <= now) {
            await tx.update(reservations).set({
                status: 'EXPIRED',
                updatedAt: now,
            }).where(eq(reservations.id, reservationId));

            const item = await tx.select().from(reservationItems).where(
                eq(reservationItems.reservationId, reservationId)
            );

            for (const i of item) {
                await tx.update(products).set({
                    reserved: sql`${products.reserved} - ${i.quantity}`,
                }).where(eq(products.id, i.productId));
            }

            await tx.insert(reservationHistory).values({
                reservationId: reservationId,
                userId: userId,
                oldStatus: reservation[0].status,
                newStatus: 'EXPIRED',
                actor: "system",
                transitionedAt: now,
            });
            return {outcome: "EXPIRED"}
        }

        const [updatedReservation] = await tx.update(reservations).set({
            status: 'CANCELLED',
            updatedAt: now,
        }).where(eq(reservations.id, reservationId)).returning();

        const reservedItems = await tx.select().from(reservationItems).where(
            eq(reservationItems.reservationId, reservationId)
        );

        for (const item of reservedItems) {
            await tx.update (products).set({
                reserved: sql`${products.reserved} - ${item.quantity}`,
            }).where(eq(products.id, item.productId));
        }

        await tx.insert(reservationHistory).values({
            reservationId: reservationId,
            userId: userId,
            oldStatus: reservation[0].status,
            newStatus: 'CANCELLED',
            actor: 'customer',
            transitionedAt: now,
        });

        return {outcome: "CANCELLED", message: "Reservation cancelled", reservation: updatedReservation}
    });
    if (result.outcome === "EXPIRED") {
        throw new ConflictException('Reservation has expired');
    }

    return result.reservation;
  }

  // used by scheduler cron
  async cancelExpiredReservations() {

    const BATCH_SIZE = 100;
    const now = new Date();

    let processedCount = 0

    while (true) {
        const processed: number = await this.db.transaction(async (tx) => {
      
            //first we get the HELD reservations that their expiry date is already due
            const expiredReservations = await tx.select().from(reservations).where(
                and(
                eq(reservations.status, 'HELD'),
                lte(reservations.expiresAt, now),
                )
            ).limit(BATCH_SIZE).for('update');

            if (expiredReservations.length === 0) {
                return 0;
            }

            //each of those should have their status set as EXPIRED
            for (const reser of expiredReservations) {
                //each of those should have their status set as EXPIRED
                await tx.update(reservations).set({
                    status: "EXPIRED",
                    updatedAt: now
                }).where(eq(reservations.id, reser.id))

                //each should have their reserved items released

                //get all the products each reservation holds
                const items = await tx.select().from(reservationItems).where(
                    eq(reservationItems.reservationId, reser.id)
                ).for('update')

                //release reservations of each product
                for (const item of items) {
                    await tx.update(products).set({
                        reserved: sql`${products.reserved} - ${item.quantity}`
                    }).where(eq(
                        products.id, item.productId
                    ))
                }

                //register the transition in reservations history
                await tx.insert(reservationHistory).values({
                    reservationId: reser.id,
                    userId: reser.userId,
                    oldStatus: reser.status,
                    newStatus: 'EXPIRED',
                    actor: "system",
                    transitionedAt: now,
                })
            }

            return expiredReservations.length
        });

        processedCount += processed

        if (processed < BATCH_SIZE) {
            break;
        }
    }

    return { message: `Processed ${processedCount} expired reservations` };
  }
}
