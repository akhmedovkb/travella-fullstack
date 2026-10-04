const db = require('../db');

const phoneDigits = String(process.argv[2] || '').replace(/\D/g, '');
const execute = process.argv.includes('--execute');

async function main() {
  if (!phoneDigits) throw new Error('phone_required');
  const found = await db.query(
    `SELECT id,name,type,phone,telegram_chat_id,tg_chat_id
       FROM providers
      WHERE regexp_replace(phone,'\\D','','g')=$1`,
    [phoneDigits]
  );
  console.log(JSON.stringify({ execute, providers: found.rows }, null, 2));
  const targets = found.rows.filter((row) => String(row.type || '').toLowerCase() === 'client');
  if (!execute || !targets.length) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const row of targets) {
      await client.query(`DELETE FROM blocked_dates WHERE provider_id=$1`, [row.id]);
      await client.query(`UPDATE leads SET assignee_provider_id=NULL WHERE assignee_provider_id=$1`, [row.id]);
      await client.query(`DELETE FROM providers WHERE id=$1 AND LOWER(COALESCE(type,''))='client'`, [row.id]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ deleted_provider_ids: targets.map((row) => row.id) }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
