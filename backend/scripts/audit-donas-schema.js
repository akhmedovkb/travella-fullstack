// Read-only schema inspection. Run from backend with the intended DATABASE_URL.
const pool = require('../db');
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'donas_%'
      ORDER BY table_name, ordinal_position`);
    console.log(JSON.stringify(rows, null, 2));
    await client.query('ROLLBACK');
  } finally { client.release(); }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode=1; }).finally(() => pool.end());
