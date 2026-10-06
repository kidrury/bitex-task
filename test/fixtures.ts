import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL,
});

export async function resetDatabase() {
  await pool.query(`
    TRUNCATE
      reservation_history,
      idempotency_records,
      reservation_items,
      reservations,
      products
    CASCADE;
  `);

  await pool.query(`
    INSERT INTO products (id, name, on_hand, reserved)
    VALUES
      ('SKU-A', 'product A', 10, 0),
      ('SKU-B', 'product B', 5, 0),
      ('SKU-C', 'product C', 0, 0);
  `);
}

export async function query<T = any>(
  text: string,
  values?: unknown[],
) {
  return pool.query<T>(text, values);
}

export async function closeDatabase() {
  await pool.end();
}