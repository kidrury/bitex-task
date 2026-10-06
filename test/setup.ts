import 'dotenv/config';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://bitex_test:bitex_test@localhost:5442/bitex_test';