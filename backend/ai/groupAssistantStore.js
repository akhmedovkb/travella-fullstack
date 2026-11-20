function createGroupAssistantStore(pool, { groupLimit = 50, globalLimit = 300 } = {}) {
  let ready;
  async function ensure() {
    if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS telegram_group_assistant_chats (
      chat_id BIGINT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,
      activated_by BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      usage_day DATE, requests_today INTEGER NOT NULL DEFAULT 0
    )`).then(() => pool.query(`ALTER TABLE telegram_group_assistant_chats ADD COLUMN IF NOT EXISTS auto_mode BOOLEAN NOT NULL DEFAULT FALSE`)).then(() => pool.query(`CREATE TABLE IF NOT EXISTS telegram_group_assistant_usage (
      usage_day DATE PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0
    )`)).catch(error => { ready = null; throw error; });
    return ready;
  }
  return {
    initialize: ensure,
    async enabled(chatId) { await ensure(); const r = await pool.query('SELECT enabled FROM telegram_group_assistant_chats WHERE chat_id=$1', [chatId]); return r.rows[0]?.enabled === true; },
    async autoEnabled(chatId) { await ensure(); const r = await pool.query('SELECT auto_mode FROM telegram_group_assistant_chats WHERE chat_id=$1 AND enabled=TRUE', [chatId]); return r.rows[0]?.auto_mode === true; },
    async setAuto(chatId, actorId, enabled) { await ensure(); await pool.query(`INSERT INTO telegram_group_assistant_chats(chat_id,activated_by,enabled,auto_mode) VALUES($1,$2,$3,$3) ON CONFLICT(chat_id) DO UPDATE SET auto_mode=$3,enabled=CASE WHEN $3 THEN TRUE ELSE telegram_group_assistant_chats.enabled END,updated_at=NOW(),activated_by=$2`, [chatId, actorId, enabled]); },
    async activate(chatId, actorId, enabled) {
      await ensure();
      await pool.query(`INSERT INTO telegram_group_assistant_chats(chat_id,activated_by,enabled) VALUES($1,$2,$3)
        ON CONFLICT(chat_id) DO UPDATE SET auto_mode=CASE WHEN EXCLUDED.enabled THEN telegram_group_assistant_chats.auto_mode ELSE FALSE END,enabled=EXCLUDED.enabled,activated_by=EXCLUDED.activated_by,updated_at=NOW()`, [chatId, actorId, enabled]);
    },
    async reserve(chatId) {
      await ensure(); const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const global = await db.query(`INSERT INTO telegram_group_assistant_usage(usage_day,requests) VALUES((NOW() AT TIME ZONE 'Asia/Tashkent')::date,1)
          ON CONFLICT(usage_day) DO UPDATE SET requests=telegram_group_assistant_usage.requests+1 WHERE telegram_group_assistant_usage.requests<$1 RETURNING requests`, [globalLimit]);
        if (!global.rowCount) { await db.query('ROLLBACK'); return false; }
        const group = await db.query(`UPDATE telegram_group_assistant_chats SET usage_day=(NOW() AT TIME ZONE 'Asia/Tashkent')::date,
          requests_today=CASE WHEN usage_day=(NOW() AT TIME ZONE 'Asia/Tashkent')::date THEN requests_today+1 ELSE 1 END
          WHERE chat_id=$1 AND enabled=TRUE AND (usage_day IS DISTINCT FROM (NOW() AT TIME ZONE 'Asia/Tashkent')::date OR requests_today<$2) RETURNING chat_id`, [chatId, groupLimit]);
        if (!group.rowCount) { await db.query('ROLLBACK'); return false; }
        await db.query('COMMIT'); return true;
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      finally { db.release(); }
    },
  };
}
module.exports = { createGroupAssistantStore };
