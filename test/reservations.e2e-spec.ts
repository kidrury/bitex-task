import {
  INestApplication,
} from '@nestjs/common';
import {
  Test,
  TestingModule,
} from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  resetDatabase,
  closeDatabase,
  query,
} from './fixtures';

describe('Reservations', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();

    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it('reserves 3 units of SKU-A and confirms the reservation', async () => {
    const createResponse = await request(
      app.getHttpServer(),
    )
      .post('/reservations')
      .set(
        'Authorization',
        'Bearer test-token-customer-1',
      )
      .set('Idempotency-Key', 'lifecycle-confirm')
      .send({
        items: [
          {
            productId: 'SKU-A',
            quantity: 3,
          },
        ],
      })
      .expect(201);

    const reservationId =
      createResponse.body.id;

    expect(reservationId).toBeDefined();

    let result = await query<{
      on_hand: number;
      reserved: number;
    }>(
      `
        SELECT on_hand, reserved
        FROM products
        WHERE id = 'SKU-A'
      `,
    );

    expect(result.rows[0]).toEqual({
      on_hand: 10,
      reserved: 3,
    });

    const confirmResponse = await request(
      app.getHttpServer(),
    )
      .post(
        `/reservations/${reservationId}/confirm`,
      )
      .set(
        'Authorization',
        'Bearer test-token-customer-1',
      )
      .expect(200);

    expect(confirmResponse.body.status)
      .toBe('CONFIRMED');

    result = await query<{
      on_hand: number;
      reserved: number;
    }>(
      `
        SELECT on_hand, reserved
        FROM products
        WHERE id = 'SKU-A'
      `,
    );

    expect(result.rows[0]).toEqual({
      on_hand: 7,
      reserved: 0,
    });

    const history = await query<{
      old_status: string | null;
      new_status: string;
    }>(
      `
        SELECT old_status, new_status
        FROM reservation_history
        WHERE reservation_id = $1
        ORDER BY transitioned_at, id
      `,
      [reservationId],
    );

    expect(history.rows).toEqual([
      {
        old_status: null,
        new_status: 'HELD',
      },
      {
        old_status: 'HELD',
        new_status: 'CONFIRMED',
      },
    ]);
  });
});