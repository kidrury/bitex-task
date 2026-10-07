import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// import { TypeORMTestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schemas';
import { products, reservations, idempotencyRecords, reservationHistory, reservationItems } from '../src/database/schemas';
// import { db as drizzleDb } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

describe('Inventory Reservation System (E2E)', () => {
  let app: INestApplication;
  let db: any;
  let pool: Pool;

  const VALID_TOKEN_1 = 'test-token-customer-1';
  const VALID_TOKEN_2 = 'test-token-customer-2';
  const INVALID_TOKEN = 'invalid-token-xyz';
  const CUSTOMER_1_ID = '3631c0f9-e545-46ee-8145-a78e0384219e';
  const CUSTOMER_2_ID = '5a8c2b1e-9f3d-42c1-8b5e-6d9e0c7a3f2b';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Connect to test database
    const databaseUrl = process.env.DATABASE_URL;
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });

    // Seed initial data
    await db.delete(products).execute();
    await db.insert(products).values([
      { id: 'SKU-A', name: 'Product A', onHand: 10, reserved: 0 },
      { id: 'SKU-B', name: 'Product B', onHand: 5, reserved: 0 },
      { id: 'SKU-C', name: 'Product C', onHand: 0, reserved: 0 },
    ]).execute();
  });

  beforeEach(async () => {
    // Reset database before each test
    await db.delete(reservationItems).execute();
    await db.delete(reservations).execute();
    await db.delete(idempotencyRecords).execute();
    await db.delete(reservationHistory).execute();
    
    // Reset products to initial state
    await db.update(products).set({ onHand: 0, reserved: 0 }).execute();
    await db.insert(products).values([
      { id: 'SKU-A', name: 'Product A', onHand: 10, reserved: 0 },
      { id: 'SKU-B', name: 'Product B', onHand: 5, reserved: 0 },
      { id: 'SKU-C', name: 'Product C', onHand: 0, reserved: 0 },
    ]).execute();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up reservations after each test (keep products)
    await db.delete(reservations).execute();
    await db.delete(idempotencyRecords).execute();
    await db.delete(reservationHistory).execute();
  });

  // ============================================================
  // TEST 1: Successful Reservation Creation
  // ============================================================
  describe('Reservation Creation', () => {
    it('TC1: Should successfully create a reservation with valid input', async () => {
      const body = {
        items: [
          { productId: 'SKU-A', quantity: 3 },
          { productId: 'SKU-B', quantity: 2 },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-1')
        .send(body)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('HELD');
      expect(response.body.userId).toBe(CUSTOMER_1_ID);
      expect(response.body).toHaveProperty('expiresAt');

      // Verify stock was reserved
      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(3);
    });

    // ============================================================
    // TEST 2: Invalid Quantities
    // ============================================================
    it('TC2: Should reject reservation with invalid quantity (0)', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 0 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-2')
        .send(body)
        .expect(400);

      expect(response.body.code).toBe('INVALID_REQUEST');
      expect(response.body).toHaveProperty('requestId');
    });

    it('TC2b: Should reject reservation with quantity > 100', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 101 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-2b')
        .send(body)
        .expect(400);

      expect(response.body.code).toBe('INVALID_REQUEST');
    });

    // ============================================================
    // TEST 3: Duplicate Products in Same Reservation
    // ============================================================
    it('TC3: Should reject reservation with duplicate products', async () => {
      const body = {
        items: [
          { productId: 'SKU-A', quantity: 2 },
          { productId: 'SKU-A', quantity: 3 },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-3')
        .send(body)
        .expect(400);

      expect(response.body.code).toBe('DUPLICATE_PRODUCT');
    });

    // ============================================================
    // TEST 4: Unknown Products
    // ============================================================
    it('TC4: Should reject reservation with unknown product', async () => {
      const body = {
        items: [{ productId: 'SKU-UNKNOWN', quantity: 5 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-4')
        .send(body)
        .expect(404);

      expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
    });

    // ============================================================
    // TEST 5: Invalid Tokens
    // ============================================================
    it('TC5: Should reject request with invalid token', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 2 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${INVALID_TOKEN}`)
        .set('Idempotency-Key', 'unique-key-5')
        .send(body)
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('TC5b: Should reject request with missing token', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 2 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Idempotency-Key', 'unique-key-5b')
        .send(body)
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    // ============================================================
    // TEST 6: Missing Idempotency Key
    // ============================================================
    it('TC6: Should reject reservation without Idempotency-Key header', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 2 }],
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .send(body)
        .expect(400);

      expect(response.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    // ============================================================
    // TEST 7: Insufficient Stock
    // ============================================================
    it('TC7: Should reject reservation when insufficient stock', async () => {
      const body = {
        items: [{ productId: 'SKU-A', quantity: 15 }], // SKU-A has only 10
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-7')
        .send(body)
        .expect(409);

      expect(response.body.code).toBe('INSUFFICIENT_STOCK');
    });

    it('TC7b: Should reject when product stock is 0', async () => {
      const body = {
        items: [{ productId: 'SKU-C', quantity: 1 }], // SKU-C has 0 stock
      };

      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'unique-key-7b')
        .send(body)
        .expect(409);

      expect(response.body.code).toBe('INSUFFICIENT_STOCK');
    });

    // ============================================================
    // TEST 8: Idempotency - Same Request Returns Existing Reservation
    // ============================================================
    it('TC8: Should return existing reservation for identical idempotency key', async () => {
      const idempotencyKey = 'idempotent-test-1';
      const body = {
        items: [{ productId: 'SKU-A', quantity: 2 }],
      };

      // First request
      const response1 = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      const reservationId1 = response1.body.id;

      // Second identical request
      const response2 = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      const reservationId2 = response2.body.id;

      // Should return the same reservation
      expect(reservationId1).toBe(reservationId2);

      // Stock should only be reserved once
      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(2);
    });

    // ============================================================
    // TEST 9: Idempotency Conflict - Same Key, Different Items
    // ============================================================
    it('TC9: Should reject when idempotency key reused with different items', async () => {
      const idempotencyKey = 'conflict-test-1';

      // First request
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      // Second request with same key but different items
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ items: [{ productId: 'SKU-B', quantity: 2 }] })
        .expect(409);

      expect(response.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });
  });

  // ============================================================
  // TEST 10: Reservation Confirmation and Stock Deduction
  // ============================================================
  describe('Reservation Confirmation', () => {
    it('TC10: Should successfully confirm reservation and deduct stock', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'confirm-test-1')
        .send({
          items: [
            { productId: 'SKU-A', quantity: 3 },
            { productId: 'SKU-B', quantity: 2 },
          ],
        })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Verify stock is reserved (not yet deducted from onHand)
      let productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].onHand).toBe(10);
      expect(productA[0].reserved).toBe(3);
      expect(productA[0].onHand - productA[0].reserved).toBe(7); // available

      // Confirm reservation
      const confirmResponse = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(confirmResponse.body.status).toBe('CONFIRMED');

      // Verify stock is deducted from both reserved and onHand
      productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].onHand).toBe(7); // was 10, sold 3
      expect(productA[0].reserved).toBe(0); // no longer reserved

      const productB = await db.select().from(products).where(eq(products.id, 'SKU-B')).execute();
      expect(productB[0].onHand).toBe(3); // was 5, sold 2
      expect(productB[0].reserved).toBe(0);
    });

    it('TC10b: Should be idempotent - confirming already confirmed reservation returns 200', async () => {
      // Create and confirm
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'confirm-test-2')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Try to confirm again
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(response.body.status).toBe('CONFIRMED');
    });

    it('TC10c: Should return 404 when confirming non-existent reservation', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.getHttpServer())
        .post(`/reservations/${fakeId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(404);

      expect(response.body.code).toBe('RESERVATION_NOT_FOUND');
    });

    it('TC10d: Should prevent confirming cancelled reservation', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'confirm-test-3')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Cancel it
      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Try to confirm cancelled reservation
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      expect(response.body.code).toBe('INVALID_RESERVATION_STATE');
    });

    it('TC10e: Should prevent confirming expired reservation', async () => {
      // Create reservation with very short expiry (we'll manually set it to past)
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'confirm-test-4')
        .send({ items: [{ productId: 'SKU-A', quantity: 1 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Manually expire the reservation
      await db.update(reservations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(reservations.id, reservationId))
        .execute();

      // Try to confirm expired reservation
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      expect(response.body.code).toBe('RESERVATION_EXPIRED');

      // Verify it was marked EXPIRED and stock was released
      const reservation = await db.select().from(reservations).where(eq(reservations.id, reservationId)).execute();
      expect(reservation[0].status).toBe('EXPIRED');

      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(0); // Stock released
    });
  });

  // ============================================================
  // TEST 11: Reservation Cancellation
  // ============================================================
  describe('Reservation Cancellation', () => {
    it('TC11: Should successfully cancel reservation and release reserved stock', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'cancel-test-1')
        .send({
          items: [
            { productId: 'SKU-A', quantity: 3 },
            { productId: 'SKU-B', quantity: 2 },
          ],
        })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Verify stock is reserved
      let productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(3);

      // Cancel reservation
      const cancelResponse = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(cancelResponse.body.status).toBe('CANCELLED');

      // Verify stock is released from reserved, but onHand unchanged
      productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].onHand).toBe(10); // unchanged
      expect(productA[0].reserved).toBe(0); // released
    });

    it('TC11b: Should be idempotent - cancelling already cancelled reservation returns 200', async () => {
      // Create and cancel
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'cancel-test-2')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Try to cancel again
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(response.body.status).toBe('CANCELLED');
    });

    it('TC11c: Should prevent cancelling confirmed reservation', async () => {
      // Create and confirm
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'cancel-test-3')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Try to cancel confirmed reservation
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      expect(response.body.code).toBe('INVALID_RESERVATION_STATE');
    });

    it('TC11d: Should prevent cancelling expired reservation and release stock', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'cancel-test-4')
        .send({ items: [{ productId: 'SKU-A', quantity: 1 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Manually expire it
      await db.update(reservations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(reservations.id, reservationId))
        .execute();

      // Try to cancel expired reservation
      const response = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/cancel`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      expect(response.body.code).toBe('RESERVATION_EXPIRED');

      // Verify it was marked EXPIRED and stock released
      const reservation = await db.select().from(reservations).where(eq(reservations.id, reservationId)).execute();
      expect(reservation[0].status).toBe('EXPIRED');

      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(0);
    });
  });

  // ============================================================
  // TEST 12: GET Reservation (Ownership Check)
  // ============================================================
  describe('Get Reservation', () => {
    it('TC12: Should retrieve owned reservation with items', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'get-test-1')
        .send({
          items: [
            { productId: 'SKU-A', quantity: 3 },
            { productId: 'SKU-B', quantity: 2 },
          ],
        })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Get reservation
      const getResponse = await request(app.getHttpServer())
        .get(`/reservations/${reservationId}`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(getResponse.body.id).toBe(reservationId);
      expect(getResponse.body.userId).toBe(CUSTOMER_1_ID);
      expect(getResponse.body.status).toBe('HELD');
    });

    it('TC12b: Should prevent accessing others\' reservations', async () => {
      // Customer 1 creates reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'get-test-2')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Customer 2 tries to access it
      const response = await request(app.getHttpServer())
        .get(`/reservations/${reservationId}`)
        .set('Authorization', `Bearer ${VALID_TOKEN_2}`)
        .expect(404);

      expect(response.body.code).toBe('RESERVATION_NOT_FOUND');
    });
  });

  // ============================================================
  // TEST 13: Products Listing with Pagination
  // ============================================================
  describe('Products Listing', () => {
    it('TC13: Should list all products with available stock', async () => {
      const response = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(3);

      // Check structure
      const product = response.body.data[0];
      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('onHand');
      expect(product).toHaveProperty('reserved');
      expect(product).toHaveProperty('available');

      // SKU-C should show 0 available
      const skuC = response.body.data.find((p: any) => p.id === 'SKU-C');
      expect(skuC.available).toBe(0);
    });

    it('TC13b: Should respect pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/products?page=1&limit=2')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(2);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.total).toBe(3);
    });

    it('TC13c: Should update available count after reservation', async () => {
      // Get initial state
      let productsResponse = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      const initialSkuA = productsResponse.body.data.find((p: any) => p.id === 'SKU-A');
      expect(initialSkuA.available).toBe(10);

      // Create reservation
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'products-test-1')
        .send({ items: [{ productId: 'SKU-A', quantity: 3 }] })
        .expect(201);

      // Get updated state
      productsResponse = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      const updatedSkuA = productsResponse.body.data.find((p: any) => p.id === 'SKU-A');
      expect(updatedSkuA.available).toBe(7); // 10 - 3 reserved
      expect(updatedSkuA.reserved).toBe(3);
    });
  });

  // ============================================================
  // TEST 14: Concurrency and Race Conditions
  // ============================================================
  describe('Concurrency', () => {
    it('TC14: Should handle concurrent reservations on same product (stock deduction)', async () => {
      // Two concurrent requests for SKU-B (5 units available)
      const requests = [
        request(app.getHttpServer())
          .post('/reservations')
          .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
          .set('Idempotency-Key', 'concurrent-1')
          .send({ items: [{ productId: 'SKU-B', quantity: 3 }] }),
        request(app.getHttpServer())
          .post('/reservations')
          .set('Authorization', `Bearer ${VALID_TOKEN_2}`)
          .set('Idempotency-Key', 'concurrent-2')
          .send({ items: [{ productId: 'SKU-B', quantity: 3 }] }),
      ];

      const results = await Promise.all(requests);

      // One should succeed, one should fail (or both succeed if we're within limit)
      const statuses = results.map((r) => r.status);
      
      // At least one should be created
      expect(statuses).toContain(201);

      // Total reserved should respect inventory
      const productB = await db.select().from(products).where(eq(products.id, 'SKU-B')).execute();
      expect(productB[0].reserved).toBeLessThanOrEqual(5);
    });

    it('TC14b: Should handle concurrent idempotency requests (same key)', async () => {
      const idempotencyKey = 'concurrent-idempotent';

      const requests = [
        request(app.getHttpServer())
          .post('/reservations')
          .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
          .set('Idempotency-Key', idempotencyKey)
          .send({ items: [{ productId: 'SKU-A', quantity: 2 }] }),
        request(app.getHttpServer())
          .post('/reservations')
          .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
          .set('Idempotency-Key', idempotencyKey)
          .send({ items: [{ productId: 'SKU-A', quantity: 2 }] }),
      ];

      const results = await Promise.all(requests);

      // Both should succeed but return same reservation
      results.forEach((r) => expect(r.status).toBe(201));

      const body1 = results[0].body;
      const body2 = results[1].body;

      // Should be the same reservation
      expect(body1.id).toBe(body2.id);

      // Stock should only be reserved once
      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(2);
    });
  });

  // ============================================================
  // TEST 15: Error Format and Response Structure
  // ============================================================
  describe('Error Format and Response Structure', () => {
    it('TC15: Should include requestId in all error responses', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .send({ items: [] })
        .expect(400);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('requestId');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('TC15b: Should NOT expose stack traces', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${INVALID_TOKEN}`)
        .set('Idempotency-Key', 'error-test')
        .send({ items: [{ productId: 'SKU-A', quantity: 1 }] })
        .expect(401);

      expect(response.body).not.toHaveProperty('stack');
      expect(JSON.stringify(response.body)).not.toContain('at ');
    });
  });

  // ============================================================
  // TEST 16: History and Audit Trail
  // ============================================================
  describe('History and Audit Trail', () => {
    it('TC16: Should create history records for all state transitions', async () => {
      // Create reservation
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'history-test-1')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Check history for HELD creation
      let history = await db.select().from(reservationHistory).where(eq(reservationHistory.reservationId, reservationId)).execute();
      expect(history.length).toBe(1);
      expect(history[0].oldStatus).toBeNull();
      expect(history[0].newStatus).toBe('HELD');
      expect(history[0].actor).toBe('customer');

      // Confirm reservation
      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Check history for CONFIRMED
      history = await db.select().from(reservationHistory).where(eq(reservationHistory.reservationId, reservationId)).execute();
      expect(history.length).toBe(2);
      expect(history[1].oldStatus).toBe('HELD');
      expect(history[1].newStatus).toBe('CONFIRMED');
      expect(history[1].actor).toBe('customer');
    });

    it('TC16b: Should record system-initiated transitions', async () => {
      // Create and manually expire
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'history-test-2')
        .send({ items: [{ productId: 'SKU-A', quantity: 1 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Expire the reservation
      await db.update(reservations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(reservations.id, reservationId))
        .execute();

      // Trigger expiry by confirming
      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      // Check history for system-initiated EXPIRED transition
      const history = await db.select().from(reservationHistory).where(eq(reservationHistory.reservationId, reservationId)).execute();
      const expiredRecord = history.find((h: any) => h.newStatus === 'EXPIRED');
      expect(expiredRecord).toBeDefined();
      expect(expiredRecord.actor).toBe('system');
    });
  });

  // ============================================================
  // TEST 17: Ownership and Multi-Tenant Isolation
  // ============================================================
  describe('Multi-Tenant Isolation', () => {
    it('TC17: Should isolate reservations between customers', async () => {
      // Customer 1 creates reservation
      const c1Response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'tenant-test-1')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const c1ReservationId = c1Response.body.id;

      // Customer 2 creates separate reservation
      const c2Response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_2}`)
        .set('Idempotency-Key', 'tenant-test-2')
        .send({ items: [{ productId: 'SKU-A', quantity: 3 }] })
        .expect(201);

      const c2ReservationId = c2Response.body.id;

      // Verify they're different reservations
      expect(c1ReservationId).not.toBe(c2ReservationId);

      // Customer 1 can get their reservation
      await request(app.getHttpServer())
        .get(`/reservations/${c1ReservationId}`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(200);

      // Customer 1 cannot get customer 2's reservation
      await request(app.getHttpServer())
        .get(`/reservations/${c2ReservationId}`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(404);

      // Verify total reserved stock is correct
      const productA = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(productA[0].reserved).toBe(5); // 2 + 3
    });
  });

  // ============================================================
  // TEST 18: Reservation Expiry Scheduler
  // ============================================================
  describe('Expiry Job', () => {
    it('TC18: Should auto-expire old reservations after timeout', async () => {
      // Create reservation with immediate expiry
      const createResponse = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .set('Idempotency-Key', 'expiry-test-1')
        .send({ items: [{ productId: 'SKU-A', quantity: 2 }] })
        .expect(201);

      const reservationId = createResponse.body.id;

      // Manually set expiry to past
      await db.update(reservations)
        .set({ expiresAt: new Date(Date.now() - 5000) })
        .where(eq(reservations.id, reservationId))
        .execute();

      // Manually trigger expiry job (since we can't wait 30 seconds)
      // This is normally called by the scheduler
      // For testing, we'll just verify the logic via confirm/cancel
      await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${VALID_TOKEN_1}`)
        .expect(409);

      // Verify reservation is marked EXPIRED
      const res = await db.select().from(reservations).where(eq(reservations.id, reservationId)).execute();
      expect(res[0].status).toBe('EXPIRED');

      // Verify stock was released
      const product = await db.select().from(products).where(eq(products.id, 'SKU-A')).execute();
      expect(product[0].reserved).toBe(0);
    });
  });
});
