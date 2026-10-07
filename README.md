# Inventory Reservation & Checkout

A NestJS + PostgreSQL inventory reservation service built for the Backend Engineering Coding Challenge.

The service supports:

- Atomic inventory reservations across multiple products
- Concurrency-safe stock updates
- Idempotent reservation creation
- Reservation confirmation and cancellation
- Automatic reservation expiry
- Append-only reservation state history
- Real PostgreSQL integration/E2E tests
- Docker-based local development

## Tech Stack

- **Node.js 22**
- **NestJS 11**
- **TypeScript**
- **PostgreSQL 17**
- **Drizzle ORM**
- **Zod**
- **Jest + Supertest**
- **Docker Compose**
- **pnpm**

## Requirements

Before running the project, make sure you have:

- Node.js 22+
- pnpm
- Docker and Docker Compose

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/kidrury/bitex-task.git
cd bitex-task
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start the application

```bash
docker compose up --build -d
```

This starts:

- PostgreSQL
- the migration container
- the API

The database migration runs automatically before the API starts.

The API is available at:

```text
http://localhost:3000
```

### 4. Seed the development products

The challenge requires three products:

| SKU | On Hand |
|---|---:|
| SKU-A | 10 |
| SKU-B | 5 |
| SKU-C | 0 |

Run:

```bash
docker compose run --rm migrate node dist/scripts/seed.js
```

The seed script recreates the required development product state.

### 5. Verify the API

```bash
curl http://localhost:3000/products
```

Expected products include:

```text
SKU-A: onHand=10, reserved=0, available=10
SKU-B: onHand=5,  reserved=0, available=5
SKU-C: onHand=0,  reserved=0, available=0
```

---

# Authentication

This challenge uses fixed development tokens instead of a real authentication provider.

Two customers are available:

```text
Customer 1:
test-token-customer-1

Customer 2:
test-token-customer-2
```

Use the token in the `Authorization` header:

```text
Authorization: Bearer test-token-customer-1
```

Customer identity is resolved server-side from the token and is never accepted from the request body.

---

# API

## List products

```http
GET /products
```

Optional query parameters:

```text
?page=1&limit=20
```

The response includes:

- `onHand`
- `reserved`
- `available`
- pagination information

`available` is calculated as:

```text
available = onHand - reserved
```

### Example

```bash
curl http://localhost:3000/products \
  -H "Authorization: Bearer test-token-customer-1"
```

---

## Create a reservation

```http
POST /reservations
```

Required header:

```text
Authorization: Bearer <token>
Idempotency-Key: <unique-key>
```

Example:

```bash
curl -X POST http://localhost:3000/reservations \
  -H "Authorization: Bearer test-token-customer-1" \
  -H "Idempotency-Key: reservation-001" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "productId": "SKU-A", "quantity": 3 },
      { "productId": "SKU-B", "quantity": 2 }
    ]
  }'
```

Reservation rules:

- 1–10 distinct products per reservation
- Quantity must be between 1 and 100
- Duplicate products are rejected
- Unknown products are rejected
- Insufficient stock is rejected
- `Idempotency-Key` is required

A successful reservation starts in the `HELD` state and reserves inventory for 10 minutes.

---

## Get a reservation

```http
GET /reservations/:id
```

A customer can only access their own reservations.

---

## Confirm a reservation

```http
POST /reservations/:id/confirm
```

A successful confirmation:

- changes `HELD` → `CONFIRMED`
- decreases `reserved`
- decreases `onHand`

Confirming an already confirmed reservation is idempotent.

If the reservation has expired, it is first persisted as `EXPIRED`, its reserved stock is released, and the request returns a conflict response.

---

## Cancel a reservation

```http
POST /reservations/:id/cancel
```

A successful cancellation:

- changes `HELD` → `CANCELLED`
- releases `reserved`
- leaves `onHand` unchanged

Cancelling an already cancelled reservation is idempotent.

---

# Concurrency and Consistency

The most important part of the implementation is protecting inventory under concurrent requests.

## Stock model

For each product:

```text
available = onHand - reserved
```

Creating a reservation increases `reserved`.

Confirming a reservation decreases both:

```text
reserved -= quantity
onHand    -= quantity
```

Cancelling or expiring a reservation only decreases:

```text
reserved -= quantity
```

The implementation keeps these changes inside database transactions.

## Row locking

Product rows are locked with PostgreSQL `FOR UPDATE` before the available stock is checked and modified.

Reservation operations also lock the reservation row before changing its state.

Reservation items are processed in deterministic product-ID order to avoid different requests acquiring product locks in different orders.

## Atomic reservation creation

Creating a reservation, updating product stock, creating reservation items, creating the idempotency record, and creating the initial history entry happen inside the same database transaction.

Therefore, a partially successful reservation cannot leave stock behind.

For example:

```text
SKU-A: quantity 2
SKU-C: quantity 1
```

If SKU-A is available but SKU-C is not, the entire transaction rolls back and SKU-A remains unchanged.

---

# Idempotency

Reservation creation requires an `Idempotency-Key`.

The idempotency record is scoped to:

```text
(customer, idempotency key)
```

The normalized item set is stored with the successful operation.

### Same request

Sending the same customer + key + items again returns the original reservation.

No additional stock is reserved and the reservation expiry is not extended.

### Same items in a different order

These are treated as the same logical request:

```json
{
  "items": [
    { "productId": "SKU-A", "quantity": 3 },
    { "productId": "SKU-B", "quantity": 2 }
  ]
}
```

and:

```json
{
  "items": [
    { "productId": "SKU-B", "quantity": 2 },
    { "productId": "SKU-A", "quantity": 3 }
  ]
}
```

### Same key with different items

The request returns a conflict and cannot create another reservation.

### Concurrent identical requests

The database has a unique constraint on:

```text
(user_id, idempotency_key)
```

If two identical requests race, one transaction wins the insert and the other receives PostgreSQL's unique-constraint violation. The losing request then reads the persisted idempotency record and returns the original reservation.

This provides exactly-once reservation creation for concurrent retries.

---

# Reservation Expiry

Reservations are held for 10 minutes based on server time.

A reservation is expired when:

```text
now >= expiresAt
```

Expiry is handled by an in-process scheduler that runs every 30 seconds.

The expiry processor:

- only processes `HELD` reservations
- processes expired reservations in batches of 100
- locks reservations before changing them
- releases reserved inventory
- records the `HELD → EXPIRED` transition
- continues until no expired reservations remain

Overlapping executions are prevented within the running process, while database row locks provide protection at the transaction level.

The expiry logic is also restart-safe: expired `HELD` reservations remain eligible after an application restart and are picked up by the next scheduler run.

---

# Reservation History

Every state transition is recorded in an append-only history table.

The initial reservation creation records:

```text
NULL → HELD
```

Other transitions include:

```text
HELD → CONFIRMED
HELD → CANCELLED
HELD → EXPIRED
```

Each history record contains:

- reservation ID
- previous state
- new state
- actor
- transition timestamp

Stock changes and state transitions are committed atomically.

---

# Error Responses

Errors use a consistent JSON structure:

```json
{
  "code": "INSUFFICIENT_STOCK",
  "message": "Not enough inventory for product SKU-A",
  "requestId": "7d53c4a3-...",
  "timestamp": "2026-10-07T..."
}
```

The API does not expose stack traces in normal error responses.

---

# Testing

The project uses **real PostgreSQL** for E2E tests instead of an in-memory database.

The E2E suite manages its own test data. **No separate seed command is required for tests.** Each test resets the relevant tables and inserts the required fixture products before running.

## 1. Start the test database

```bash
docker compose -f docker-compose.test.yml up -d
```

The test database is exposed on:

```text
localhost:5442
```

## 2. Configure the test database

Linux/macOS:

```bash
export DATABASE_URL=postgresql://bitex_test:bitex_test@localhost:5442/bitex_test
```

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://bitex_test:bitex_test@localhost:5442/bitex_test"
```

## 3. Run migrations

```bash
pnpm db:migrate
```

## 4. Run the E2E suite

```bash
pnpm test:e2e
```

The suite covers:

- successful reservation creation
- validation errors
- duplicate products
- unknown products
- authentication
- missing idempotency keys
- insufficient stock
- atomic rollback
- idempotent retries
- reordered idempotent requests
- idempotency conflicts
- confirmation
- cancellation
- expired reservations
- ownership isolation
- product pagination
- concurrent reservations
- concurrent idempotency requests
- error response structure
- reservation history
- automatic expiry
- expiry batching
- exactly-once stock release

Current test result:

```text
37 passed, 37 total
```

## Reset the test database

To completely recreate the test database:

```bash
docker compose -f docker-compose.test.yml down -v
docker compose -f docker-compose.test.yml up -d
```

Then run the migrations again:

```bash
pnpm db:migrate
```

---

# Database

Drizzle migrations are stored in:

```text
drizzle/
```

Generate a migration after schema changes:

```bash
pnpm db:generate
```

Apply migrations:

```bash
pnpm db:migrate
```

The production Docker Compose flow automatically runs migrations before starting the API.

---

# Project Structure

```text
src/
├── auth/                  # Development token authentication
├── common/                # Shared validation and error handling
├── database/              # Drizzle database setup and schemas
├── products/              # Product listing and inventory reads
├── reservations/          # Reservation creation and state transitions
└── scheduler/             # Reservation expiry scheduler

scripts/
└── seed.ts                # Development seed data

test/
└── app.e2e-spec.ts        # PostgreSQL-backed E2E/acceptance tests

drizzle/
└── ...                    # Database migrations
```

---

# Design Decisions

### Why PostgreSQL row locks?

Inventory is shared mutable state. PostgreSQL row-level locking provides a database-enforced synchronization point when multiple requests attempt to reserve the same product concurrently.

### Why store `reserved` separately?

Keeping `onHand` and `reserved` separately makes the reservation lifecycle explicit:

- `HELD` affects `reserved`
- `CONFIRMED` moves stock out of `onHand`
- `CANCELLED` releases `reserved`
- `EXPIRED` releases `reserved`

This also makes `available = onHand - reserved` straightforward to query.

### Why persist idempotency records?

An in-memory idempotency cache would not survive process restarts and would not provide transactional guarantees. Persisting the successful operation in PostgreSQL allows the idempotency record, reservation, stock changes, and history entry to commit atomically.

### Why use a scheduler instead of a queue?

The challenge explicitly allows a single service with a scheduled expiry job. PostgreSQL provides the persistence and concurrency guarantees needed here without introducing Redis, a message broker, or Kubernetes.

---

# Limitations

This project is intentionally scoped to the challenge requirements.

- Authentication uses fixed development tokens instead of a production identity provider.
- The expiry scheduler runs inside the application process.
- There is no payment integration or external message broker.
- No frontend is included.
- No distributed scheduler/leader-election mechanism is required for the single-service challenge scope.

For a production multi-instance deployment, the scheduler coordination strategy would need to be reconsidered separately from the database-level locking used by the expiry transactions.

---

# Useful Commands

```bash
# install dependencies
pnpm install

# development server
pnpm start:dev

# build
pnpm build

# migrations
pnpm db:generate
pnpm db:migrate

# seed development data
pnpm db:seed

# tests
pnpm test
pnpm test:e2e
pnpm test:cov

# formatting
pnpm format

# lint
pnpm lint
```

---

# Challenge Completion

The implementation covers the core requirements of the Inventory Reservation and Checkout challenge, including transactional inventory reservation, concurrency protection, idempotent retries, reservation expiry, state history, ownership isolation, Docker-based setup, and PostgreSQL-backed acceptance tests.

Time spent: **Not precisely tracked.**
