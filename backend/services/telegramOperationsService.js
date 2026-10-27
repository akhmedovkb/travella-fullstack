const pool = require("../db");

const CATEGORIES = new Set(["general", "booking", "payment", "review", "technical"]);
const TOGGLES = new Set(["booking_updates", "request_updates", "review_updates", "learning_updates", "marketing_updates"]);
let schemaPromise;

async function ensureTelegramOperationsSchema(db = pool) {
  if (db === pool && schemaPromise) return schemaPromise;
  const run = db.query(`
    CREATE TABLE IF NOT EXISTS telegram_support_tickets (
      id BIGSERIAL PRIMARY KEY, actor_role VARCHAR(16) NOT NULL, actor_id BIGINT NOT NULL,
      chat_id TEXT NOT NULL, category VARCHAR(32) NOT NULL, booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
      review_id BIGINT REFERENCES reviews(id) ON DELETE SET NULL, message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open', priority VARCHAR(12) NOT NULL DEFAULT 'normal',
      admin_note TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_support_tickets_actor ON telegram_support_tickets(actor_role, actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_telegram_support_tickets_queue ON telegram_support_tickets(status, priority, created_at);
    CREATE TABLE IF NOT EXISTS telegram_notification_preferences (
      actor_role VARCHAR(16) NOT NULL, actor_id BIGINT NOT NULL, chat_id TEXT NOT NULL,
      booking_updates BOOLEAN NOT NULL DEFAULT TRUE, request_updates BOOLEAN NOT NULL DEFAULT TRUE,
      review_updates BOOLEAN NOT NULL DEFAULT TRUE, learning_updates BOOLEAN NOT NULL DEFAULT TRUE,
      marketing_updates BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(actor_role, actor_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_bot_events (
      id BIGSERIAL PRIMARY KEY, actor_role VARCHAR(16), actor_id BIGINT, chat_id TEXT,
      event_type VARCHAR(48) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_bot_events_type_date ON telegram_bot_events(event_type, created_at DESC);
    ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_text TEXT;
    ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ;
  `);
  if (db === pool) schemaPromise = run.catch((error) => { schemaPromise = null; throw error; });
  return run;
}

async function resolveActor(role, telegramId, db = pool) {
  const id = String(telegramId || "");
  if (role === "provider") {
    const result = await db.query(`SELECT id,name FROM providers WHERE $1=ANY(ARRAY[telegram_refused_chat_id::text,telegram_chat_id::text,tg_chat_id::text,telegram_web_chat_id::text]) LIMIT 1`, [id]);
    return result.rows[0] || null;
  }
  const result = await db.query(`SELECT id,COALESCE(NULLIF(to_jsonb(clients)->>'full_name',''),NULLIF(to_jsonb(clients)->>'name',''),'Клиент') AS name FROM clients WHERE telegram_chat_id::text=$1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

async function createTicket({ role, telegramId, category, message, bookingId = null, reviewId = null }, db = pool) {
  await ensureTelegramOperationsSchema(db);
  if (!CATEGORIES.has(category)) throw new Error("invalid_category");
  const clean = String(message || "").trim();
  if (clean.length < 5) throw new Error("message_too_short");
  const actor = await resolveActor(role, telegramId, db);
  if (!actor) throw new Error("actor_not_found");
  let safeBookingId = Number(bookingId) || null;
  let safeReviewId = Number(reviewId) || null;
  if (safeBookingId) {
    const owned = await db.query(
      `SELECT id FROM bookings WHERE id=$1 AND ($2='client' AND client_id=$3 OR $2='provider' AND (provider_id=$3 OR NULLIF(to_jsonb(bookings)->>'requester_provider_id','')::bigint=$3))`,
      [safeBookingId, role, actor.id]
    );
    if (!owned.rowCount) safeBookingId = null;
  }
  if (safeReviewId) {
    const targetType = role === "provider" ? "provider" : "client";
    const owned = await db.query(`SELECT id FROM reviews WHERE id=$1 AND target_type=$2 AND target_id=$3`, [safeReviewId, targetType, actor.id]);
    if (!owned.rowCount) safeReviewId = null;
  }
  const priority = category === "payment" ? "high" : "normal";
  const result = await db.query(
    `INSERT INTO telegram_support_tickets(actor_role,actor_id,chat_id,category,booking_id,review_id,message,priority)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [role, actor.id, String(telegramId), category, safeBookingId, safeReviewId, clean.slice(0, 4000), priority]
  );
  return { ...result.rows[0], actor_name: actor.name };
}

async function listTickets(role, telegramId, db = pool) {
  await ensureTelegramOperationsSchema(db);
  const actor = await resolveActor(role, telegramId, db);
  if (!actor) return [];
  const result = await db.query(`SELECT * FROM telegram_support_tickets WHERE actor_role=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 10`, [role, actor.id]);
  return result.rows;
}

async function getPreferences(role, telegramId, db = pool) {
  await ensureTelegramOperationsSchema(db);
  const actor = await resolveActor(role, telegramId, db);
  if (!actor) return null;
  const result = await db.query(
    `INSERT INTO telegram_notification_preferences(actor_role,actor_id,chat_id) VALUES($1,$2,$3)
     ON CONFLICT(actor_role,actor_id) DO UPDATE SET chat_id=EXCLUDED.chat_id RETURNING *`,
    [role, actor.id, String(telegramId)]
  );
  return result.rows[0];
}

async function togglePreference(role, telegramId, key, db = pool) {
  if (!TOGGLES.has(key)) throw new Error("invalid_preference");
  const current = await getPreferences(role, telegramId, db);
  if (!current) throw new Error("actor_not_found");
  const result = await db.query(`UPDATE telegram_notification_preferences SET ${key}=NOT ${key},updated_at=NOW() WHERE actor_role=$1 AND actor_id=$2 RETURNING *`, [role, current.actor_id]);
  return result.rows[0];
}

async function logEvent({ role = null, actorId = null, chatId = null, type, metadata = {} }, db = pool) {
  await ensureTelegramOperationsSchema(db);
  await db.query(`INSERT INTO telegram_bot_events(actor_role,actor_id,chat_id,event_type,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`, [role, actorId, chatId ? String(chatId) : null, type, JSON.stringify(metadata)]);
}

async function getAdminSummary(db = pool) {
  await ensureTelegramOperationsSchema(db);
  const result = await db.query(`SELECT
    COUNT(*) FILTER(WHERE status IN ('open','in_progress'))::int AS open_tickets,
    COUNT(*) FILTER(WHERE priority IN ('high','critical') AND status IN ('open','in_progress'))::int AS urgent_tickets,
    COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '24 hours')::int AS tickets_24h,
    (SELECT COUNT(*)::int FROM telegram_learning_enrollments WHERE status='active') AS active_learners,
    (SELECT COUNT(*)::int FROM telegram_learning_deliveries WHERE status='failed' AND created_at>=NOW()-INTERVAL '24 hours') AS failed_learning_24h
    FROM telegram_support_tickets`);
  return result.rows[0];
}

async function updateTicketStatus(ticketId, status, adminNote = null, db = pool) {
  await ensureTelegramOperationsSchema(db);
  if (!["in_progress", "resolved", "closed"].includes(status)) throw new Error("invalid_status");
  const result = await db.query(
    `UPDATE telegram_support_tickets SET status=$2,admin_note=COALESCE($3,admin_note),
       resolved_at=CASE WHEN $2 IN ('resolved','closed') THEN NOW() ELSE NULL END,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [Number(ticketId), status, adminNote]
  );
  return result.rows[0] || null;
}

module.exports = { CATEGORIES, TOGGLES, ensureTelegramOperationsSchema, resolveActor, createTicket, listTickets, getPreferences, togglePreference, logEvent, getAdminSummary, updateTicketStatus };
