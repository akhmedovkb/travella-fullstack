require("dotenv").config();
const pool = require("../db");

async function main() {
  await pool.query(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS net_price NUMERIC(14, 2),
      ADD COLUMN IF NOT EXISTS gross_price NUMERIC(14, 2),
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS location TEXT,
      ADD COLUMN IF NOT EXISTS expiration_at TIMESTAMPTZ
  `);

  await pool.query(`UPDATE services SET currency = 'USD' WHERE currency IS NULL OR BTRIM(currency) = ''`);
  console.log("[schema] service admin columns ready");
}

main()
  .catch((error) => {
    console.error("[schema] service admin columns failed", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
