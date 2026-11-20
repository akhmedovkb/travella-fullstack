const { randomBytes, createHash } = require('node:crypto');
const { redactQuestion } = require('./groupAssistantModel');
const hash = token => createHash('sha256').update(String(token)).digest('hex');
function createGroupAssistantHandoffs(pool) {
  let ready;
  async function initialize() {
    if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS telegram_assistant_handoffs (
      token_hash TEXT PRIMARY KEY, owner_id BIGINT, group_chat_id BIGINT NOT NULL,
      thread_id BIGINT, group_title TEXT NOT NULL DEFAULT '', question TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(error => { ready = null; throw error; });
    return ready;
  }
  return {
    initialize,
    async create({ ownerId = null, groupId, topicId = null, title = '', question = '' }) {
      await initialize();
      const token = randomBytes(24).toString('hex');
      await pool.query('DELETE FROM telegram_assistant_handoffs WHERE expires_at<NOW()');
      await pool.query(`INSERT INTO telegram_assistant_handoffs(token_hash,owner_id,group_chat_id,thread_id,group_title,question,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,NOW()+CASE WHEN $2::bigint IS NULL THEN INTERVAL '30 days' ELSE INTERVAL '15 minutes' END)`,
      [hash(token), ownerId, groupId, topicId, String(title).slice(0,150), redactQuestion(question)]);
      return token;
    },
    async update(token, ownerId, question) {
      await initialize();
      await pool.query('UPDATE telegram_assistant_handoffs SET question=$3 WHERE token_hash=$1 AND owner_id=$2 AND expires_at>NOW()', [hash(token),ownerId,redactQuestion(question)]);
    },
    async get(token, actorId) {
      await initialize();
      const result = await pool.query(`SELECT group_chat_id,thread_id,group_title,question FROM telegram_assistant_handoffs
        WHERE token_hash=$1 AND (owner_id IS NULL OR owner_id=$2) AND expires_at>NOW()`,[hash(token),actorId]);
      const row=result.rows[0];
      return row ? { groupId:Number(row.group_chat_id),topicId:row.thread_id ? Number(row.thread_id) : null,title:row.group_title,question:row.question } : null;
    },
  };
}
module.exports = { createGroupAssistantHandoffs };
