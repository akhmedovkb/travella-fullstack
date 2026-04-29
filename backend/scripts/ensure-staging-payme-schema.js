require("dotenv").config();

const pool = require("../db");

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id BIGSERIAL PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      password TEXT,
      password_hash TEXT,
      contact_balance BIGINT NOT NULL DEFAULT 0,
      telegram TEXT,
      telegram_chat_id TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS telegram TEXT,
      ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lower_email ON clients (lower(email));
    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);

    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id BIGINT NOT NULL,
      author_role TEXT NOT NULL,
      author_id BIGINT NOT NULL,
      booking_id BIGINT,
      rating INTEGER NOT NULL,
      text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);

    CREATE TABLE IF NOT EXISTS payme_topup_orders (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
      provider TEXT NOT NULL DEFAULT 'payme',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ NULL
    );

    ALTER TABLE payme_topup_orders
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'payme',
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'topup_orders'
      ) THEN
        CREATE VIEW topup_orders AS SELECT * FROM payme_topup_orders;
      END IF;
    END
    $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'topup_orders'
           AND c.relkind = 'r'
      ) THEN
        ALTER TABLE topup_orders
          ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'payme',
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS payme_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      method TEXT,
      stage TEXT,
      payme_id TEXT,
      order_id BIGINT,
      rpc_id TEXT,
      http_status INTEGER,
      error_code INTEGER,
      error_message TEXT,
      ip TEXT,
      user_agent TEXT,
      duration_ms INTEGER,
      req_json JSONB,
      res_json JSONB
    );

    CREATE TABLE IF NOT EXISTS contact_unlock_funnel (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      client_id BIGINT NOT NULL,
      service_id BIGINT NOT NULL,
      provider_id BIGINT,
      source TEXT,
      step TEXT NOT NULL,
      status TEXT,
      price_tiyin BIGINT NOT NULL DEFAULT 0,
      balance_before BIGINT,
      balance_after BIGINT,
      payme_id TEXT,
      order_id BIGINT,
      session_key TEXT,
      meta JSONB
    );

    CREATE TABLE IF NOT EXISTS client_pending_unlocks (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      client_id BIGINT NOT NULL,
      service_id BIGINT NOT NULL
    );
  `);

  console.log("staging Payme schema ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
