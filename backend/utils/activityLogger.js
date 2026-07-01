// backend/utils/activityLogger.js
// Unified low-risk audit/activity logger for web API, admin actions, Telegram bot and payment callbacks.
// This logger must never break product flows: every public function catches its own errors.

const pool = require("../db");

let ensured = false;

function cleanText(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function toInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function pickIp(req) {
  const xf = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req?.ip || req?.socket?.remoteAddress || null;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const blocked = /token|secret|password|authorization|cookie|hash|sign_string|card|pan|key/i;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (blocked.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (v === undefined) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" ? v.slice(0, 1000) : v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 30).map((x) => (typeof x === "object" ? "[object]" : x));
    } else {
      out[k] = "[object]";
    }
  }
  return out;
}

async function ensureActivityEventsTable(db = pool) {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_role TEXT,
      actor_id BIGINT,
      actor_name TEXT,
      actor_phone TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL,
      event_name TEXT NOT NULL,
      page_path TEXT,
      page_title TEXT,
      element_text TEXT,
      element_tag TEXT,
      element_role TEXT,
      element_href TEXT,
      service_id BIGINT,
      provider_id BIGINT,
      client_id BIGINT,
      source TEXT,
      user_agent TEXT,
      ip INET,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events (created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_actor ON activity_events (actor_role, actor_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_service ON activity_events (service_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_provider ON activity_events (provider_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_client ON activity_events (client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_event_name ON activity_events (event_name, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_event_type ON activity_events (event_type, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events (session_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_events_source ON activity_events (source, created_at DESC)`);
  ensured = true;
}

async function logActivityEvent(event = {}, db = pool) {
  try {
    await ensureActivityEventsTable(db);
    const meta = sanitizeMeta(event.meta || {});
    await db.query(
      `
      INSERT INTO activity_events (
        actor_role, actor_id, actor_name, actor_phone,
        session_id, event_type, event_name,
        page_path, page_title,
        element_text, element_tag, element_role, element_href,
        service_id, provider_id, client_id,
        source, user_agent, ip, meta
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
      `,
      [
        cleanText(event.actorRole || event.actor_role, 60),
        toInt(event.actorId || event.actor_id),
        cleanText(event.actorName || event.actor_name, 160),
        cleanText(event.actorPhone || event.actor_phone, 80),
        cleanText(event.sessionId || event.session_id, 160),
        cleanText(event.eventType || event.event_type, 80) || "event",
        cleanText(event.eventName || event.event_name, 160) || "unknown_event",
        cleanText(event.pagePath || event.page_path, 700),
        cleanText(event.pageTitle || event.page_title, 250),
        cleanText(event.elementText || event.element_text, 500),
        cleanText(event.elementTag || event.element_tag, 80),
        cleanText(event.elementRole || event.element_role, 100),
        cleanText(event.elementHref || event.element_href, 900),
        toInt(event.serviceId || event.service_id),
        toInt(event.providerId || event.provider_id),
        toInt(event.clientId || event.client_id),
        cleanText(event.source, 100) || "unknown",
        cleanText(event.userAgent || event.user_agent, 1000),
        event.ip || null,
        JSON.stringify(meta),
      ]
    );
    return true;
  } catch (e) {
    console.error("[activity] log failed:", e?.message || e);
    return false;
  }
}

function inferApiEventName(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const clean = path
    .replace(/^\/api\//, "")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/[^a-zA-Z0-9_/:.-]+/g, "_")
    .replace(/[/:.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `api_${method.toLowerCase()}_${clean || "root"}`;
}

function extractApiIds(req) {
  const b = req.body || {};
  const q = req.query || {};
  const p = req.params || {};
  const serviceId = p.serviceId || p.service_id || b.serviceId || b.service_id || q.serviceId || q.service_id || b.service_id;
  const providerId = p.providerId || p.provider_id || b.providerId || b.provider_id || q.providerId || q.provider_id;
  const clientId = p.clientId || p.client_id || b.clientId || b.client_id || q.clientId || q.client_id;
  return { serviceId, providerId, clientId };
}

function activityAuditMiddleware(options = {}) {
  const skip = options.skip || ((req) => {
    const path = String(req.originalUrl || req.url || "");
    if (!path.startsWith("/api")) return true;
    if (path.startsWith("/api/activity/track")) return true;
    if (path.includes("/health")) return true;
    return false;
  });

  return function activityAudit(req, res, next) {
    if (skip(req)) return next();
    const method = String(req.method || "GET").toUpperCase();
    const shouldLog = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    if (!shouldLog) return next();

    const startedAt = Date.now();
    res.on("finish", () => {
      const ids = extractApiIds(req);
      const user = req.user || {};
      logActivityEvent({
        source: "api",
        eventType: "api_request",
        eventName: inferApiEventName(req),
        actorRole: user.role || user.type || null,
        actorId: user.id || user.userId || user.clientId || user.providerId || null,
        pagePath: String(req.originalUrl || req.url || "").slice(0, 700),
        serviceId: ids.serviceId,
        providerId: ids.providerId,
        clientId: ids.clientId,
        userAgent: req.headers?.["user-agent"],
        ip: pickIp(req),
        meta: {
          method,
          status_code: res.statusCode,
          duration_ms: Date.now() - startedAt,
          params: req.params || {},
          query: req.query || {},
          body_keys: req.body && typeof req.body === "object" ? Object.keys(req.body).slice(0, 60) : [],
          route: req.route?.path || null,
        },
      }).catch(() => {});
    });
    return next();
  };
}

function telegramActivityMiddleware() {
  return async function telegramActivity(ctx, next) {
    const startedAt = Date.now();
    const from = ctx.from || {};
    const chat = ctx.chat || {};
    const cb = ctx.callbackQuery || null;
    const msg = ctx.message || ctx.editedMessage || null;
    const text = msg?.text || msg?.caption || "";
    const data = cb?.data || "";
    const eventName = cb
      ? "telegram_callback"
      : msg?.contact
        ? "telegram_contact"
        : msg?.successful_payment
          ? "telegram_successful_payment"
          : text && text.startsWith("/")
            ? `telegram_command_${text.split(/\s+/)[0].replace(/^\//, "").slice(0, 60)}`
            : "telegram_message";

    try {
      await next();
      logActivityEvent({
        source: "telegram_bot",
        eventType: "telegram_update",
        eventName,
        actorRole: ctx.session?.role || ctx.session?.requestedRole || null,
        actorId: from.id || null,
        actorName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || null,
        actorPhone: msg?.contact?.phone_number || null,
        sessionId: `tg_${from.id || chat.id || "unknown"}`,
        elementText: cb ? String(data).slice(0, 500) : String(text).slice(0, 500),
        elementTag: cb ? "callback_query" : "message",
        userAgent: "Telegram Bot API",
        meta: {
          update_type: ctx.updateType,
          chat_id: chat.id || null,
          chat_type: chat.type || null,
          username: from.username || null,
          message_id: msg?.message_id || cb?.message?.message_id || null,
          has_contact: !!msg?.contact,
          has_successful_payment: !!msg?.successful_payment,
          duration_ms: Date.now() - startedAt,
        },
      }).catch(() => {});
    } catch (e) {
      logActivityEvent({
        source: "telegram_bot",
        eventType: "telegram_error",
        eventName: `${eventName}_error`,
        actorRole: ctx.session?.role || ctx.session?.requestedRole || null,
        actorId: from.id || null,
        actorName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || null,
        sessionId: `tg_${from.id || chat.id || "unknown"}`,
        elementText: cb ? String(data).slice(0, 500) : String(text).slice(0, 500),
        elementTag: cb ? "callback_query" : "message",
        userAgent: "Telegram Bot API",
        meta: { update_type: ctx.updateType, error: e?.message || String(e), duration_ms: Date.now() - startedAt },
      }).catch(() => {});
      throw e;
    }
  };
}

module.exports = {
  ensureActivityEventsTable,
  logActivityEvent,
  activityAuditMiddleware,
  telegramActivityMiddleware,
};
