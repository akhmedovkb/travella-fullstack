// Explicit opt-in migration. No startup migration or operational writes.
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/20261128_donas_knowledge.sql'), 'utf8'));
    await client.query('COMMIT');
    console.log('Dona’s knowledge schema ready. Initialize documents from the admin screens.');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; }).finally(() => pool.end());
