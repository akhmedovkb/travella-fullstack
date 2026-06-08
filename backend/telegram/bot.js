// backend/telegram/bot.js
require("dotenv").config();

const { Telegraf, session, Markup } = require("telegraf");
const axiosBase = require("axios");
const {
  parseDateFlexible,
  isServiceActual,
  normalizeDateTimeInput: normalizeDateTimeInputHelper,
} = require("./helpers/serviceActual");
const { buildSvcActualKeyboard } = require("./keyboards/serviceActual");
const { handleServiceActualCallback } = require("./handlers/serviceActualHandler");
const { buildServiceMessage } = require("../utils/telegramServiceCard");
const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");
const {
  createProviderSupportDonationOrder,
  getProviderSupportSettings,
} = require("../controllers/providerSupportController");

/* ===================== CONFIG ===================== */
const OFFER_VERSION = process.env.OFFER_VERSION || "v1.0";
const CALLBACK_SECRET = (process.env.TG_CALLBACK_SECRET || "").trim();
// TTL подписи кнопок (сек)
const CALLBACK_TTL_SEC = Number(process.env.TG_CALLBACK_TTL_SEC || 180); // 15 минут
const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
if (!CLIENT_TOKEN) {
  throw new Error(
    "TELEGRAM_CLIENT_BOT_TOKEN is required for backend/telegram/bot.js"
  );
}
const BOT_TOKEN = CLIENT_TOKEN;

// Username бота (без @). Нужен для стабильных ссылок в inline.
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "")
  .replace(/^@/, "")
  .trim();

// Шаблон ссылки на карточку услуги на сайте.
const SERVICE_URL_TEMPLATE = (
  process.env.SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}"
).trim();

// Публичный URL Travella для кнопок "Подробнее"
const SITE_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

// ⚠️ Плейсхолдер НЕ форсим — лучше article без thumb_url, чем 404 -> "Не найдено"
const INLINE_PLACEHOLDER_THUMB = "";

function buildPaymeGuideUrlForTelegram(payUrl, options = {}) {
  const url = String(payUrl || "").trim();
  if (!url) return "";

  const params = new URLSearchParams();
  params.set("pay_url", url);
  if (options.purpose) params.set("purpose", String(options.purpose));
  if (options.amount != null && options.amount !== "") params.set("amount", String(options.amount));
  if (options.orderId != null && options.orderId !== "") params.set("order_id", String(options.orderId));
  if (options.serviceId != null && options.serviceId !== "") params.set("service_id", String(options.serviceId));

  return `${SITE_URL}/payme/guide?${params.toString()}`;
}

const PAYME_CARD_ONLY_HINT =
  "⚠️ <b>Важно перед оплатой Payme</b>\n\n" +
  "На странице Payme вводите только:\n" +
  "💳 номер карты\n" +
  "📅 срок действия карты\n\n" +
  "<b>Не вводите телефон для авторизации Payme.</b> Это необязательно для оплаты картой и может задержать SMS/оплату.";

// Кому отправлять "быстрые запросы" из бота
const MANAGER_CHAT_ID = process.env.TELEGRAM_MANAGER_CHAT_ID || "";

// Валюта отображения цены
const PRICE_CURRENCY = (process.env.PRICE_CURRENCY || "USD").trim();

// Для /tour_123 и inline-поиска — работаем с отказными категориями
const { REFUSED_CATEGORIES, PROOF_REQUIRED_CATEGORIES } = require("../utils/serviceCategories");
const { logProviderFunnelEvent } = require("../utils/providerFunnel");

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

// Публичная база для отдачи картинок (если API проксируется через домен)
const API_PUBLIC_BASE = (
  process.env.API_PUBLIC_URL ||
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  process.env.SITE_API_URL ||
  SITE_URL
).replace(/\/+$/, "");

// ✅ ВАЖНО для Telegram inline-картинок:
// Используем прямой публичный backend (Railway), НЕ сайт (travella.uz), чтобы не было редиректов/прокси.
const TG_IMAGE_BASE = (
  process.env.TG_IMAGE_BASE ||            // <-- добавим в env (Railway URL)
  process.env.API_PUBLIC_URL ||           // если уже задано, тоже ок
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  API_BASE                                // fallback
).replace(/\/+$/, "");

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] Using TELEGRAM_CLIENT_BOT_TOKEN (polling)");
console.log("[tg-bot] API_BASE =", API_BASE);
console.log("[tg-bot] API_PUBLIC_BASE =", API_PUBLIC_BASE || "(not set)");
console.log("[tg-bot] TG_IMAGE_BASE =", TG_IMAGE_BASE || "(not set)");
console.log("[tg-bot] SITE_URL =", SITE_URL);
console.log("[tg-bot] BOT_USERNAME =", BOT_USERNAME || "(not set)");
console.log("[tg-bot] SERVICE_URL_TEMPLATE =", SERVICE_URL_TEMPLATE);
console.log(
  "[tg-bot] MANAGER_CHAT_ID =",
  MANAGER_CHAT_ID ? MANAGER_CHAT_ID : "(not set)"
);
console.log("[tg-bot] PRICE_CURRENCY =", PRICE_CURRENCY);

// =====================
// HMAC SIGN / VERIFY
// =====================

function signUnlockPayload({ serviceId, clientId, ts }) {
  const payload = `${serviceId}:${clientId}:${ts}`;
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 16); // короткая подпись
}

function verifyUnlockPayload({ serviceId, clientId, ts, sig }) {
  if (!sig) return false;

  // TTL защита
  const now = Date.now();
  if (Math.abs(now - Number(ts)) > HMAC_TTL_MS) {
    return false;
  }

  const expected = signUnlockPayload({ serviceId, clientId, ts });

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(sig)
    );
  } catch {
    return false;
  }
}

/* ===================== PROCESS HARD SHIELD ===================== */
process.on("unhandledRejection", (reason) => {
  console.error("[tg-bot] UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[tg-bot] UNCAUGHT EXCEPTION:", err);
});

/* ===================== AXIOS ===================== */

const axios = axiosBase.create({
  baseURL: API_BASE,
  timeout: 10000,
});

function guessMimeByPath(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function tgFileIdToDataUrlForProof(fileId) {
  if (!fileId) return null;

  const link = await bot.telegram.getFileLink(fileId);
  const url = String(link || "").trim();
  if (!url) return null;

  const r = await axiosBase.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
  });

  const buf = Buffer.from(r.data);
  const MAX = 6 * 1024 * 1024; // 6MB
  if (!buf.length || buf.length > MAX) return null;

  let pathname = "";
  try {
    pathname = new URL(url).pathname || "";
  } catch {
    pathname = "";
  }

  const mime = guessMimeByPath(pathname);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/* ===================== PG ADVISORY LOCK (ANTI DOUBLE SPEND) ===================== */

async function withServiceLock(pool, clientId, serviceId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // BANK-GRADE: advisory lock на пару (clientId, serviceId) в ЭТОЙ же транзакции
    // Лучше использовать hashtext (меньше риска переполнений)
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`unlock:${Number(clientId)}:${Number(serviceId)}`]
    );

    const res = await fn(client);

    await client.query("COMMIT");
    return res;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/* ===================== CONTACT UNLOCK (per service) ===================== */

// Legacy fallback из env. Реальная цена открытия контактов берётся из БД через contact_unlock_settings.
const CONTACT_UNLOCK_PRICE = Number(process.env.CONTACT_UNLOCK_PRICE || "10000");

// =========================
// Telegram Payments (top-up inside bot)
// =========================
// Set provider token via @BotFather → Payments.
// Example env: TELEGRAM_PAYMENTS_PROVIDER_TOKEN=12345:TEST:...
const PAYMENTS_PROVIDER_TOKEN =
  process.env.TELEGRAM_PAYMENTS_PROVIDER_TOKEN ||
  process.env.TG_PAYMENTS_TOKEN ||
  process.env.PAYMENTS_PROVIDER_TOKEN ||
  "";
const PAYMENTS_CURRENCY = String(process.env.TELEGRAM_PAYMENTS_CURRENCY || "UZS");
const TOPUP_AMOUNTS = [10000, 50000, 100000];
function currencyMinorFactor(ccy) {
  const c = String(ccy || "").toUpperCase().trim();
  if (c === "UZS") return 100;
  if (c === "RUB") return 100;
  if (c === "USD") return 100;
  if (c === "EUR") return 100;
  return 1;
}
function tiyinToSum(x) {
  const n = Number(x || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n / 100);
}
function buildPaymeCheckoutUrl({ merchantId, checkoutBase, orderId, amountTiyin, lang, callbackUrl }) {
  const parts = [
    `m=${merchantId}`,
    `ac.order_id=${orderId}`,
    `a=${amountTiyin}`, // в тийинах :contentReference[oaicite:5]{index=5}
    `l=${lang || "ru"}`,
  ];
  if (callbackUrl) parts.push(`c=${callbackUrl}`);
  const params = parts.join(";");
  const b64 = Buffer.from(params, "utf8").toString("base64");
  return `${checkoutBase.replace(/\/+$/, "")}/${b64}`;
}

// Создаём таблицы (на всякий случай), но SQL миграцию всё равно лучше прогнать отдельно
let _unlockTablesReady = false;

async function ensureUnlockTables(pool) {
  if (!pool || _unlockTablesReady) return;

  try {
    // 1) баланс клиента
    await pool.query(`
      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS contact_balance INTEGER NOT NULL DEFAULT 0;
    `);

    // 2) таблица unlock (у тебя уже была)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_service_contact_unlocks (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NOT NULL,
        service_id BIGINT NOT NULL,
        price_charged INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (client_id, service_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cs_unlocks_client
      ON client_service_contact_unlocks(client_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cs_unlocks_service
      ON client_service_contact_unlocks(service_id);
    `);

    // 3) ledger таблица (если уже есть — просто ничего не сделает)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_balance_ledger (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        service_id BIGINT,
        source TEXT,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_ledger_client
      ON contact_balance_ledger(client_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_ledger_service
      ON contact_balance_ledger(service_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_ledger_reason
      ON contact_balance_ledger(reason);
    `);

    // ✅ ВАЖНО: bank-grade идемпотентность списания unlock
    // один unlock = одно списание (client_id, service_id, reason='unlock_contacts')
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_ledger_unlock_once
      ON contact_balance_ledger (client_id, service_id, reason)
      WHERE reason = 'unlock_contacts';
    `);

    _unlockTablesReady = true;
  } catch (e) {
    console.error("[tg-bot] ensureUnlockTables error:", e?.message || e);
    _unlockTablesReady = false;
  }
}

// найти client по telegram_chat_id
async function getClientRowByChatId(pool, chatId) {
  if (!pool) return null;

  const cid = Number(chatId);
  if (!Number.isFinite(cid) || cid <= 0) return null;

  try {
    // 1) client id
    const r = await pool.query(
      `SELECT id
         FROM clients
        WHERE telegram_chat_id = $1
        LIMIT 1`,
      [cid]
    );
    const row = r.rows?.[0] || null;
    if (!row?.id) return null;

    return { id: Number(row.id) };
  } catch (e) {
    console.error("[tg-bot] getClientRowByChatId error:", e?.message || e);
    return null;
  }
}

/* ===================== BALANCE (UNIFIED READS) ===================== */

const _tgBalanceCache = { cols: new Map() };

async function getRelationColumns(pool, relName, schema = "public") {
  const key = `${schema}.${relName}`;
  if (_tgBalanceCache.cols.has(key)) return _tgBalanceCache.cols.get(key);

  const { rows } = await pool.query(
    `
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
  `,
    [schema, relName]
  );
  const set = new Set((rows || []).map((r) => r.column_name));
  _tgBalanceCache.cols.set(key, set);
  return set;
}

async function hasRelation(pool, relName, schema = "public") {
  try {
    // tables
    const t = await pool.query(
      `
      SELECT 1
        FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = $2
       LIMIT 1
    `,
      [schema, relName]
    );
    if (t.rows?.length) return true;

    // views
    const v = await pool.query(
      `
      SELECT 1
        FROM information_schema.views
       WHERE table_schema = $1
         AND table_name = $2
       LIMIT 1
    `,
      [schema, relName]
    );
    return !!v.rows?.length;
  } catch {
    return false;
  }
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function getClientBalanceUnified(pool, clientId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS bal
       FROM contact_balance_ledger
      WHERE client_id = $1`,
    [Number(clientId)]
  );
  return toNum(r.rows?.[0]?.bal);
}

async function getLastBalanceOpsUnified(pool, clientId, limit = 5) {
  const hasView = await hasRelation(pool, "v_client_balance_ledger_all");
  if (hasView) {
    const cols = await getRelationColumns(pool, "v_client_balance_ledger_all").catch(() => new Set());
    const hasServiceId = cols.has("service_id");
    const hasReason = cols.has("reason");
    const hasSource = cols.has("source");
    const hasCreatedAt = cols.has("created_at");
    const hasId = cols.has("id");

    const sel = [
      hasId ? "id" : "NULL::bigint AS id",
      "client_id",
      "amount",
      hasReason ? "reason" : "NULL::text AS reason",
      hasServiceId ? "service_id" : "NULL::bigint AS service_id",
      hasSource ? "source" : "NULL::text AS source",
      hasCreatedAt ? "created_at" : "now() AS created_at",
    ].join(", ");

    const order = `${hasCreatedAt ? "created_at" : "1"} DESC, ${hasId ? "id" : "1"} DESC`;

    const r = await pool.query(
      `
      SELECT ${sel}
        FROM v_client_balance_ledger_all
       WHERE client_id = $1
       ORDER BY ${order}
       LIMIT $2
      `,
      [Number(clientId), Math.max(1, Math.min(25, Number(limit) || 5))]
    );
    return r.rows || [];
  }

  // fallback
  const r = await pool.query(
    `
    SELECT id, client_id, amount, reason, service_id, source, created_at
      FROM contact_balance_ledger
     WHERE client_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2
    `,
    [Number(clientId), Math.max(1, Math.min(25, Number(limit) || 5))]
  );
  return r.rows || [];
}

// транзакция: если уже unlocked — не списываем повторно
async function unlockContactsForService(db, { clientId, serviceId, price }) {
  const safePrice = Math.abs(Number(price) || 0);

  // 1. lock клиента
  await db.query(`SELECT id FROM clients WHERE id=$1 FOR UPDATE`, [clientId]);

  // 2. уже открыт?
  const existing = await db.query(
    `
    SELECT id
    FROM client_service_contact_unlocks
    WHERE client_id=$1 AND service_id=$2
    LIMIT 1
    `,
    [clientId, serviceId]
  );

  if (existing.rows.length) {
    const balance = await getClientBalanceUnified(db, clientId);
  
    return {
      ok: true,
      already: true,
      balance: Number(balance || 0),
    };
  }

  // 3. баланс через ledger
  const balance = Number(await getClientBalanceUnified(db, clientId) || 0);

  if (balance < safePrice) {
    return {
      ok: false,
      reason: "no_balance",
      balance,
      need: safePrice,
    };
  }

  // 4. фиксируем unlock
  await db.query(
    `
    INSERT INTO client_service_contact_unlocks
      (client_id, service_id, price_charged, source)
    VALUES ($1,$2,$3,'telegram')
    ON CONFLICT DO NOTHING
    `,
    [clientId, serviceId, safePrice]
  );

  // 5. списание через ledger
  await db.query(
    `
    INSERT INTO contact_balance_ledger
      (client_id, amount, reason, service_id, source, meta)
    VALUES ($1,$2,'unlock_contact',$3,'telegram',$4::jsonb)
    `,
    [
      clientId,
      -safePrice,
      serviceId,
      JSON.stringify({ service_id: serviceId }),
    ]
  );

  const newBal = await getClientBalanceUnified(db, clientId);

  return {
    ok: true,
    already: false,
    charged: safePrice,
    balance: Number(newBal || 0),
  };
}

// ===================== CONTACT BALANCE (top-up) =====================
// Credit/debit contact balance via the canonical ledger table used by admin UI.
async function addContactBalanceLedgerTx(db, {
  clientId,
  amount,
  reason,
  serviceId = null,
  source = "bot",
  meta = {},
}) {
  const cid = Number(clientId);
  const amt = Number(amount);
  if (!Number.isFinite(cid) || cid <= 0) throw new Error("bad clientId");
  if (!Number.isFinite(amt) || amt === 0) throw new Error("bad amount");

  const r1 = await db.query(
    `INSERT INTO contact_balance_ledger (client_id, amount, reason, service_id, source, meta)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [cid, Math.trunc(amt), String(reason || "bot"), serviceId, String(source || "bot"), meta || {}]
  );

  const r2 = await db.query(
    `SELECT COALESCE(SUM(amount),0) AS balance
       FROM contact_balance_ledger
      WHERE client_id = $1`,
    [cid]
  );

  return {
    ledger_id: r1.rows?.[0]?.id,
    balance: Number(r2.rows?.[0]?.balance || 0),
  };
}

// проверить: клиент уже открыл контакты по этой услуге?
async function isContactsUnlocked(pool, { clientId, serviceId }) {
  if (!pool) return false;
  await ensureUnlockTables(pool);

  const cid = Number(clientId);
  const sid = Number(serviceId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(sid) || sid <= 0) return false;

  try {
    const r = await pool.query(
      `SELECT 1
         FROM client_service_contact_unlocks
        WHERE client_id=$1 AND service_id=$2
        LIMIT 1`,
      [cid, sid]
    );
    return !!r.rowCount;
  } catch (e) {
    console.error("[tg-bot] isContactsUnlocked error:", e?.message || e);
    return false;
  }
}

// для inline: получить множество service_id, которые уже unlocked
async function getUnlockedServiceIdSet(pool, { clientId, serviceIds }) {
  const out = new Set();
  if (!pool) return out;
  await ensureUnlockTables(pool);

  const cid = Number(clientId);
  const ids = (serviceIds || [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!Number.isFinite(cid) || cid <= 0 || !ids.length) return out;

  try {
    const r = await pool.query(
      `SELECT service_id
         FROM client_service_contact_unlocks
        WHERE client_id=$1 AND service_id = ANY($2::bigint[])`,
      [cid, ids]
    );
    for (const row of r.rows || []) {
      const sid = Number(row.service_id);
      if (Number.isFinite(sid)) out.add(sid);
    }
  } catch (e) {
    console.error("[tg-bot] getUnlockedServiceIdSet error:", e?.message || e);
  }
  return out;
}

/* ===================== UNLOCK HELPERS (UI gating) ===================== */

/* ===================== ENTERPRISE SAFE HELPERS ===================== */

// безопасный answerCbQuery
async function safeCb(ctx, text, alert = false) {
  try {
    await ctx.answerCbQuery(text, { show_alert: alert });
  } catch {}
}

// проверка принятия оферты
async function ensureOfferAccepted(chatId) {
  const q = await pool.query(
    `SELECT 1
       FROM user_offer_accepts
      WHERE user_role = 'client'
        AND user_id = $1
        AND offer_version = $2
      LIMIT 1`,
    [chatId, OFFER_VERSION]
  );
  return q.rowCount > 0;
}

// показать оферту
function cbNowSec() {
  return Math.floor(Date.now() / 1000);
}

/* ===================== SIGNED CALLBACK DATA (HMAC) ===================== */
const crypto = require("crypto");

const TG_CALLBACK_SECRET = String(process.env.TG_CALLBACK_SECRET || "").trim();
const TG_CALLBACK_TTL_SEC = Number(process.env.TG_CALLBACK_TTL_SEC || "900"); // 15 минут

function cbNowSec() {
  return Math.floor(Date.now() / 1000);
}

function signUnlock({ action, chatId, serviceId, ts }) {
  const base = `${action}|${chatId}|${serviceId}|${ts}`;
  const secret = TG_CALLBACK_SECRET;
  return crypto.createHmac("sha256", secret).update(base).digest("hex").slice(0, 12);
}

/**
 * u:<serviceId>:<chatId>:<ts>:<sig>
 */
function buildUnlockCbData(chatId, serviceId) {
  const ts = Math.floor(Date.now() / 1000);

  const sig = signUnlock({
    action: "u",
    chatId: Number(chatId),
    serviceId: Number(serviceId),
    ts,
  });

  return `u:${serviceId}:${chatId}:${ts}:${sig}`;
}

/**
 * verifyUnlockCbData принимает ОБЪЕКТ (как ты вызываешь сейчас)
 */
function verifyUnlockCbData(a, b, c, d) {
  let chatId, serviceId, ts, sig;

  if (a && typeof a === "object") {
    chatId = a.chatId;
    serviceId = a.serviceId;
    ts = a.ts;
    sig = a.sig;
  } else {
    chatId = a;
    serviceId = b;
    ts = c;
    sig = d;
  }

  if (!TG_CALLBACK_SECRET) {
    console.error("[tg-bot] TG_CALLBACK_SECRET is empty");
    return { ok: false, reason: "no_secret" };
  }

  const now = cbNowSec();
  const t = Number(ts);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad_ts" };

  // ✅ защита от будущего времени
  if (t > now + 30) return { ok: false, reason: "future_ts" };

  if (Math.abs(now - t) > TG_CALLBACK_TTL_SEC) return { ok: false, reason: "expired" };

  const cid = Number(chatId);
  const sid = Number(serviceId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, reason: "bad_chat" };
  if (!Number.isFinite(sid) || sid <= 0) return { ok: false, reason: "bad_service" };

  // signUnlock в этом файле уже возвращает первые 12 hex
  const expected = signUnlock({ action: "u", chatId: cid, serviceId: sid, ts: t });

  const sigStr = String(sig || "").trim().toLowerCase();
  // допускаем старые форматы (например 24 hex), сравниваем только первые 12
  if (!/^[a-f0-9]{12}$/.test(sigStr)) return { ok: false, reason: "bad_sig" };

  const exp = Buffer.from(String(expected), "utf8");
  const got = Buffer.from(sigStr.slice(0, 12), "utf8");
  if (exp.length !== got.length) return { ok: false, reason: "bad_sig" };

  try {
    if (!crypto.timingSafeEqual(exp, got)) return { ok: false, reason: "bad_sig" };
  } catch {
    return { ok: false, reason: "bad_sig" };
  }

  return { ok: true };
}
// ===================== OFFER GATE (BANK++) =====================

// использовать тот же секрет, что и для unlock (или отдельный)
const TG_OFFER_SECRET = TG_CALLBACK_SECRET; // можно вынести отдельным env при желании
const TG_OFFER_TTL_SEC = TG_CALLBACK_TTL_SEC; // TTL как у unlock

function signOfferAccept({ action, chatId, serviceId, ts }) {
  // action = "oa"
  const payload = `${action}:${chatId}:${serviceId}:${ts}`;
  return crypto.createHmac("sha256", String(TG_OFFER_SECRET)).update(payload).digest("hex");
}

function buildOfferAcceptCbData(chatId, serviceId) {
  const ts = cbNowSec();

  const fullSig = signOfferAccept({
    action: "oa",
    chatId: Number(chatId),
    serviceId: Number(serviceId),
    ts,
  });

  // BANK: режем подпись до 12 байт (24 hex символа)
  const shortSig = String(fullSig).slice(0, 24);

  return `oa:${serviceId}:${ts}:${shortSig}`;
}

function verifyOfferAcceptCbData(a, b, c, d, e) {
  // поддержка: verifyOfferAcceptCbData({chatId, serviceId, ts, sig})
  // или verifyOfferAcceptCbData(chatId, serviceId, ts, sig)
  let chatId, serviceId, ts, sig;

  if (a && typeof a === "object") {
    chatId = a.chatId;
    serviceId = a.serviceId;
    ts = a.ts;
    sig = a.sig;
  } else {
    chatId = a;
    serviceId = b;
    ts = c;
    sig = d;
  }

  if (!TG_OFFER_SECRET) {
    console.error("[tg-bot] TG_OFFER_SECRET is empty");
    return { ok: false, reason: "no_secret" };
  }

  const now = cbNowSec();
  const t = Number(ts);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad_ts" };
  if (t > now + 30) return { ok: false, reason: "future_ts" };
  if (Math.abs(now - t) > TG_OFFER_TTL_SEC) return { ok: false, reason: "expired" };

  const cid = Number(chatId);
  const sid = Number(serviceId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, reason: "bad_chat" };
  if (!Number.isFinite(sid) || sid <= 0) return { ok: false, reason: "bad_service" };

  const expectedFull = signOfferAccept({ action: "oa", chatId: cid, serviceId: sid, ts: t });
  
  // мы кладём 24 hex в callback_data → значит и expected режем до 24
  const expected = String(expectedFull).slice(0, 24);
  
  const sigStr = String(sig || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(sigStr)) return { ok: false, reason: "bad_sig" };
  
  const exp = Buffer.from(expected, "utf8");
  const got = Buffer.from(sigStr, "utf8");
  
  try {
    if (!crypto.timingSafeEqual(exp, got)) return { ok: false, reason: "bad_sig" };
  } catch {
    return { ok: false, reason: "bad_sig" };
  }
  
  return { ok: true };

  try {
    if (!crypto.timingSafeEqual(exp, got)) return { ok: false, reason: "bad_sig" };
  } catch {
    return { ok: false, reason: "bad_sig" };
  }

  return { ok: true };
}

/**
 * Универсальный подписанный callback_data для действий типа "o" (offer)
 * Формат: o:<serviceId>:<ts>:<sig>
 * ВАЖНО: verifyCbData(...) у тебя уже ждёт именно этот формат.
 */
function buildCbData(ctx, action, serviceId) {
  const chatId = ctx?.from?.id;
  const sid = Number(serviceId);
  if (!chatId || !Number.isFinite(sid) || sid <= 0) {
    // fallback без падения — но лучше не использовать
    return `${action}:${sid}:0:0`;
  }

  const ts = cbNowSec(); // сек
  const sig = signUnlock({
    action: String(action || "").trim(),
    chatId: Number(chatId),
    serviceId: sid,
    ts: Number(ts),
  });

  return `${String(action)}:${sid}:${ts}:${sig}`;
}

/**
 * BANK-GRADE Offer Gate:
 * - безопасно для callback_query / inline (через safeReply)
 * - подписанная кнопка (buildCbData)
 * - без ctx.reply напрямую
 */
async function showOfferGate(ctx, serviceId) {
  await safeCb(ctx, "⚠️ Для открытия контактов нужно принять оферту", true);

  const chatId = ctx.from?.id;
  if (!chatId) return { ok: false, reason: "no_chat" };

  // ⚠️ callback_query из inline часто без chat — ctx.reply падает.
  // Поэтому отправляем в личку через bot.telegram.sendMessage.
  const cb = buildOfferAcceptCbData(chatId, serviceId);

  try {
    await bot.telegram.sendMessage(
      chatId,
      "📄 Перед открытием контактов необходимо принять условия Travella.uz",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📄 Открыть оферту", url: "https://travella.uz/page/oferta" }],
            [{ text: "✅ Я принимаю условия", callback_data: cb }],
          ],
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] showOfferGate sendMessage error:", e?.message || e);
  }

  return { ok: false, reason: "offer_required" };
}

// обновление карточки после unlock
async function refreshUnlockedCard(ctx, serviceId) {
  const { data } = await axios.get(
    `/api/telegram/service/${serviceId}`,
    { params: { role: "client", chatId: ctx.from?.id } }
  );

  if (!data?.success || !data?.service) return;

  const svc = data.service;
  const category = String(svc.category || "").toLowerCase();

  const isUnlocked = data?.unlocked === true;
  
  const { text, photoUrl, serviceUrl, kbExtra } =
    buildServiceMessage(svc, category, "client", { unlocked: isUnlocked });
  
let kb = {
  inline_keyboard: [
    [{ text: "Подробнее на сайте", url: serviceUrl }],
    [{ text: "📩 Быстрый запрос", callback_data: `quick:${serviceId}` }],
  ],
};

const isAuthorTour =
  String(svc?.category || "").toLowerCase() === "author_tour";

if (kbExtra?.inline_keyboard?.length) {
  if (isAuthorTour) {
    kb.inline_keyboard = kbExtra.inline_keyboard;
  } else {
    kb.inline_keyboard = kbExtra.replaceDefault
      ? kbExtra.inline_keyboard
      : [...kbExtra.inline_keyboard, ...kb.inline_keyboard];
  }
}

  try {
    await ctx.editMessageCaption(text, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
    return;
  } catch {}

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: kb,
      disable_web_page_preview: true,
    });
    return;
  } catch {}

  try {
    await ctx.editMessageReplyMarkup(kb);
  } catch {}
}

// Убираем из текста любые "Подробнее ... открыть(ссылка)" до оплаты
function stripLockedLinks(text, options = {}) {
  const unlockPrice = Number(
    options?.unlockPrice ??
    options?.effectivePrice ??
    options?.contactUnlockPrice ??
    0
  );

  const isFreeMode = unlockPrice <= 0;

  let s = String(text || "");

  // 1) HTML вариант: 👉 Подробнее ...: <a href="...">открыть</a>
  s = s.replace(/\n?\s*👉\s*Подробнее[^\n]*?:\s*<a[^>]*>[^<]*<\/a>\s*/gi, "\n");

  // 2) plain вариант: 👉 Подробнее ...: открыть (https://... )
  s = s.replace(/\n?\s*👉\s*Подробнее[^\n]*?:\s*открыть\s*\([^)]+\)\s*/gi, "\n");

  // 3) на всякий случай — любая строка где есть ?service=123
  s = s.replace(/\n?[^\n]*\?service=\d+[^\n]*\n?/gi, "\n");

  s = s.replace(/\n{3,}/g, "\n\n").trim();

  const tail = isFreeMode
    ? "🔓 Подробнее на сайте и быстрый запрос будут доступны после открытия контактов."
    : "🔒 Подробнее на сайте и быстрый запрос будут доступны после оплаты открытия контактов.";

  if (s) s += `\n\n${tail}`;
  else s = tail;

  return s;
}

/* ===================== OPTIONAL DB (requests MVP: id + status) ===================== */
// ⚠️ Мягко: если db.js недоступен/не настроен — бот продолжит работать как раньше (без request_id/статусов)
let pool = null;
try {
  // bot.js обычно лежит в backend/telegram/, db.js в backend/db.js
  pool = require("../db");
} catch (e) {
  console.warn("[tg-bot] DB pool not available (requests MVP disabled):", e?.message || e);
}

let _reqTablesReady = false;
async function ensureReqTables() {
  if (!pool || _reqTablesReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_service_requests (
        id BIGSERIAL PRIMARY KEY,
        service_id BIGINT NOT NULL,
        client_tg_id BIGINT NOT NULL,
        client_username TEXT,
        client_first_name TEXT,
        client_last_name TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // ✅ Таблица логов сообщений по заявкам
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_service_request_messages (
        id BIGSERIAL PRIMARY KEY,
        request_id BIGINT NOT NULL
          REFERENCES telegram_service_requests(id)
          ON DELETE CASCADE,
        sender_role TEXT NOT NULL, -- 'client' | 'manager'
        sender_tg_id BIGINT,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    _reqTablesReady = true;
  } catch (e) {
    console.error("[tg-bot] ensureReqTables error:", e?.message || e);
    _reqTablesReady = false;
  }
}

async function createReqRow({ serviceId, from, source }) {
  try {
    await ensureReqTables();
    if (!pool) return null;
    const r = await pool.query(
      `INSERT INTO telegram_service_requests
       (service_id, client_tg_id, client_username, client_first_name, client_last_name, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        Number(serviceId),
        Number(from?.id || 0),
        from?.username ? String(from.username) : null,
        from?.first_name ? String(from.first_name) : null,
        from?.last_name ? String(from.last_name) : null,
        source ? String(source) : null,
      ]
    );
    return r?.rows?.[0]?.id ? Number(r.rows[0].id) : null;
  } catch (e) {
    console.error("[tg-bot] createReqRow error:", e?.message || e);
    return null;
  }
}

async function updateReqStatus(requestId, status) {
  try {
    await ensureReqTables();
    if (!pool) return false;
    await pool.query(
      `UPDATE telegram_service_requests SET status=$2 WHERE id=$1`,
      [Number(requestId), String(status)]
    );
    return true;
  } catch (e) {
    console.error("[tg-bot] updateReqStatus error:", e?.message || e);
    return false;
  }
}

async function getReqById(requestId) {
  try {
    await ensureReqTables();
    if (!pool) return null;

    const r = await pool.query(
      `SELECT id, service_id, client_tg_id, client_username, client_first_name, client_last_name, status
       FROM telegram_service_requests
       WHERE id = $1
       LIMIT 1`,
      [Number(requestId)]
    );

    return r?.rows?.[0] || null;
  } catch (e) {
    console.error("[tg-bot] getReqById error:", e?.message || e);
    return null;
  }
}

async function logReqMessage({ requestId, senderRole, senderTgId, text }) {
  try {
    await ensureReqTables();
    if (!pool) return false;

    const cleanText = String(text || "").trim();
    if (!cleanText) return false;

    await pool.query(
      `INSERT INTO telegram_service_request_messages (request_id, sender_role, sender_tg_id, text)
       VALUES ($1, $2, $3, $4)`,
      [Number(requestId), String(senderRole), senderTgId ? Number(senderTgId) : null, cleanText]
    );

    return true;
  } catch (e) {
    console.error("[tg-bot] logReqMessage error:", e?.message || e);
    return false;
  }
}

async function getReqMessages(requestId, limit = 20) {
  try {
    await ensureReqTables();
    if (!pool) return [];

    const r = await pool.query(
      `SELECT sender_role, sender_tg_id, text, created_at
       FROM telegram_service_request_messages
       WHERE request_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [Number(requestId), Number(limit)]
    );

    return Array.isArray(r?.rows) ? r.rows : [];
  } catch (e) {
    console.error("[tg-bot] getReqMessages error:", e?.message || e);
    return [];
  }
}

function isManagerChat(ctx) {
  return String(ctx?.chat?.id || "") === String(MANAGER_CHAT_ID || "");
}

async function getOwnerChatIdByServiceId(serviceId) {
  try {
    await ensureReqTables();
    if (!pool) return null;

    const sid = Number(serviceId);
    if (!sid) return null;

    const r = await pool.query(
      `
      SELECT
        s.provider_id,
        COALESCE(
          p.telegram_refused_chat_id,
          p.telegram_chat_id,
          p.tg_chat_id
        ) AS chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [sid]
    );

    const row = r?.rows?.[0];
    if (!row || !row.chat_id) {
      console.warn("[tg-bot] owner tg chat_id is NULL", {
        serviceId: sid,
        providerId: row?.provider_id,
      });
      return null;
    }

    const chatIdNum = Number(String(row.chat_id).trim());
    if (!chatIdNum) {
      console.warn("[tg-bot] owner tg chat_id invalid", {
        serviceId: sid,
        providerId: row.provider_id,
        chat_id: row.chat_id,
      });
      return null;
    }

    return String(chatIdNum);
  } catch (e) {
    console.error("[tg-bot] getOwnerChatIdByServiceId error:", e?.message || e);
    return null;
  }
}


async function isOwnerOfService(serviceId, chatId) {
  const ownerChatId = await getOwnerChatIdByServiceId(serviceId);
  return ownerChatId && String(ownerChatId) === String(chatId);
}

async function isRequestOperatorChat(ctx, requestId) {
  // менеджеру можно оставить полный доступ (если хочешь)
  if (isManagerChat(ctx)) return true;

  const req = await getReqById(requestId);
  if (!req?.service_id) return false;

  return await isOwnerOfService(req.service_id, ctx?.chat?.id);
}

// ===================== DEDUP HELPERS =====================
// защита от двойной отправки одного и того же сообщения

function makeDedupKey(ctx, prefix, id) {
  const chatId = ctx?.chat?.id || "0";
  return `${prefix}:${chatId}:${id}`;
}

function isDuplicateAndMark(ctx, key, ttlMs = 10_000) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.__dedup) ctx.session.__dedup = {};

  const now = Date.now();
  const last = ctx.session.__dedup[key];

  if (last && now - last < ttlMs) {
    return true; // дубликат
  }

  ctx.session.__dedup[key] = now;
  return false;
}

/* ===================== INLINE CACHE (LRU + inflight + per-key TTL) ===================== */

const INLINE_CACHE_TTL_MS = 15000;          // общий дефолт (fallback)
const INLINE_CACHE_MAX = 250;               // лимит записей, чтобы не раздувать память

const inlineCache = new Map();              // key -> { ts, ttl, data }
const inlineInflight = new Map();           // key -> Promise

function cacheGet(key) {
  const v = inlineCache.get(key);
  if (!v) return null;

  const ttl = Number(v.ttl || INLINE_CACHE_TTL_MS);
  if (Date.now() - v.ts > ttl) {
    inlineCache.delete(key);
    return null;
  }

  // LRU: освежаем порядок (последний использованный -> в конец)
  inlineCache.delete(key);
  inlineCache.set(key, v);

  return v.data;
}

function cacheSet(key, data, ttlMs = INLINE_CACHE_TTL_MS) {
  inlineCache.set(key, { ts: Date.now(), ttl: ttlMs, data });

  // LRU-prune
  while (inlineCache.size > INLINE_CACHE_MAX) {
    const oldestKey = inlineCache.keys().next().value;
    inlineCache.delete(oldestKey);
  }
}

// Чтобы не долбить API при быстрых inline-вводах (Telegram шлёт много запросов)
async function getOrFetchCached(key, ttlMs, fetcher, hardTimeoutMs = 9000) {
  const cached = cacheGet(key);
  if (cached) return cached;

  if (inlineInflight.has(key)) {
    try {
      return await inlineInflight.get(key);
    } catch (_) {
      inlineInflight.delete(key);
    }
  }

  const controller = new AbortController();

  const timeoutPromise = new Promise((_, rej) => {
    const t = setTimeout(() => {
      try { controller.abort(); } catch {}
      rej(new Error("INLINE_FETCH_TIMEOUT"));
    }, hardTimeoutMs);
    t.unref?.();
  });

  const p = (async () => {
    const data = await Promise.race([
      // fetcher может принимать signal или нет — передаем безопасно
      (async () => {
        try {
          return await fetcher(controller.signal);
        } catch (e) {
          // если fetcher не принимает аргументы — попробуем без него
          if (String(e?.message || "").includes("is not a function")) throw e;
          throw e;
        }
      })(),
      timeoutPromise,
    ]);

    // кэшируем только успешный результат
    cacheSet(key, data, ttlMs);
    return data;
  })();

  inlineInflight.set(key, p);

  try {
    return await p;
  } finally {
    inlineInflight.delete(key);
    try { controller.abort(); } catch {}
  }
}

/* ===================== BLACK-HOLE++ GLOBAL SHIELD ===================== */

// in-flight защита (race)
const unlockInFlight = new Map();

// velocity limiter
const unlockVelocity = new Map();

// suspicious score
const unlockSuspicious = new Map();

// recent unlock window
const unlockRecent = new Map();

function hasInFlight(key) {
  return unlockInFlight.has(key);
}

function setInFlight(key, ttl = 20000) {
  unlockInFlight.set(key, Date.now());
  setTimeout(() => unlockInFlight.delete(key), ttl).unref?.();
}

function markRecent(key) {
  unlockRecent.set(key, Date.now());
  setTimeout(() => unlockRecent.delete(key), 30000).unref?.();
}

function isRecent(key, windowMs = 5000) {
  const ts = unlockRecent.get(key);
  return ts && Date.now() - ts < windowMs;
}

function checkVelocity(userId, limit = 6, windowMs = 60000) {
  const now = Date.now();
  const arr = unlockVelocity.get(userId) || [];
  const fresh = arr.filter((t) => now - t < windowMs);
  fresh.push(now);
  unlockVelocity.set(userId, fresh);
  return fresh.length <= limit;
}

function markSuspicious(userId) {
  const v = (unlockSuspicious.get(userId) || 0) + 1;
  unlockSuspicious.set(userId, v);
  return v;
}

function isHardBlocked(userId) {
  return (unlockSuspicious.get(userId) || 0) >= 6;
}
// ===================== AUTH REHYDRATE (FIX PENDING STUCK) =====================
// Если админ одобрил лид через сайт, Telegraf-сессия про это не знает.
// Поэтому при pending/!linked мы раз в несколько секунд перепроверяем БД через API
// и обновляем ctx.session (pending=false, linked=true, role=...).
const AUTH_RECHECK_TTL_MS = 6000;

async function rehydrateAuthSessionIfNeeded(ctx) {
  try {
    if (!ctx.session) ctx.session = {};

    const actorId = ctx?.from?.id || ctx?.chat?.id || null;
    if (!actorId) return false;

    const needCheck = !!ctx.session.pending || !ctx.session.linked;
    if (!needCheck) return false;

    const last = Number(ctx.session._authRecheckTs || 0);
    if (Date.now() - last < AUTH_RECHECK_TTL_MS) return false;
    ctx.session._authRecheckTs = Date.now();

    // 1) provider?
    try {
      const r = await axios.get(`/api/telegram/profile/provider/${actorId}`);
      if (r?.data?.success && r?.data?.user?.id) {
        ctx.session.pending = false;
        ctx.session.linked = true;
        ctx.session.role = "provider";
        ctx.session.requestedRole = null;
        return true;
      }
    } catch (e) {
      // 404 ok -> try client
    }

    // 2) client?
    try {
      const r = await axios.get(`/api/telegram/profile/client/${actorId}`);
      if (r?.data?.success && r?.data?.user?.id) {
        ctx.session.pending = false;
        ctx.session.linked = true;
        ctx.session.role = "client";
        ctx.session.requestedRole = null;
        return true;
      }
    } catch (e) {
      // not found -> still pending/unlinked
    }

    return false;
  } catch (e) {
    console.error("[tg-bot] rehydrateAuthSessionIfNeeded error:", e?.message || e);
    return false;
  }
}

/* ===================== INIT BOT ===================== */

const bot = new Telegraf(BOT_TOKEN);
// ============================================================
// HARDENING: бот не должен падать из-за ошибок Telegram API
// ============================================================
function logTgErr(prefix, err) {
  const msg = err?.response?.description || err?.message || String(err);
  const code = err?.code || err?.response?.error_code;
  console.error(prefix, code ? `(code=${code})` : "", msg);
}

// 1) Ловим любые ошибки, которые Telegraf “видит” в хендлерах
bot.catch((err, ctx) => {
  const who = ctx?.from?.id ? `from=${ctx.from.id}` : "";
  const chat = ctx?.chat?.id ? `chat=${ctx.chat.id}` : "";
  logTgErr(`[tg-bot] handler error ${who} ${chat}`.trim(), err);
});

// 2) Оборачиваем основные методы ctx.*, чтобы sendMessage/edit/etc
//    никогда не приводили к unhandled rejection
bot.use(async (ctx, next) => {
  const wrap = (name, fn) => {
    if (!fn) return fn;
    return (...args) => {
      try {
        const p = fn(...args);
        // если это Promise — гасим ошибки отправки
        if (p && typeof p.then === "function" && typeof p.catch === "function") {
          return p.catch((err) => {
            logTgErr(`[tg-bot] ${name} failed`, err);
            return null;
          });
        }
        return p;
      } catch (err) {
        logTgErr(`[tg-bot] ${name} threw`, err);
        return null;
      }
    };
  };

  // reply / media
  ctx.reply = wrap("ctx.reply", ctx.reply?.bind(ctx));
  ctx.replyWithPhoto = wrap("ctx.replyWithPhoto", ctx.replyWithPhoto?.bind(ctx));
  ctx.replyWithDocument = wrap("ctx.replyWithDocument", ctx.replyWithDocument?.bind(ctx));
  ctx.replyWithMediaGroup = wrap("ctx.replyWithMediaGroup", ctx.replyWithMediaGroup?.bind(ctx));

  // callbacks / edits
  ctx.answerCbQuery = wrap("ctx.answerCbQuery", ctx.answerCbQuery?.bind(ctx));
  ctx.editMessageText = wrap("ctx.editMessageText", ctx.editMessageText?.bind(ctx));
  ctx.editMessageReplyMarkup = wrap(
    "ctx.editMessageReplyMarkup",
    ctx.editMessageReplyMarkup?.bind(ctx)
  );

  return next();
});

// ✅ Сессия всегда по пользователю (важно для inline/групп -> ЛС)
bot.use(
  session({
    getSessionKey: (ctx) => String(ctx?.from?.id || ctx?.chat?.id || "anon"),
  })
);

// ===================== PERSISTENT PROVIDER SERVICE DRAFTS =====================
// Railway redeploy restarts the Node process, so Telegraf session can be lost.
// This middleware keeps the provider creation wizard in PostgreSQL and restores it safely.
bot.use(async (ctx, next) => {
  try {
    if (!ctx.session) ctx.session = {};

    const data = String(ctx.callbackQuery?.data || "");
    if (data === "tg_draft:continue" || data === "tg_draft:delete") {
      return next();
    }

    const isPrivate = !ctx.chat?.type || ctx.chat.type === "private";
    const hasLiveCreateWizard =
      isCreateWizardState(ctx.session.state) && !!ctx.session.serviceDraft;

    if (isPrivate && !hasLiveCreateWizard && !ctx.session.__draftRestoreOffered) {
      const activeDraft = await getActiveProviderServiceDraft(ctx);
      if (activeDraft) {
        ctx.session.__draftRestoreOffered = true;
        await replyProviderDraftResumePrompt(ctx, activeDraft);
        return;
      }
    }

    await next();

    if (isCreateWizardState(ctx.session?.state) && ctx.session?.serviceDraft) {
      await saveProviderServiceDraft(ctx);
    }
  } catch (e) {
    console.error("[tg-bot] provider draft persistence middleware error:", e?.message || e);
    return next();
  }
});


// ===================== HARD MODERATION GUARD (IRONCLAD) =====================
// Блокирует ЛЮБЫЕ действия, пока аккаунт в pending (модерация не пройдена).
// Разрешает только: /start, выбор роли role:*, отправку номера (contact или текстом в режиме привязки).
bot.use(async (ctx, next) => {
  try {
    // ✅ FIX: если одобрили через сайт — обновим pending/linked из БД
    await rehydrateAuthSessionIfNeeded(ctx);

    const isStartCmd =
      ctx.updateType === "message" &&
      typeof ctx.message?.text === "string" &&
      ctx.message.text.trim().startsWith("/start");

    const isRolePick =
      ctx.updateType === "callback_query" &&
      typeof ctx.callbackQuery?.data === "string" &&
      /^role:(client|provider)$/.test(ctx.callbackQuery.data);

    const isContact =
      ctx.updateType === "message" && !!ctx.message?.contact?.phone_number;

    const isPhoneText =
      ctx.updateType === "message" &&
      typeof ctx.message?.text === "string" &&
      /^\+?\d[\d\s\-()]{5,}$/i.test(ctx.message.text.trim()) &&
      // пропускаем телефон ТОЛЬКО если пользователь реально находится в процессе привязки
      !!ctx.session?.requestedRole;

    const isInline = ctx.updateType === "inline_query";

    // ✅ Если pending — режем всё, кроме /start / выбора роли / отправки телефона
    if (ctx.session?.pending) {
      if (isStartCmd || isRolePick || isContact || isPhoneText) {
        return next();
      }

      // inline — тоже режем "железобетонно"
      if (isInline) {
        return ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "⏳ Заявка на модерации. Дождитесь одобрения",
          switch_pm_parameter: "start",
        });
      }

      // callback_query: обязательно отвечаем, чтобы не крутился лоадер
      if (ctx.updateType === "callback_query") {
        try {
          await ctx.answerCbQuery("⏳ Заявка на модерации. Дождитесь одобрения", {
            show_alert: true,
          });
        } catch {}
        return;
      }

      // message / всё остальное
      await ctx.reply(
        "⏳ Ваша заявка находится на модерации.\nПожалуйста, дождитесь одобрения администратора."
      );
      return;
    }

    // ✅ Если не pending, но не привязан — не даём выполнять действия в обход /start
    // (но не мешаем самому процессу привязки)
    const isLinked = !!ctx.session?.linked;

    if (!isLinked) {
      // разрешаем базовые шаги привязки
      if (isStartCmd || isRolePick || isContact || isPhoneText) {
        return next();
      }

      if (isInline) {
        return ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "🔐 Сначала привяжите аккаунт (номер телефона)",
          switch_pm_parameter: "start",
        });
      }

      if (ctx.updateType === "callback_query") {
        try {
          await ctx.answerCbQuery("🔐 Сначала привяжите аккаунт через /start", {
            show_alert: true,
          });
        } catch {}
        return;
      }

      await ctx.reply("🔐 Сначала привяжите аккаунт (номер телефона) через /start.");
      return;
    }

    return next();
  } catch (e) {
    console.error("[tg-bot] hardGuard middleware error:", e);
    return next();
  }
});


/* ===================== TG FILE LINK CACHE ===================== */
// file_id -> { url, ts }
const tgFileLinkCache = new Map();
const TG_FILE_LINK_TTL = 20 * 60 * 1000; // 20 минут

async function getPublicThumbUrlFromTgFile(botInstance, fileId) {
  const cached = tgFileLinkCache.get(fileId);
  if (cached && Date.now() - cached.ts < TG_FILE_LINK_TTL) {
    return cached.url;
  }
  const link = await botInstance.telegram.getFileLink(fileId);
  const url = String(link);
  tgFileLinkCache.set(fileId, { url, ts: Date.now() });
  return url;
}

/* ===================== HELPERS ===================== */

function buildServicesTextList(items, role = "provider") {
  const lines = [];

  for (const svc of items) {
    const category = svc.category || svc.type || "refused_tour";
    const d = parseDetailsAny(svc.details);

    const catLabel = CATEGORY_LABELS[category] || "Услуга";
    const startRaw = d.departureFlightDate || d.startDate || null;
    const endRaw = d.returnFlightDate || d.endDate || null;

    let datePart = "";
    if (startRaw && endRaw && String(startRaw) !== String(endRaw)) {
      datePart = `${prettyDateTime(startRaw)}–${prettyDateTime(endRaw)}`;
    } else if (startRaw) {
      datePart = `${prettyDateTime(startRaw)}`;
    }

    const priceRaw = pickPrice(d, svc, role);
    const priceWithCur = formatPriceWithCurrency(priceRaw);

    const title = normalizeTitleSoft(
      (typeof svc.title === "string" && svc.title.trim()) ? svc.title.trim() : (catLabel || "Услуга")
    );

    // ссылка на кабинет
    const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

    const parts = [];
    parts.push(`#${svc.id}`);
    parts.push(catLabel);
    if (title) parts.push(title);
    if (datePart) parts.push(datePart);
    if (priceWithCur) parts.push(priceWithCur);

    // одна строка
    lines.push(`• ${parts.join(" · ")}\n  ${manageUrl}`);
  }

  return lines;
}

function chunkText(lines, maxLen = 3800) {
  const chunks = [];
  let buf = "";

  for (const line of lines) {
    if ((buf + "\n" + line).length > maxLen) {
      if (buf.trim()) chunks.push(buf.trim());
      buf = line;
    } else {
      buf = buf ? (buf + "\n" + line) : line;
    }
  }

  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function truncate(str, max = 64) {
  const s = String(str || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trim() + "…";
}

// экранирование текста для Telegram Markdown (V1)
function escapeMarkdown(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/`/g, "\\`");
}
const WIZARD_TTL_MS = 10 * 60 * 1000; // 10 минут

function touchSessionState(ctx, stateName) {
  if (!ctx.session) ctx.session = {};
  ctx.session.state = stateName;
  ctx.session._state_ts = Date.now();
}

function isSessionStateExpired(ctx) {
  const ts = Number(ctx.session?._state_ts || 0);
  if (!ts) return false;
  return (Date.now() - ts) > WIZARD_TTL_MS;
}

function resetPendingClientInput(ctx) {
  if (!ctx.session) return;
  // сбрасываем только “ожидания ввода”
  if (
    ctx.session.state === "awaiting_request_message" ||
    ctx.session.state === "awaiting_request_add" ||
    ctx.session.state === "awaiting_request_add_message" ||
    ctx.session.state === "awaiting_operator_reply" ||
    ctx.session.state === "awaiting_manager_reply"
  ) {
    ctx.session.state = null;
  }

  ctx.session.pendingRequestServiceId = null;
  ctx.session.pendingRequestSource = null;

  ctx.session.activeRequestId = null;
  ctx.session.pendingAddRequestId = null;

  ctx.session.operatorReplyRequestId = null;
  ctx.session.managerReplyRequestId = null;

  ctx.session._state_ts = null;
}

function pickServiceTitle(service) {
  const d = service?.details || {};
  // refused_tour / author_tour
  if (d.title) return String(d.title);
  // refused_hotel
  if (d.hotelName) return String(d.hotelName);
  if (d.hotel) return String(d.hotel);
  // fallback
  if (service?.title) return String(service.title);
  if (service?.name) return String(service.name);
  return "";
}

function pickServicePrice(service) {
  const d = service?.details || {};
  // чаще всего у тебя цена в details.netPrice
  if (d.netPrice !== undefined && d.netPrice !== null && String(d.netPrice).trim() !== "") {
    return String(d.netPrice);
  }
  // fallback
  if (service?.price !== undefined && service?.price !== null && String(service.price).trim() !== "") {
    return String(service.price);
  }
  return "";
}

async function fetchServiceBrief(serviceId) {
  try {
    // ⚠️ ВАЖНО: endpoint должен соответствовать твоему API.
    // 1) попробуем /services/:id
    let r = await axios.get(`/services/${serviceId}`);
    let service = r?.data?.service || r?.data || null;

    // если API отдаёт details строкой — распарсим
    if (service && typeof service.details === "string") {
      try { service.details = JSON.parse(service.details); } catch {}
    }

    if (!service) return null;

    const title = pickServiceTitle(service);
    const price = pickServicePrice(service);

    return { title, price, raw: service };
  } catch (e1) {
    // 2) запасной вариант: /api/services/:id (если у тебя так)
    try {
      let r2 = await axios.get(`/api/services/${serviceId}`);
      let service2 = r2?.data?.service || r2?.data || null;

      if (service2 && typeof service2.details === "string") {
        try { service2.details = JSON.parse(service2.details); } catch {}
      }

      if (!service2) return null;

      const title = pickServiceTitle(service2);
      const price = pickServicePrice(service2);

      return { title, price, raw: service2 };
    } catch (e2) {
      return null;
    }
  }
}

// Бережная нормализация заголовка
function normalizeTitleSoft(str) {
  if (!str) return str;
  const s = String(str).trim();
  if (!s) return s;
  if (/[a-zа-яё]/.test(s)) return s;

  return s.replace(/[A-Za-zА-ЯЁа-яё]+/g, (w) => {
    if (w.length <= 3) return w;
    if (w === w.toUpperCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  });
}

// Санитизация странных разделителей (’n / 'n / &n) → стрелка
function normalizeWeirdSeparator(s) {
  if (!s) return s;
  return String(s)
    .replace(/\s*['’]n\s*/gi, " → ")
    .replace(/\s*&n\s*/gi, " → ")
    .replace(/\s+→\s+/g, " → ")
    .trim();
}

function formatPriceWithCurrency(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;

  // если уже есть валюта — не дублируем
  if (/\b(usd|u\.?s\.?d\.?|eur|rub|uzs|\$|€|₽|сум)\b/i.test(v)) return v;
  return `${v} ${PRICE_CURRENCY}`;
}

function getMainMenuKeyboard(role) {
  if (role === "provider") {
    return {
      reply_markup: {
        keyboard: [
          [{ text: "🔍 Найти услугу" }, { text: "🧳 Мои услуги" }],
          [{ text: "🧺 Корзина" }, { text: "📄 Бронирования" }],
          [{ text: "📨 Заявки" }, { text: "👤 Профиль" }],
        ],
        resize_keyboard: true,
      },
    };
  }

  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Найти услугу" }, { text: "❤️ Избранное" }],
        [{ text: "📄 Бронирования" }, { text: "📨 Заявки" }],
        [{ text: "👤 Профиль" }, { text: "🏢 Стать поставщиком" }],
      ],
      resize_keyboard: true,
    },
  };
}

async function askRole(ctx) {
  const text =
    "👋 <b>Добро пожаловать в Travella</b>\n\n" +
    "🔥 <b>Первая платформа отказных туров</b>\n" +
    "и туристических услуг дешевле рынка\n\n" +
    "💰 <b>Экономия обычно 20–40%</b>\n" +
    "⚡ Такие предложения быстро разбирают\n\n" +
    "Здесь вы можете:\n" +
    "✈️ как клиент (обычный турист) — находить выгодные варианты и напрямую связываться с поставщиками\n" +
    "🏢 как поставщик (турагент, гид, транспорт, отель) — размещать свои отказы, искать предложения и получать заявки\n\n" +
    "👇 <b>Выберите роль, чтобы продолжить</b>";

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👤 Я клиент", callback_data: "role:client" }],
        [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
      ],
    },
    disable_web_page_preview: true,
  });
}

function getClientHomeKeyboard() {
  return {
    keyboard: [
      [{ text: "🔍 Найти услугу" }, { text: "🔥 Горящие предложения" }],
      [{ text: "❤️ Избранное" }, { text: "📄 Бронирования" }],
      [{ text: "📨 Заявки" }, { text: "👤 Профиль" }],
      [{ text: "🏢 Стать поставщиком" }],
    ],
    resize_keyboard: true,
  };
}

function buildClientApprovedWelcomeText() {
  return (
    "✅ <b>Аккаунт успешно подтверждён</b>\n\n" +
    "Добро пожаловать в <b>Travella</b>!\n\n" +
    "Здесь вы можете:\n" +
    "✈️ находить отказные туры и авиабилеты дешевле рынка\n" +
    "🏨 искать отели и туристические услуги\n" +
    "❤️ сохранять предложения в избранное\n" +
    "📨 отправлять быстрые запросы поставщикам\n" +
    "🔓 открывать контакты поставщиков напрямую\n\n" +
    "🔥 Новые предложения появляются ежедневно и быстро разбираются.\n\n" +
    "👇 <b>Начните поиск прямо сейчас</b>"
  );
}

async function showClientHome(ctx) {
  await ctx.reply(buildClientApprovedWelcomeText(), {
    parse_mode: "HTML",
    reply_markup: getClientHomeKeyboard(),
    disable_web_page_preview: true,
  });
}

// ✅ Для идентификации пользователя всегда используем ctx.from.id
function getActorId(ctx) {
  return ctx?.from?.id || ctx?.chat?.id || null;
}

async function trackProviderFunnelFromBot(ctx, eventName, options = {}) {
  try {
    const draft = ctx.session?.serviceDraft || {};
    const actorId = getActorId(ctx);

    let providerId = options.providerId || ctx.session?.__providerFunnelProviderId || null;
    if (!providerId && actorId) {
      providerId = await resolveProviderIdByTelegramChatId(actorId).catch(() => null);
      if (providerId) {
        if (!ctx.session) ctx.session = {};
        ctx.session.__providerFunnelProviderId = providerId;
      }
    }

    const serviceId =
      options.serviceId ||
      draft.id ||
      ctx.session?.awaitingProofForServiceId ||
      null;

    await logProviderFunnelEvent({
      source: "telegram_bot",
      actorRole: "provider",
      actorId,
      telegramChatId: actorId,
      providerId,
      serviceId,
      category: options.category || draft.category || ctx.session?.awaitingProofForCategory || null,
      eventName,
      step: options.step || ctx.session?.state || null,
      status: options.status || null,
      sessionId: actorId ? `tg:${actorId}` : null,
      meta: {
        chat_id: actorId || null,
        provider_id: providerId || null,
        service_id: serviceId || null,
        username: ctx.from?.username || null,
        first_name: ctx.from?.first_name || null,
        ...options.meta,
      },
    });
  } catch (e) {
    console.error("[tg-bot] trackProviderFunnelFromBot error:", e?.message || e);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== "Живая корзина" в одном сообщении =====
const TRASH_MSG_BY_CHAT = new Map(); // chatId -> { chatId, messageId }
const TRASH_ITEMS_BY_CHAT = new Map(); // chatId -> items[]
const ARCHIVE_MSG_BY_CHAT = new Map(); // chatId -> { chatId, messageId }
const ARCHIVE_ITEMS_BY_CHAT = new Map(); // chatId -> items[]
const DRAFT_MSG_BY_CHAT = new Map(); // chatId -> { chatId, messageId }
const DRAFT_ITEMS_BY_CHAT = new Map(); // chatId -> items[]
const PENDING_MSG_BY_CHAT = new Map(); // chatId -> { chatId, messageId }
const PENDING_ITEMS_BY_CHAT = new Map(); // chatId -> items[]


function getArchiveReason(s) {
  const d = pickDetails(s);
  if (String(s?.status || "") === "archived") return "архивировано";
  if (s?.expiration_at) {
    const dt = new Date(s.expiration_at);
    if (!Number.isNaN(dt.getTime()) && dt.getTime() <= Date.now()) return "срок актуальности истёк";
  }
  if (d && d.isActive === false) return "снято с публикации";
  return "неактуально";
}

function buildArchiveListText(items) {
  if (!items.length) {
    return (
      `🗄 <b>Архив отказов</b>\n\n` +
      `Пока пусто. Здесь будут просроченные, снятые вручную и архивные отказы.`
    );
  }

  const lines = items.slice(0, 20).map((s) => {
    const id = s.id;
    const d = pickDetails(s);
    const title = escapeHtml(s.title || d.title || "Услуга");
    const cat = escapeHtml(CATEGORY_LABELS?.[s.category] || s.category || "");
    const reason = escapeHtml(getArchiveReason(s));
    const country = escapeHtml(d.directionCountry || d.country || d.locationCountry || "");
    const city = escapeHtml(d.directionTo || d.toCity || d.city || d.locationCity || "");
    const direction = [country, city].filter(Boolean).join(" / ");
    return (
      `<code>#R${id}</code> <b>${title}</b>` +
      (cat ? `\n📌 ${cat}` : "") +
      (direction ? `\n🌍 ${direction}` : "") +
      `\n⛔ ${reason}`
    );
  });

  return (
    `🗄 <b>Архив отказов</b>\n\n` +
    `Здесь собраны просроченные, снятые вручную и архивные отказы.\n` +
    `Нажмите на номер услуги ниже, чтобы восстановить, продлить или удалить.\n\n` +
    lines.join("\n\n") +
    (items.length > 20 ? `\n\n…и ещё ${items.length - 20} шт.` : "")
  );
}

function buildArchiveListKeyboard(items) {
  const buttons = items.slice(0, 20).map((s) => {
    const d = pickDetails(s);
    const title = String(s.title || d.title || d.hotel || d.hotelName || "").trim();
    const shortTitle = title ? ` · ${title.slice(0, 18)}${title.length > 18 ? "…" : ""}` : "";
    return {
      text: `#R${s.id}${shortTitle}`,
      callback_data: `archive:item:${s.id}`,
    };
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 1) rows.push(buttons.slice(i, i + 1));

  rows.push([{ text: "🔄 Обновить архив", callback_data: "archive:open" }]);
  rows.push([{ text: "⬅️ В меню услуг", callback_data: "prov_services:list" }]);
  return { inline_keyboard: rows };
}

function buildDraftListText(items) {
  if (!items.length) {
    return (
      `📝 <b>Черновики</b>

` +
      `Пока пусто. Здесь будут услуги, которые начали создавать через бот или веб, но ещё не опубликовали.`
    );
  }

  const lines = items.slice(0, 20).map((s) => {
    const id = s.id;
    const d = pickDetails(s);
    const title = escapeHtml(s.title || d.title || d.hotel || d.hotelName || "Без названия");
    const cat = escapeHtml(CATEGORY_LABELS?.[s.category] || s.category || "");
    const country = escapeHtml(d.directionCountry || d.country || d.locationCountry || "");
    const city = escapeHtml(d.directionTo || d.toCity || d.city || d.locationCity || "");
    const direction = [country, city].filter(Boolean).join(" / ");
    const created = s.created_at ? escapeHtml(prettyDateTime(s.created_at)) : "";

    return (
      `<code>#R${id}</code> <b>${title}</b>` +
      (cat ? `\n📌 ${cat}` : "") +
      (direction ? `\n🌍 ${direction}` : "") +
      (created ? `\n🕒 Создан: ${created}` : "") +
      `\n📝 Статус: черновик`
    );
  });

  return (
    `📝 <b>Черновики</b>\n\n` +
    `Здесь услуги, которые ещё не опубликованы. Нажмите на услугу, чтобы продолжить редактирование.\n\n` +
    lines.join("\n\n") +
    (items.length > 20 ? `\n\n…и ещё ${items.length - 20} шт.` : "")
  );
}

function buildDraftListKeyboard(items) {
  const buttons = items.slice(0, 20).map((s) => {
    const d = pickDetails(s);
    const title = String(s.title || d.title || d.hotel || d.hotelName || "").trim();
    const shortTitle = title ? ` · ${title.slice(0, 18)}${title.length > 18 ? "…" : ""}` : "";
    return {
      text: `📝 #R${s.id}${shortTitle}`,
      callback_data: `draft:item:${s.id}`,
    };
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 1) rows.push(buttons.slice(i, i + 1));

  rows.push([{ text: "🔄 Обновить черновики", callback_data: "drafts:open" }]);
  rows.push([{ text: "🌐 Открыть веб-кабинет", url: `${SITE_URL}/dashboard/services/marketplace?tab=draft&from=tg` }]);
  rows.push([{ text: "⬅️ В меню услуг", callback_data: "prov_services:list" }]);
  return { inline_keyboard: rows };
}

function countDraftFilledFields(svc) {
  const d = pickDetails(svc);
  const category = String(svc?.category || "").toLowerCase();
  const images = parseImagesAny(svc?.images);
  const proofImages = Array.isArray(d.proofImages) ? d.proofImages : Array.isArray(d.proof_images) ? d.proof_images : [];

  const has = (...values) => values.some((v) => v !== undefined && v !== null && String(v).trim() !== "");
  const checks = [
    { key: "title", label: "Название", ok: has(svc?.title, d.title) },
    { key: "route", label: "Маршрут", ok: has(d.directionFrom, d.fromCity) && has(d.directionTo, d.toCity) },
    { key: "dates", label: category === "refused_event_ticket" ? "Дата события" : "Даты", ok: has(d.startDate, d.start_date, d.startFlightDate, d.departureFlightDate, d.eventDate) },
    { key: "hotel", label: category === "refused_hotel" ? "Отель" : "Отель / объект", ok: has(d.hotel, d.hotelName, d.eventName) },
    { key: "accommodation", label: "Размещение", ok: has(d.accommodation, d.accommodationCategory, d.roomCategory, d.ticketDetails) },
    { key: "price", label: "Цена", ok: has(d.netPrice, d.grossPrice, d.price, svc?.price) },
    { key: "proof", label: "Proof / фото", ok: proofImages.filter(Boolean).length > 0 || images.length > 0 },
  ];

  const filled = checks.filter((x) => x.ok).length;
  return { filled, total: checks.length, checks };
}

function buildDraftProgressBar(filled, total) {
  const safeTotal = Math.max(1, Number(total || 1));
  const percent = Math.round((Number(filled || 0) / safeTotal) * 100);
  const blocks = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${"█".repeat(blocks)}${"░".repeat(10 - blocks)} ${percent}%`;
}

function buildDraftDetailText(svc) {
  const d = pickDetails(svc);
  const category = String(svc?.category || "refused_tour").toLowerCase();
  const categoryLabel = CATEGORY_LABELS?.[category] || category || "Услуга";
  const title = firstNonEmptyValue(svc?.title, d.title, d.hotel, d.hotelName, "Без названия");
  const route = [
    firstNonEmptyValue(d.directionFrom, d.fromCity),
    firstNonEmptyValue(d.directionTo, d.toCity, d.city, d.location),
  ].filter(Boolean).join(" → ");
  const hotel = firstNonEmptyValue(d.hotel, d.hotelName, d.eventName);
  const dates = [
    firstNonEmptyValue(d.startDate, d.start_date, d.startFlightDate, d.departureFlightDate, d.eventDate),
    firstNonEmptyValue(d.endDate, d.end_date, d.returnDate, d.returnFlightDate, d.endFlightDate),
  ].filter(Boolean).join(" → ");
  const price = firstNonEmptyValue(d.grossPrice, d.netPrice, d.price, svc?.price);
  const currency = firstNonEmptyValue(d.currency, svc?.price_currency, svc?.currency, "USD");
  const created = svc?.created_at ? prettyDateTime(svc.created_at) : "";
  const { filled, total, checks } = countDraftFilledFields(svc);
  const bar = buildDraftProgressBar(filled, total);

  const checklist = checks
    .map((item, idx) => `${idx + 1}️⃣ ${item.ok ? "✅" : "▫️"} ${escapeHtml(item.label)}`)
    .join("\n");

  let html =
    `✏️ <b>Продолжение черновика #R${escapeHtml(svc?.id || "")}</b>\n\n` +
    `📌 <b>${escapeHtml(title)}</b>\n` +
    `🏷 <b>Категория:</b> ${escapeHtml(categoryLabel)}\n` +
    `📝 <b>Заполнено:</b> ${filled}/${total} полей\n` +
    `<code>${escapeHtml(bar)}</code>\n`;

  if (route) html += `\n🌍 <b>Маршрут:</b> ${escapeHtml(route)}`;
  if (hotel) html += `\n🏨 <b>Отель/объект:</b> ${escapeHtml(hotel)}`;
  if (dates) html += `\n🗓 <b>Даты:</b> ${escapeHtml(dates)}`;
  if (price) html += `\n💰 <b>Цена:</b> ${escapeHtml(String(price))} ${escapeHtml(currency)}`;
  if (created) html += `\n🕒 <b>Создан:</b> ${escapeHtml(created)}`;

  html +=
    `\n\n<b>Что уже заполнено:</b>\n${checklist}` +
    `\n\nНажмите <b>✏️ Продолжить</b>, чтобы открыть пошаговое редактирование прямо в боте.`;

  return html;
}

function buildDraftDetailKeyboard(serviceId) {
  return {
    inline_keyboard: [
      [{ text: "✏️ Продолжить", callback_data: `draft:continue:${serviceId}` }],
      [{ text: "🌐 Открыть в веб", url: `${SITE_URL}/dashboard/services/marketplace?tab=draft&service_id=${serviceId}&from=tg` }],
      [{ text: "🗑 Удалить черновик", callback_data: `svc_delete:${serviceId}` }],
      [{ text: "⬅️ Назад к черновикам", callback_data: "drafts:open" }],
    ],
  };
}

function buildProviderServiceHeaderHtml(svc, category, details = {}) {
  const status = String(svc?.status || "draft");
  const isPending = status === "pending" || svc?.moderation_status === "pending";
  const isRejected = status === "rejected" || svc?.moderation_status === "rejected";
  const isActual = isServiceActual(details, svc);
  const moderationComment = svc?.moderation_comment || svc?.moderationComment || null;
  const expirationRaw = details.expiration || svc?.expiration || svc?.expiration_at || null;

  let stateLine = "🟢 Активна";
  if (isPending) stateLine = "⏳ На модерации";
  else if (isRejected) stateLine = "❌ Отклонена";
  else if (!isActual) stateLine = "⛔ Неактуальна";
  else if (status === "archived") stateLine = "🗄 В архиве";
  else if (status === "draft") stateLine = "📝 Черновик";

  let html =
    `🧭 <b>Управление услугой</b> <code>#R${escapeHtml(svc?.id || "")}</code>
` +
    `📌 <b>${escapeHtml(CATEGORY_LABELS?.[category] || category || "Услуга")}</b>
` +
    `${escapeHtml(stateLine)}`;

  if (expirationRaw) {
    html += `
⏳ <b>Актуально до:</b> ${escapeHtml(prettyDateTime(expirationRaw))}`;
  }

  if (isRejected && moderationComment) {
    html += `
📝 <b>Причина:</b> ${escapeHtml(moderationComment)}`;
  }

  html +=
    `

💡 <b>Действия:</b> можно редактировать, продлить срок, снять с публикации, отправить в архив или удалить.`;

  return html;
}


function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

function buildProviderCompactManageCardHtml(svc, category, details = {}) {
  const status = String(svc?.status || "draft").toLowerCase();
  const isPending = status === "pending" || svc?.moderation_status === "pending";
  const isRejected = status === "rejected" || svc?.moderation_status === "rejected";
  const isActual = isServiceActual(details, svc);

  let stateLine = "🟢 Активна";
  if (isPending) stateLine = "⏳ На модерации";
  else if (isRejected) stateLine = "❌ Отклонена";
  else if (!isActual) stateLine = "⛔ Неактуальна";
  else if (status === "archived") stateLine = "🗄 В архиве";
  else if (status === "draft") stateLine = "📝 Черновик";

  const title = firstNonEmptyValue(
    svc?.title,
    details.title,
    details.hotelName,
    details.hotel,
    CATEGORY_LABELS?.[category],
    category,
    "Услуга"
  );

  const country = firstNonEmptyValue(
    details.directionCountry,
    details.country,
    details.locationCountry,
    details.toCountry
  );

  const city = firstNonEmptyValue(
    details.directionTo,
    details.toCity,
    details.city,
    details.locationCity,
    details.directionCity
  );

  const start = firstNonEmptyValue(
    details.startDate,
    details.start_date,
    details.checkIn,
    details.checkInDate,
    details.checkinDate,
    details.departureFlightDate,
    details.eventDate,
    svc?.start_date
  );

  const end = firstNonEmptyValue(
    details.endDate,
    details.end_date,
    details.checkOut,
    details.checkOutDate,
    details.checkoutDate,
    details.returnFlightDate,
    svc?.end_date
  );

  const nights = firstNonEmptyValue(details.nights, details.nightCount);
  const price = pickPrice(details, svc, "provider");
  const currency = firstNonEmptyValue(
    details.currency,
    details.priceCurrency,
    details.price_currency,
    svc?.price_currency,
    PRICE_CURRENCY
  );

  const lines = [
    `🧭 <b>Управление услугой</b> <code>#R${escapeHtml(svc?.id || "")}</code>`,
    `📌 <b>${escapeHtml(CATEGORY_LABELS?.[category] || category || "Услуга")}</b>`,
    `${escapeHtml(stateLine)}`,
    "",
    `📝 <b>${escapeHtml(title)}</b>`,
  ];

  const direction = [country, city].filter(Boolean).join(" / ");
  if (direction) lines.push(`🌍 ${escapeHtml(direction)}`);

  if (start || end) {
    lines.push(`🗓 ${escapeHtml(prettyDateTime(start || "—"))} → ${escapeHtml(prettyDateTime(end || "—"))}`);
  }

  if (nights) lines.push(`🌙 ${escapeHtml(nights)} ноч.`);
  if (price !== null && price !== undefined && String(price).trim() !== "") {
    lines.push(`💰 ${escapeHtml(price)} ${escapeHtml(currency)}`);
  }

  lines.push("", "💡 Выберите действие ниже.");

  return lines.join("\n");
}


function buildArchiveItemIntroHtml(svc, serviceId) {
  const d = pickDetails(svc || {});
  const category = svc?.category || svc?.type || "refused_tour";
  const reason = svc ? getArchiveReason(svc) : "архив";

  let html =
    `🗄 <b>Архивная услуга</b> <code>#R${escapeHtml(serviceId)}</code>
` +
    `📌 <b>${escapeHtml(CATEGORY_LABELS?.[category] || category || "Услуга")}</b>
` +
    `ℹ️ <b>Почему в архиве:</b> ${escapeHtml(reason)}`;

  const expirationRaw = d.expiration || svc?.expiration || svc?.expiration_at || null;
  if (expirationRaw) {
    html += `
⏳ <b>Было актуально до:</b> ${escapeHtml(prettyDateTime(expirationRaw))}`;
  }

  html +=
    `

♻️ Чтобы снова показать услугу клиентам, нажмите <b>Вернуть</b> или сначала отредактируйте данные.`;

  return html;
}

async function fetchArchiveItems(ctx) {
  const actorId = getActorId(ctx);
  const r = await axios.get(`/api/telegram/provider/${actorId}/services/archive`);
  return r?.data?.services || r?.data?.items || [];
}

async function fetchDraftItems(ctx) {
  const actorId = getActorId(ctx);
  const r = await axios.get(`/api/telegram/provider/${actorId}/services/drafts`);
  return r?.data?.services || r?.data?.items || [];
}

async function fetchPendingItems(ctx) {
  const actorId = getActorId(ctx);
  const r = await axios.get(`/api/telegram/provider/${actorId}/services/pending`);
  return r?.data?.services || r?.data?.items || [];
}

async function fetchProviderServiceCounters(ctx) {
  try {
    const actorId = getActorId(ctx);
    if (!actorId) return { draft: 0, pending: 0, archive: 0, trash: 0 };

    const [draftRes, pendingRes, archiveRes, trashRes] = await Promise.allSettled([
      axios.get(`/api/telegram/provider/${actorId}/services/drafts`),
      axios.get(`/api/telegram/provider/${actorId}/services/pending`),
      axios.get(`/api/telegram/provider/${actorId}/services/archive`),
      axios.get(`/api/telegram/provider/${actorId}/services/deleted`),
    ]);

    const draftItems =
      draftRes.status === "fulfilled"
        ? draftRes.value?.data?.services || draftRes.value?.data?.items || []
        : [];
    const pendingItems =
      pendingRes.status === "fulfilled"
        ? pendingRes.value?.data?.services || pendingRes.value?.data?.items || []
        : [];
    const archiveItems =
      archiveRes.status === "fulfilled"
        ? archiveRes.value?.data?.services || archiveRes.value?.data?.items || []
        : [];
    const trashItems =
      trashRes.status === "fulfilled"
        ? trashRes.value?.data?.services || trashRes.value?.data?.items || []
        : [];

    return {
      draft: Array.isArray(draftItems) ? draftItems.length : 0,
      pending: Array.isArray(pendingItems) ? pendingItems.length : 0,
      archive: Array.isArray(archiveItems) ? archiveItems.length : 0,
      trash: Array.isArray(trashItems) ? trashItems.length : 0,
    };
  } catch {
    return { draft: 0, pending: 0, archive: 0, trash: 0 };
  }
}

function draftButtonLabel(count = 0) {
  const n = Number(count || 0);
  return n > 0 ? `📝 Черновики (${n})` : "📝 Черновики";
}

function pendingButtonLabel(count = 0) {
  const n = Number(count || 0);
  return n > 0 ? `🕓 На модерации (${n})` : "🕓 На модерации";
}

function archiveButtonLabel(count = 0) {
  const n = Number(count || 0);
  return n > 0 ? `🗄 Архив (${n})` : "🗄 Архив";
}

function trashButtonLabel(count = 0) {
  const n = Number(count || 0);
  return n > 0 ? `🧺 Корзина (${n})` : "🧺 Корзина";
}

function buildPendingListText(items) {
  if (!items.length) {
    return (
      `🕓 <b>На модерации</b>\n\n` +
      `Пока пусто. Здесь будут услуги, которые отправлены на проверку администратору.`
    );
  }

  const lines = items.slice(0, 20).map((s) => {
    const id = s.id;
    const d = pickDetails(s);
    const title = escapeHtml(s.title || d.title || d.hotel || d.hotelName || "Без названия");
    const cat = escapeHtml(CATEGORY_LABELS?.[s.category] || s.category || "");
    const country = escapeHtml(d.directionCountry || d.country || d.locationCountry || "");
    const city = escapeHtml(d.directionTo || d.toCity || d.city || d.locationCity || "");
    const direction = [country, city].filter(Boolean).join(" / ");
    const submitted = s.submitted_at ? escapeHtml(prettyDateTime(s.submitted_at)) : "";

    return (
      `<code>#R${id}</code> <b>${title}</b>` +
      (cat ? `\n📌 ${cat}` : "") +
      (direction ? `\n🌍 ${direction}` : "") +
      (submitted ? `\n🕒 Отправлено: ${submitted}` : "") +
      `\n🕓 Статус: на модерации`
    );
  });

  return (
    `🕓 <b>На модерации</b>\n\n` +
    `Эти услуги уже отправлены администратору. Пока идёт проверка, редактирование лучше не начинать: после правок услуга вернётся в черновик.\n\n` +
    lines.join("\n\n") +
    (items.length > 20 ? `\n\n…и ещё ${items.length - 20} шт.` : "")
  );
}

function buildPendingListKeyboard(items) {
  const buttons = items.slice(0, 20).map((s) => {
    const d = pickDetails(s);
    const title = String(s.title || d.title || d.hotel || d.hotelName || "").trim();
    const shortTitle = title ? ` · ${title.slice(0, 18)}${title.length > 18 ? "…" : ""}` : "";
    return {
      text: `🕓 #R${s.id}${shortTitle}`,
      callback_data: `pending:item:${s.id}`,
    };
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 1) rows.push(buttons.slice(i, i + 1));

  rows.push([{ text: "🔄 Обновить", callback_data: "pending:open" }]);
  rows.push([{ text: "🌐 Открыть веб-кабинет", url: `${SITE_URL}/dashboard/services/marketplace?tab=pending&from=tg` }]);
  rows.push([{ text: "⬅️ В меню услуг", callback_data: "prov_services:list" }]);
  return { inline_keyboard: rows };
}

async function renderPending(ctx) {
  const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
  const items = await fetchPendingItems(ctx);
  PENDING_ITEMS_BY_CHAT.set(String(chatId), items);

  await safeReply(ctx, buildPendingListText(items), {
    parse_mode: "HTML",
    reply_markup: buildPendingListKeyboard(items),
    disable_web_page_preview: true,
  });
}

async function renderDrafts(ctx) {
  const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
  const items = await fetchDraftItems(ctx);
  DRAFT_ITEMS_BY_CHAT.set(String(chatId), items);

  const text = buildDraftListText(items);
  const reply_markup = buildDraftListKeyboard(items);
  const canEditFromCallback = Boolean(ctx.update?.callback_query?.message?.message_id);
  const saved = DRAFT_MSG_BY_CHAT.get(String(chatId));
  const messageIdToEdit = saved?.messageId;

  if (canEditFromCallback) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup });
      const mid = ctx.update.callback_query.message.message_id;
      DRAFT_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: mid });
      return;
    } catch {}
  }

  if (messageIdToEdit) {
    try {
      await ctx.telegram.editMessageText(chatId, messageIdToEdit, undefined, text, {
        parse_mode: "HTML",
        reply_markup,
      });
      return;
    } catch {
      DRAFT_MSG_BY_CHAT.delete(String(chatId));
    }
  }

  const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup });
  if (sent?.message_id) DRAFT_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: sent.message_id });
}

async function renderArchive(ctx) {
  const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
  const items = await fetchArchiveItems(ctx);
  ARCHIVE_ITEMS_BY_CHAT.set(String(chatId), items);

  const text = buildArchiveListText(items);
  const reply_markup = buildArchiveListKeyboard(items);
  const canEditFromCallback = Boolean(ctx.update?.callback_query?.message?.message_id);
  const saved = ARCHIVE_MSG_BY_CHAT.get(String(chatId));
  const messageIdToEdit = saved?.messageId;

  if (canEditFromCallback) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup });
      const mid = ctx.update.callback_query.message.message_id;
      ARCHIVE_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: mid });
      return;
    } catch {}
  }

  if (messageIdToEdit) {
    try {
      await ctx.telegram.editMessageText(chatId, messageIdToEdit, undefined, text, {
        parse_mode: "HTML",
        reply_markup,
      });
      return;
    } catch {
      ARCHIVE_MSG_BY_CHAT.delete(String(chatId));
    }
  }

  const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup });
  if (sent?.message_id) ARCHIVE_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: sent.message_id });
}

function buildTrashListText(items) {
  if (!items.length) {
    return `🧺 <b>Корзина удалённых услуг</b>\n\nКорзина пуста.`;
  }

  const lines = items.slice(0, 20).map((s, idx) => {
    const id = s.id;
    const title = escapeHtml(s.title || "Услуга");
    const cat = escapeHtml(s.category || "");
    const deletedAt = s.deleted_at ? new Date(s.deleted_at).toLocaleString("ru-RU") : "";
    return (
      `${idx + 1}) <code>#${id}</code> — <b>${title}</b>` +
      (cat ? `\n   📌 <i>${cat}</i>` : "") +
      (deletedAt ? `\n   🕒 <i>${escapeHtml(deletedAt)}</i>` : "")
    );
  });

  return (
    `🧺 <b>Корзина удалённых услуг</b>\n\n` +
    `Нажмите на услугу ниже 👇\n\n` +
    lines.join("\n\n") +
    (items.length > 20 ? `\n\n…и ещё ${items.length - 20} шт.` : "")
  );
}

function pickDetails(s) {
  const d = s?.details;
  if (!d) return {};
  if (typeof d === "object") return d;
  if (typeof d === "string") {
    try { return JSON.parse(d); } catch { return {}; }
  }
  return {};
}

function formatMoney(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return escapeHtml(String(v));
  return escapeHtml(n.toLocaleString("ru-RU"));
}

function buildTrashItemText(s) {
  const id = s.id;
  const cat = escapeHtml(s.category || "");
  const title = escapeHtml(s.title || "Услуга");

  const d = pickDetails(s);

  // hotel / accommodation / price (под разные формы)
  const hotel =
    d.hotelName || d.hotel || d.hotel_title || d.hotelTitle || "";
  const acc =
    d.accommodation || d.roomCategory || d.room || d.placement || "";
  const price =
    d.netPrice ?? d.price ?? s.price ?? "";

  // направление (если есть)
  const dir =
    [d.directionCountry, d.directionTo, d.city, d.directionFrom]
      .filter(Boolean)
      .join(" / ");

  const deletedAt = s.deleted_at
    ? new Date(s.deleted_at).toLocaleString("ru-RU")
    : "";

  let text =
    `🧺 <b>Выбрана услуга</b>\n\n` +
    `🧾 <b>ID:</b> <code>#${id}</code>\n` +
    (cat ? `📌 <b>Категория:</b> <b>${cat}</b>\n` : "") +
    `🧳 <b>${title}</b>\n`;

  if (dir) text += `📍 <b>Направление:</b> ${escapeHtml(dir)}\n`;
  if (hotel) text += `🏨 <b>Отель:</b> ${escapeHtml(hotel)}\n`;
  if (acc) text += `🛏 <b>Размещение:</b> ${escapeHtml(acc)}\n`;
  if (price !== "") text += `💰 <b>Цена:</b> ${formatMoney(price)}\n`;
  if (deletedAt) text += `🕒 <b>Удалено:</b> ${escapeHtml(deletedAt)}\n`;

  text += `\nЧто сделать?`;
  return text;
}

function buildTrashListKeyboard(items) {
  const buttons = items.slice(0, 20).map((s) => ({
    text: `#${s.id}`,
    callback_data: `trash:item:${s.id}`,
  }));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  // можно добавить "обновить"
  rows.push([{ text: "🔄 Обновить", callback_data: "trash:open" }]);
  rows.push([{ text: "⬅️ В меню", callback_data: "trash:menu" }]);

  return { inline_keyboard: rows };
}

async function fetchTrashItems(ctx) {
  const actorId = getActorId(ctx);
  const r = await axios.get(`/api/telegram/provider/${actorId}/services/deleted`);
  return r?.data?.services || r?.data?.items || [];
}

async function renderTrash(ctx, opts = {}) {
  const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
  
  const items = await fetchTrashItems(ctx);
  TRASH_ITEMS_BY_CHAT.set(String(chatId), items);
  
  const text = buildTrashListText(items);
  const reply_markup = buildTrashListKeyboard(items);

  // если пришли из callback — можно редактировать текущее сообщение
  const canEditFromCallback = Boolean(ctx.update?.callback_query?.message?.message_id);

  // если у нас запомнено messageId корзины — пытаемся редактировать именно его
  const saved = TRASH_MSG_BY_CHAT.get(String(chatId));
  const messageIdToEdit = saved?.messageId;

  // 1) Если вызываем из callback и сообщение то самое — просто editMessageText
  if (canEditFromCallback) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup });
      // запомним message_id текущего сообщения как "корзина"
      const mid = ctx.update.callback_query.message.message_id;
      TRASH_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: mid });
      return;
    } catch (e) {
      // если редактирование не удалось — fallback на отправку нового
    }
  }

  // 2) Если у нас есть сохранённый messageId корзины — пробуем редактировать его через API
  if (messageIdToEdit) {
    try {
      await ctx.telegram.editMessageText(chatId, messageIdToEdit, undefined, text, {
        parse_mode: "HTML",
        reply_markup,
      });
      return;
    } catch (e) {
      // не удалось (сообщение удалено/устарело) — отправим новое и перезапомним
      TRASH_MSG_BY_CHAT.delete(String(chatId));
    }
  }

  // 3) Иначе отправляем новое сообщение и запоминаем
  const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup });
  if (sent?.message_id) {
    TRASH_MSG_BY_CHAT.set(String(chatId), { chatId, messageId: sent.message_id });
  }
}

async function safeReply(ctx, text, extra) {
  const uid = ctx.from?.id;
  const chatId = ctx.chat?.id || uid;

  async function sendViaReply() {
    // ВАЖНО: не используем ctx.reply, потому что он обёрнут middleware-обёрткой
    // и «глотает» ошибки (возвращает null), ломая fallback-логику.
    if (!chatId) throw new Error("NO_CHAT_ID_FOR_REPLY");
    return bot.telegram.sendMessage(chatId, text, extra);
  }

  async function sendViaDM() {
    if (!uid) throw new Error("NO_USER_ID");
    return bot.telegram.sendMessage(uid, text, extra);
  }

  try {
    return await sendViaReply();
  } catch (e1) {
    try {
      return await sendViaDM();
    } catch (e2) {
      const msg = String(e2?.message || e1?.message || "");
      const code = e2?.code || e1?.code;

      const isConnReset =
        code === "ECONNRESET" ||
        msg.includes("ECONNRESET") ||
        msg.includes("network") ||
        msg.includes("FetchError");

      if (!isConnReset) throw e2;

      await new Promise((r) => setTimeout(r, 600));

      if (uid) return bot.telegram.sendMessage(uid, text, extra);
      throw e2;
    }
  }
}

// Если фото не отправилось — падаем в текст.
function stripTelegramHtml(input) {
  return String(input || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactTelegramCaption(input, maxLen = 950) {
  const raw = String(input || "").trim();
  if (raw.length <= maxLen) return raw;

  const cut = raw.slice(0, maxLen);
  const lastNl = cut.lastIndexOf("\n");
  const safeCut = lastNl > 250 ? cut.slice(0, lastNl) : cut;

  return `${safeCut.trim()}\n\n👁 Нажмите «Подробнее» или откройте в кабинете.`;
}

// Если фото не отправилось — падаем в текст.
// ВАЖНО: Telegram caption ограничен 1024 символами.
// Нельзя резать HTML на 1024 вслепую: можно разорвать <b>/<a>/<code> и получить raw HTML в чате.
async function safeReplyWithPhoto(ctx, photo, caption, extra = {}) {
  const cap = compactTelegramCaption(caption, 950);

  const send = async (opts) => {
    // ВАЖНО: не используем ctx.replyWithPhoto (middleware глотает ошибки).
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) throw new Error("NO_USER_ID");
    return bot.telegram.sendPhoto(chatId, photo, opts);
  };

  try {
    const opts = { caption: cap, parse_mode: "HTML", ...extra };
    return await send(opts);
  } catch (e1) {
    const desc =
      e1?.response?.description ||
      e1?.response?.data?.description ||
      e1?.message ||
      "";

    const isEntities = String(desc).toLowerCase().includes("can't parse entities");

    if (isEntities) {
      try {
        const opts2 = {
          ...extra,
          caption: stripTelegramHtml(cap).slice(0, 950),
        };
        delete opts2.parse_mode;
        return await send(opts2);
      } catch (e2) {
        console.error("[tg-bot] safeReplyWithPhoto failed (fallback also failed):",
          e2?.response?.data || e2?.message || e2
        );
      }
    } else {
      console.error("[tg-bot] safeReplyWithPhoto failed:",
        e1?.response?.data || e1?.message || e1
      );
    }

    const textExtra = { ...extra };
    delete textExtra.parse_mode;
    return await safeReply(ctx, stripTelegramHtml(cap) || "(фото)", textExtra);
  }
}

function statusLabelForManager(status) {
  return status === "accepted"
    ? "✅ Принято"
    : status === "booked"
    ? "⏳ Забронировано"
    : status === "rejected"
    ? "❌ Отклонено"
    : "🆕 Новый";
}

function parseManagerDirectReply(text) {
  if (!text) return null;
  const s = String(text).trim();

  // Форматы:
  // #123 текст
  // #123: текст
  // #123 - текст
  const m = s.match(/^#(\d+)\s*[:\-]?\s+([\s\S]+)$/);
  if (!m) return null;

  return {
    requestId: Number(m[1]),
    message: String(m[2] || "").trim(),
  };
}

function formatTashkentTime(ts) {
  try {
    if (!ts) return "";
    const d = new Date(ts);
    // Asia/Tashkent (UTC+5), 24h
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return parts; // например: 15.01.2026, 13:05
  } catch {
    return "";
  }
}

function replaceStatusLine(text, newStatusLabel) {
  if (typeof text !== "string") return text;

  // если строка статуса уже есть — заменяем
  if (text.includes("\nСтатус: ")) {
    return text.replace(
      /\nСтатус:\s.*(\n|$)/,
      `\nСтатус: ${newStatusLabel}\n`
    );
  }

  // если нет — аккуратно добавляем после заголовка
  return text.replace(
    /\n\n/,
    `\n\nСтатус: ${newStatusLabel}\n`
  );
}


/* ===================== EDIT WIZARD NAV (svc_edit_*) ===================== */

function editWizNavKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⏭ Пропустить", callback_data: "svc_edit:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_edit_back" },
          { text: "❌ Отмена", callback_data: "svc_edit_cancel" },
        ],
      ],
    },
  };
}


function editWizYesNoKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Да", callback_data: "svc_edit_bool:yes" },
          { text: "❌ Нет", callback_data: "svc_edit_bool:no" },
        ],
        [{ text: "⏭ Пропустить", callback_data: "svc_edit:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_edit_back" },
          { text: "❌ Отмена", callback_data: "svc_edit_cancel" },
        ],
      ],
    },
  };
}

function editWizKeyboardForPrompt(message = "") {
  const s = String(message || "").toLowerCase();
  return /да\s*\/\s*нет|ответьте\s+да\s*\/\s*нет|\?\s*\(текущее:/.test(s)
    ? editWizYesNoKeyboard()
    : editWizNavKeyboard();
}


function editConfirmKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💾 Сохранить", callback_data: "svc_edit_save" }],
        [{ text: "✏️ Продолжить редактирование", callback_data: "svc_edit_continue" }],
        [{ text: "❌ Отмена", callback_data: "svc_edit_cancel" }],
      ],
    },
  };
}


function editImagesKeyboard(images = []) {
  const rows = [];

  if (images.length) {
    const delRow = images.map((_, i) => ({
      text: `❌ ${i + 1}`,
      callback_data: `svc_edit_img_remove:${i}`,
    }));
    rows.push(delRow);
    rows.push([{ text: "🧹 Очистить все", callback_data: "svc_edit_img_clear" }]);
  }

  rows.push([
    { text: "⬅️ Назад", callback_data: "svc_edit_back" },
    { text: "✅ Готово", callback_data: "svc_edit_img_done" },
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function buildEditImagesKeyboard(draft) {
  const images = Array.isArray(draft?.images) ? draft.images : [];
  const rows = [];

  // Кнопки удаления по индексу (ограничим до 8, чтобы не раздувать клавиатуру)
  const max = Math.min(images.length, 8);
  if (max > 0) {
    const btns = [];
    for (let i = 0; i < max; i++) {
      btns.push(Markup.button.callback(`❌ ${i + 1}`, `svc_edit_img_remove:${i}`));
      // по 4 в ряд
      if (btns.length === 4) {
        rows.push(btns.splice(0, btns.length));
      }
    }
    if (btns.length) rows.push(btns);
  }

  rows.push([
    Markup.button.callback("🧹 Очистить все", "svc_edit_img_clear"),
    Markup.button.callback("✅ Готово", "svc_edit_img_done"),
  ]);

  return Markup.inlineKeyboard(rows);
}

async function handleSvcEditWizardPhoto(ctx) {
  // В проекте сейчас "источник правды" для редактирования — ctx.session.serviceDraft
  // (promptEditState() берёт данные оттуда). Поэтому здесь поддерживаем оба варианта.
  const step = String(ctx.session?.editWiz?.step || ctx.session?.state || "");
  const draft = ctx.session?.serviceDraft || ctx.session?.editDraft;

  if (step !== "svc_edit_images" || !draft) return false;

  const photos = ctx.message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    await safeReply(ctx, "⚠️ Пришлите фото (как изображение), чтобы добавить его к услуге.");
    return true;
  }

  // Берём самый большой размер
  const best = photos[photos.length - 1];
  const fileId = best?.file_id;
  if (!fileId) {
    await safeReply(ctx, "⚠️ Не удалось получить file_id. Попробуйте отправить фото ещё раз.");
    return true;
  }

  const tgRef = `tg:${fileId}`;
  if (!Array.isArray(draft.images)) draft.images = [];
  draft.images.push(tgRef);

  const count = draft.images.length;
  await safeReply(
    ctx,
    `✅ Фото добавлено. Сейчас в услуге: ${count} шт.\n\nОтправьте ещё фото или нажмите «✅ Готово».`,
    buildEditImagesKeyboard(draft)
  );

  return true;
}

async function promptEditState(ctx, state) {
  const draft = ctx.session?.serviceDraft || {};

  switch (state) {

    case "svc_edit_title":
      await safeReply(
        ctx,
        `📝 Название (текущее: ${draft.title || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    /* ===================== EVENT / TICKET ===================== */

    case "svc_edit_ticket_country":
      await safeReply(
        ctx,
        `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_ticket_city":
      await safeReply(
        ctx,
        `🏙 Город события (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_ticket_date":
      await safeReply(
        ctx,
        `📅 Дата события (текущее: ${draft.startDate || "(пусто)"}).\nФормат YYYY-MM-DD или YYYY.MM.DD, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    /* ===================== FLIGHT ===================== */

    case "svc_edit_flight_country":
      await safeReply(
        ctx,
        `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_flight_from":
      await safeReply(
        ctx,
        `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_flight_to":
      await safeReply(
        ctx,
        `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_flight_departure":
      await safeReply(
        ctx,
        `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_flight_return":
      await safeReply(
        ctx,
        `🛬 Дата рейса обратно (текущее: ${draft.returnFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_flight_details":
      await safeReply(
        ctx,
        `✈️ Детали рейса (текущее: ${draft.flightDetails || "(нет)"}).\nВведите текст, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    /* ===================== TOUR ===================== */

    case "svc_edit_tour_country":
      await safeReply(
        ctx,
        `🌍 Страна направления (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_from":
      await safeReply(
        ctx,
        `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_to":
      await safeReply(
        ctx,
        `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_start":
      await safeReply(
        ctx,
        `📅 Дата начала (текущее: ${draft.startDate || "(пусто)"}).\nФормат YYYY-MM-DD или YYYY.MM.DD, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_end":
      await safeReply(
        ctx,
        `📅 Дата окончания (текущее: ${draft.endDate || "(пусто)"}).\nФормат YYYY-MM-DD или YYYY.MM.DD, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_hotel":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите новое или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_roomcat":
      await safeReply(
        ctx,
        `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_tour_food":
      await safeReply(
        ctx,
        `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите (BB/HB/FB/AI/UAI) или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
      
    case "svc_edit_tour_insurance":
      await safeReply(
        ctx,
        `🛡 Страховка включена? (текущее: ${draft.insuranceIncluded ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_tour_early_checkin":
      await safeReply(
        ctx,
        `🏨 Раннее заселение? (текущее: ${draft.earlyCheckIn ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_tour_fast_track":
      await safeReply(
        ctx,
        `🛬 Arrival Fast Track? (текущее: ${draft.arrivalFastTrack ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
  return;

    /* ===================== HOTEL ===================== */

    case "svc_edit_hotel_country":
      await safeReply(
        ctx,
        `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_hotel_city":
      await safeReply(
        ctx,
        `🏙 Город (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_hotel_name":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_hotel_checkin":
      await safeReply(
        ctx,
        `📅 Дата заезда (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_hotel_checkout":
      await safeReply(
        ctx,
        `📅 Дата выезда (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_hotel_roomcat":
      await safeReply(
        ctx,
        `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_food":
      await safeReply(
        ctx,
        `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_halal":
      await safeReply(
        ctx,
        `🥗 Halal питание? (текущее: ${draft.halal ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_transfer":
      await safeReply(
        ctx,
        `🚗 Трансфер (текущее: ${draft.transfer || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_changeable":
      await safeReply(
        ctx,
        `🔁 Можно вносить изменения? (текущее: ${draft.changeable ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_pax":
      await safeReply(
        ctx,
        `👥 Количество человек (текущее: ${draft.adt || 0}/${draft.chd || 0}/${draft.inf || 0}).\nВведите в формате ADT/CHD/INF или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_insurance":
      await safeReply(
        ctx,
        `🛡 Страховка включена? (текущее: ${draft.insuranceIncluded ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_early_checkin":
      await safeReply(
        ctx,
        `🏨 Раннее заселение? (текущее: ${draft.earlyCheckIn ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    
    case "svc_edit_hotel_fast_track":
      await safeReply(
        ctx,
        `🛬 Arrival Fast Track? (текущее: ${draft.arrivalFastTrack ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
          
    case "svc_edit_images": {
      const images = ctx.session?.serviceDraft?.images || [];

      await safeReply(
        ctx,
        `🖼 Фото услуги\n\n` +
        `Сейчас: ${images.length} шт.\n\n` +
        `• Отправляйте фото — они добавятся\n` +
        `• Удаляйте кнопками ниже\n` +
        `• Нажмите «Готово», когда закончите`,
        editImagesKeyboard(images)
      );
      return;
    }

    /* ===================== PRICE ===================== */

    case "svc_edit_price":
      await safeReply(
        ctx,
        `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_grossPrice":
      await safeReply(
        ctx,
        `💳 Цена БРУТТО (текущее: ${draft.grossPrice || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    /* ===================== EXPIRATION ===================== */

    case "svc_edit_expiration":
      await safeReply(
        ctx,
        `⏳ Актуально до (YYYY-MM-DD, YYYY-MM-DD HH:mm) или "нет"\nТекущее: ${draft.expiration || "(нет)"}\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_isActive":
      await safeReply(
        ctx,
        `✅ Активна? (текущее: ${draft.isActive ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_confirm":
      await safeReply(
        ctx,
        "✅ Ок. Теперь можно продолжить редактирование или сохранить изменения.",
        editConfirmKeyboard()
      );
      return;

    default:
      await safeReply(
        ctx,
        "🤔 Не понял шаг редактирования. Нажмите ⬅️ Назад или ❌ Отмена.",
        editWizNavKeyboard()
      );
  }
}

// ===================== Логгер callback_query =====================
bot.use(async (ctx, next) => {
  try {
    if (ctx.callbackQuery?.data) {
      console.log("[tg] callback_query data =", ctx.callbackQuery.data);
    }
  } catch {}
  return next();
});

// ===================== ACTUAL REMINDER CALLBACK (svc_actual:...) =====================
// Эти кнопки приходят из напоминаний об актуальности. Обрабатывать должен тот же бот, который отправил кнопки.
bot.action(/^svc_actual:(\d+):(yes|no|extend7|ping)(?::.*)?$/, async (ctx) => {
  try {
    const cbId = ctx.callbackQuery?.id || null;
    const data = ctx.callbackQuery?.data || "";
    const fromChatId = ctx.chat?.id || ctx.from?.id || null;
    const tokenOverride = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

    const res = await handleServiceActualCallback({
      callbackQueryId: cbId,
      data,
      fromChatId,
      tokenOverride,
    });

    // если не наш обработчик — просто пропустим
    if (!res || !res.handled) {
      try { await ctx.answerCbQuery(); } catch {}
      return;
    }
  } catch (e) {
    console.error("[tg-bot] svc_actual handler error:", e?.response?.data || e?.message || e);
    // обязательно снимем “часики” в Telegram
    try { await ctx.answerCbQuery("Ошибка. Попробуйте ещё раз", { show_alert: true }); } catch {}
  }
});
// ===================== /ACTUAL REMINDER CALLBACK =====================

bot.action("svc_edit:skip", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    const currentState = String(
      ctx.session?.editWiz?.step || ctx.session?.state || ""
    );

    if (!currentState || !ctx.session?.serviceDraft) {
      await safeReply(
        ctx,
        "⚠️ Нечего пропускать. Откройте редактирование услуги заново."
      );
      return;
    }

    const state = currentState;
    const category = String(ctx.session.serviceDraft?.category || "").trim();

    const ticketOrder = [
      "svc_edit_title",
      "svc_edit_ticket_country",
      "svc_edit_ticket_city",
      "svc_edit_ticket_date",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    const flightOrder = [
      "svc_edit_title",
      "svc_edit_flight_country",
      "svc_edit_flight_from",
      "svc_edit_flight_to",
      "svc_edit_flight_departure",
      "svc_edit_flight_return",
      "svc_edit_flight_details",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    const hotelOrder = [
      "svc_edit_title",
      "svc_edit_hotel_country",
      "svc_edit_hotel_city",
      "svc_edit_hotel_name",
      "svc_edit_hotel_checkin",
      "svc_edit_hotel_checkout",
      "svc_edit_hotel_roomcat",
      "svc_edit_hotel_accommodation",
      "svc_edit_hotel_food",
      "svc_edit_hotel_halal",
      "svc_edit_hotel_transfer",
      "svc_edit_hotel_changeable",
      "svc_edit_hotel_pax",
      "svc_edit_hotel_insurance",
      "svc_edit_hotel_early_checkin",
      "svc_edit_hotel_fast_track",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    const tourOrder = [
      "svc_edit_title",
      "svc_edit_tour_country",
      "svc_edit_tour_from",
      "svc_edit_tour_to",
      "svc_edit_tour_start",
      "svc_edit_tour_end",
      "svc_edit_flight_departure",
      "svc_edit_flight_return",
      "svc_edit_flight_details",
      "svc_edit_tour_hotel",
      "svc_edit_tour_accommodation",
      "svc_edit_tour_roomcat",
      "svc_edit_tour_food",
      "svc_edit_tour_insurance",
      "svc_edit_tour_early_checkin",
      "svc_edit_tour_fast_track",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    let order = tourOrder;

    if (category === "refused_ticket" || category === "refused_event_ticket") {
      order = ticketOrder;
    } else if (category === "refused_flight") {
      order = flightOrder;
    } else if (category === "refused_hotel") {
      order = hotelOrder;
    } else {
      order = tourOrder;
    }

    if (state === "svc_edit_confirm") {
      await safeReply(
        ctx,
        "⚠️ Вы уже на шаге подтверждения.",
        editConfirmKeyboard()
      );
      return;
    }

    if (state === "svc_edit_images") {
      if (!Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
      ctx.session.wizardStack.push(state);

      ctx.session.state = "svc_edit_confirm";
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = "svc_edit_confirm";

      await promptEditState(ctx, "svc_edit_confirm");
      return;
    }

    const idx = order.indexOf(state);
    const nextState = idx >= 0 ? order[idx + 1] : null;

    if (!nextState) {
      await safeReply(ctx, "⚠️ Уже нечего пропускать на этом шаге.");
      return;
    }

    if (!Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
    ctx.session.wizardStack.push(state);

    ctx.session.state = nextState;
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = nextState;

    await promptEditState(ctx, nextState);
  } catch (e) {
    console.error("svc_edit:skip error", e);
    await safeReply(ctx, "⚠️ Ошибка при пропуске. Попробуйте ещё раз.");
  }
});

bot.action("svc_edit_back", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    const stack = Array.isArray(ctx.session.wizardStack)
      ? ctx.session.wizardStack
      : [];

    const prev = stack.pop();

    if (!prev) {
      await safeReply(ctx, "⏮ Назад больше некуда.", editWizNavKeyboard());
      return;
    }

    ctx.session.wizardStack = stack;
    ctx.session.state = prev;
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = prev;

    if (prev === "svc_edit_confirm") {
      await promptEditState(ctx, "svc_edit_confirm");
      return;
    }

    if (prev === "svc_edit_images") {
      await promptEditState(ctx, "svc_edit_images");
      return;
    }

    await promptEditState(ctx, prev);
  } catch (e) {
    console.error("[tg-bot] svc_edit_back error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Ошибка при возврате назад.");
  }
});


bot.action("svc_edit_cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!ctx.session) return;

    ctx.session.state = null;
    ctx.session.wizardStack = [];
    ctx.session.serviceDraft = null;
    ctx.session.editingServiceId = null;
    ctx.session.editWiz = null;

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    await safeReply(ctx, "❌ Редактирование отменено.");
  } catch (e) {
    console.error("[tg-bot] svc_edit_cancel error:", e?.response?.data || e);
  }
});


bot.action(/^pending:item:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const serviceId = Number(ctx.match?.[1]);
    const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
    const items = PENDING_ITEMS_BY_CHAT.get(String(chatId)) || [];
    const svc = items.find((x) => Number(x.id) === serviceId);

    if (!svc) {
      await safeReply(ctx, "⚠️ Не нашёл услугу в списке. Нажмите «Обновить».", {
        reply_markup: { inline_keyboard: [[{ text: "🔄 Обновить", callback_data: "pending:open" }]] },
      });
      return;
    }

    const d = pickDetails(svc);
    const title = escapeHtml(svc.title || d.title || d.hotel || d.hotelName || "Без названия");
    const categoryLabel = escapeHtml(CATEGORY_LABELS?.[svc.category] || svc.category || "Услуга");
    const submitted = svc.submitted_at ? escapeHtml(prettyDateTime(svc.submitted_at)) : "—";
    const text =
      `🕓 <b>Услуга на модерации #R${escapeHtml(svc.id)}</b>\n\n` +
      `📌 <b>${title}</b>\n` +
      `🏷 <b>Категория:</b> ${categoryLabel}\n` +
      `🕒 <b>Отправлено:</b> ${submitted}\n\n` +
      `Администратор проверяет данные и proof. После редактирования услуга вернётся в черновик и её нужно будет отправить повторно.`;

    await safeReply(ctx, text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Редактировать", callback_data: `svc_edit_start:${svc.id}` }],
          [{ text: "🌐 Открыть в кабинете", url: `${SITE_URL}/dashboard?from=tg&service=${svc.id}` }],
          [{ text: "⬅️ Назад", callback_data: "pending:open" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] pending:item error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось открыть услугу на модерации.");
  }
});

bot.action(/^draft:item:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Черновики доступны только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    const actorId = getActorId(ctx);
    const serviceId = Number(ctx.match[1]);
    if (!actorId || !serviceId) {
      await safeReply(ctx, "⚠️ Не удалось открыть черновик. Откройте бота в ЛС и попробуйте ещё раз.");
      return;
    }

    const { data } = await axios.get(`/api/telegram/provider/${actorId}/services/${serviceId}`);
    const svc = data?.service || data?.item || data?.data || null;

    if (!svc || Number(svc.id) !== serviceId) {
      await safeReply(ctx, "⚠️ Черновик не найден. Нажмите «Обновить черновики».");
      return;
    }

    if (String(svc.status || "draft").toLowerCase() !== "draft") {
      await safeReply(ctx, "ℹ️ Эта услуга уже не является черновиком. Открываю редактирование.");
      ctx.match[1] = String(serviceId);
      return;
    }

    const text = buildDraftDetailText(svc);
    const reply_markup = buildDraftDetailKeyboard(serviceId);

    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup, disable_web_page_preview: true });
    } catch {
      await safeReply(ctx, text, { parse_mode: "HTML", reply_markup, disable_web_page_preview: true });
    }
  } catch (e) {
    console.error("[tg-bot] draft:item error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось открыть черновик. Попробуйте обновить список.");
  }
});

bot.action(/^draft:continue:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Открываю черновик...");
    ctx.match = [ctx.match[0], ctx.match[1]];
    const serviceId = Number(ctx.match[1]);
    if (!serviceId) {
      await safeReply(ctx, "⚠️ Некорректный ID черновика.");
      return;
    }

    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Редактирование доступно только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    const isMorePage = String(ctx.callbackQuery?.data || "").endsWith(":more");
    if (!isMorePage) {
      ctx.session.cardsOffset = 0;
    }

    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз.");
      return;
    }

    const { data } = await axios.get(`/api/telegram/provider/${actorId}/services/${serviceId}`);
    const svc = data?.service || data?.item || data?.data || (data?.success && data?.service) || null;

    if (!svc || Number(svc.id) !== serviceId) {
      await safeReply(ctx, "⚠️ Черновик не найден.");
      return;
    }

    const category = String(svc.category || svc.type || "refused_tour").trim();
    const det = parseDetailsAny(svc.details);
    const draft = {
      id: svc.id,
      category,
      title: svc.title || det.title || "",
      price: det.netPrice ?? det.price ?? svc.price ?? "",
      grossPrice: det.grossPrice ?? svc.grossPrice ?? "",
      expiration: det.expiration || svc.expiration || "",
      isActive: typeof det.isActive === "boolean" ? det.isActive : (typeof svc.isActive === "boolean" ? svc.isActive : true),
      country: det.directionCountry || "",
      fromCity: det.directionFrom || "",
      toCity: det.directionTo || "",
      startDate: det.startDate || "",
      endDate: det.endDate || "",
      departureFlightDate: det.departureFlightDate || "",
      returnFlightDate: det.returnFlightDate || "",
      flightDetails: det.flightDetails || "",
      hotel: det.hotel || "",
      accommodation: det.accommodation || "",
      roomCategory: det.roomCategory || det.accommodationCategory || "",
      food: det.food || "",
      halal: typeof det.halal === "boolean" ? det.halal : false,
      transfer: det.transfer || "",
      changeable: typeof det.changeable === "boolean" ? det.changeable : false,
      insuranceIncluded: !!det.insuranceIncluded,
      earlyCheckIn: !!det.earlyCheckIn,
      arrivalFastTrack: !!det.arrivalFastTrack,
      adt: Number.isFinite(det.adt) ? det.adt : (Number.isFinite(det.accommodationADT) ? det.accommodationADT : 0),
      chd: Number.isFinite(det.chd) ? det.chd : (Number.isFinite(det.accommodationCHD) ? det.accommodationCHD : 0),
      inf: Number.isFinite(det.inf) ? det.inf : (Number.isFinite(det.accommodationINF) ? det.accommodationINF : 0),
      images: parseImagesAny(svc.images),
    };

    if (!ctx.session) ctx.session = {};
    ctx.session.serviceDraft = draft;
    ctx.session.editingServiceId = svc.id;
    ctx.session.wizardStack = [];
    ctx.session.state = "svc_edit_title";

    await safeReply(ctx, `✏️ Продолжаем черновик #${svc.id}\n\nНачнём с названия 👇`);
    await promptEditState(ctx, "svc_edit_title");
  } catch (e) {
    console.error("[tg-bot] draft:continue error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось продолжить черновик. Попробуйте открыть его ещё раз.");
  }
});

bot.action(/^svc_edit_start:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // 1) доступ только поставщику
    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Редактирование доступно только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    // 2) кто редактирует
    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз.");
      return;
    }

    const serviceId = Number(ctx.match[1]);
    if (!serviceId) {
      await safeReply(ctx, "⚠️ Некорректный ID услуги.");
      return;
    }

    // 3) грузим КОНКРЕТНУЮ услугу (надёжнее, чем искать в списке)
    const { data } = await axios.get(`/api/telegram/provider/${actorId}/services/${serviceId}`);
  
    const svc =
      data?.service ||
      data?.item ||
      data?.data ||
      (data?.success && data?.service) ||
      null;
  
    if (!svc || Number(svc.id) !== Number(serviceId)) {
      await safeReply(ctx, "⚠️ Услуга не найдена (возможно удалена/скрыта).");
      return;
    }

    const category = String(svc.category || svc.type || "refused_tour").trim();
    const det = parseDetailsAny(svc.details);

    // 4) собираем draft в формате, который ждёт твой edit-wizard
    const draft = {
      id: svc.id,
      category,

      // общие
      title: svc.title || det.title || "",
      price: det.netPrice ?? det.price ?? svc.price ?? "",
      grossPrice: det.grossPrice ?? svc.grossPrice ?? "",

      expiration: det.expiration || svc.expiration || "",
      isActive: typeof det.isActive === "boolean" ? det.isActive : (typeof svc.isActive === "boolean" ? svc.isActive : true),

      // туры
      country: det.directionCountry || "",
      fromCity: det.directionFrom || "",
      toCity: det.directionTo || "",
      startDate: det.startDate || "",
      endDate: det.endDate || "",
      departureFlightDate: det.departureFlightDate || "",
      returnFlightDate: det.returnFlightDate || "",
      flightDetails: det.flightDetails || "",
      hotel: det.hotel || "",
      accommodation: det.accommodation || "",

      // отели (wizard использует roomCategory / halal / transfer / changeable / adt/chd/inf)
      roomCategory: det.roomCategory || det.accommodationCategory || "",
      food: det.food || "",
      halal: typeof det.halal === "boolean" ? det.halal : false,
      transfer: det.transfer || "",
      changeable: typeof det.changeable === "boolean" ? det.changeable : false,

      insuranceIncluded: !!det.insuranceIncluded,
      earlyCheckIn: !!det.earlyCheckIn,
      arrivalFastTrack: !!det.arrivalFastTrack,

      // pax: поддержим оба варианта ключей (на случай старых данных)
      adt: Number.isFinite(det.adt) ? det.adt : (Number.isFinite(det.accommodationADT) ? det.accommodationADT : 0),
      chd: Number.isFinite(det.chd) ? det.chd : (Number.isFinite(det.accommodationCHD) ? det.accommodationCHD : 0),
      inf: Number.isFinite(det.inf) ? det.inf : (Number.isFinite(det.accommodationINF) ? det.accommodationINF : 0),

      // author_tour structured fields
      tourFormat: det.tourFormat || det.format || "",
      stays: Array.isArray(det.stays) ? det.stays : [],
      staysText: det.staysText || "",
      programDays: Array.isArray(det.programDays) ? det.programDays : [],
      programDaysText: det.programDaysText || det.program || "",
      program: det.program || det.programDaysText || "",
      included: Array.isArray(det.included) ? det.included : (det.includedText ? String(det.includedText).split(/\n|;|•/).map((x) => x.trim()).filter(Boolean) : []),
      notIncluded: Array.isArray(det.notIncluded) ? det.notIncluded : (det.notIncludedText ? String(det.notIncludedText).split(/\n|;|•/).map((x) => x.trim()).filter(Boolean) : []),
      minPax: det.minPax || "",
      maxPax: det.maxPax || "",
      languages: Array.isArray(det.languages)
        ? det.languages
        : Array.isArray(det.guideLanguages)
          ? det.guideLanguages
          : (det.guideLanguage || det.language ? String(det.guideLanguage || det.language).split(/,|\n|;|•/).map((x) => x.trim()).filter(Boolean) : []),
      guideLanguage: det.guideLanguage || det.language || "",
      language: det.language || det.guideLanguage || "",
      meetingPoint: det.meetingPoint || "",
      cancellationPolicy: det.cancellationPolicy || det.cancelPolicy || "",
      cancelPolicy: det.cancelPolicy || det.cancellationPolicy || "",

      images: parseImagesAny(svc.images),
    };

    // 5) стартуем wizard
    if (!ctx.session) ctx.session = {};
    ctx.session.serviceDraft = draft;
    ctx.session.editingServiceId = svc.id;
    ctx.session.wizardStack = [];

    if (category === "author_tour") {
      // Для author_tour редактирование должно идти тем же мастером, что и создание.
      // Это сохраняет одинаковые шаги в Telegram create/edit и не уводит в старый universal-flow.
      ctx.session.editWiz = null;
      ctx.session.state = "svc_author_title";

      await safeReply(ctx, `✏️ Редактирование авторского тура #${svc.id}\n\nШаги редактирования такие же, как при создании 👇`);
      await promptWizardState(ctx, "svc_author_title");
      return;
    }

    ctx.session.state = "svc_edit_title";

    await safeReply(ctx, `✏️ Редактирование услуги #${svc.id}\n\nНачнём 👇`);
    await promptEditState(ctx, "svc_edit_title");
  } catch (e) {
    console.error("[tg-bot] svc_edit_start error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось запустить редактирование. Попробуйте позже.");
  }
});

bot.action(/^trash:menu$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // возвращаем главное меню (reply keyboard)
    const role = "provider"; // в твоём боте провайдер в этом меню
    await ctx.reply("🏠 Главное меню", getMainMenuKeyboard(role));
  } catch (e) {
    console.error("[bot] trash:menu error:", e?.message || e);
    return ctx.reply("❌ Ошибка.");
  }
});

async function finishEditWizard(ctx) {
  const actorId = getActorId(ctx);
  const draft = ctx.session?.serviceDraft;

  if (!draft?.id) {
    await safeReply(ctx, "⚠️ Не найден черновик редактирования.");
    resetServiceWizard(ctx);
    return;
  }

  try {
    const title = String(draft.title || "").trim();
    const category = String(draft.category || "").trim();

    const isHotel = category === "refused_hotel";
    const isTicket =
      category === "refused_ticket" || category === "refused_event_ticket";
    const isFlight = category === "refused_flight";
    const isTour = category === "refused_tour";

    const country = String(draft.country || "").trim();
    const fromCity = String(draft.fromCity || "").trim();
    const toCity = String(draft.toCity || "").trim();
    const startDate = String(draft.startDate || "").trim();
    const endDate = String(draft.endDate || "").trim();

    if (!title) {
      await safeReply(ctx, "⚠️ Укажите *Название* (обязательное поле).", {
        parse_mode: "Markdown",
        ...editWizNavKeyboard(),
      });
      ctx.session.state = "svc_edit_title";
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = "svc_edit_title";
      await promptEditState(ctx, "svc_edit_title");
      return;
    }

    if (!country) {
      const next = isHotel
        ? "svc_edit_hotel_country"
        : isTicket
        ? "svc_edit_ticket_country"
        : isFlight
        ? "svc_edit_flight_country"
        : "svc_edit_tour_country";

      await safeReply(ctx, "⚠️ Укажите *Страну* (обязательное поле).", {
        parse_mode: "Markdown",
        ...editWizNavKeyboard(),
      });
      ctx.session.state = next;
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = next;
      await promptEditState(ctx, next);
      return;
    }

    if (isTicket) {
      if (!toCity) {
        await safeReply(ctx, "⚠️ Укажите *Город события* (обязательное поле).", {
          parse_mode: "Markdown",
          ...editWizNavKeyboard(),
        });
        ctx.session.state = "svc_edit_ticket_city";
        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = "svc_edit_ticket_city";
        await promptEditState(ctx, "svc_edit_ticket_city");
        return;
      }

      if (!startDate) {
        await safeReply(ctx, "⚠️ Укажите *Дату события* (обязательное поле).", {
          parse_mode: "Markdown",
          ...editWizNavKeyboard(),
        });
        ctx.session.state = "svc_edit_ticket_date";
        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = "svc_edit_ticket_date";
        await promptEditState(ctx, "svc_edit_ticket_date");
        return;
      }
    } else if (isFlight) {
      if (!fromCity || !toCity) {
        const next = !fromCity ? "svc_edit_flight_from" : "svc_edit_flight_to";
        await safeReply(
          ctx,
          "⚠️ Укажите *города вылета и прибытия* (обязательные поля).",
          { parse_mode: "Markdown", ...editWizNavKeyboard() }
        );
        ctx.session.state = next;
        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = next;
        await promptEditState(ctx, next);
        return;
      }
    } else if (isTour) {
      if (!fromCity || !toCity) {
        const next = !fromCity ? "svc_edit_tour_from" : "svc_edit_tour_to";
        await safeReply(
          ctx,
          "⚠️ Укажите *города вылета и прибытия* (обязательные поля).",
          { parse_mode: "Markdown", ...editWizNavKeyboard() }
        );
        ctx.session.state = next;
        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = next;
        await promptEditState(ctx, next);
        return;
      }
    } else if (isHotel) {
      if (!toCity) {
        await safeReply(ctx, "⚠️ Укажите *Город* (обязательное поле).", {
          parse_mode: "Markdown",
          ...editWizNavKeyboard(),
        });
        ctx.session.state = "svc_edit_hotel_city";
        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = "svc_edit_hotel_city";
        await promptEditState(ctx, "svc_edit_hotel_city");
        return;
      }
    }

    if (draft.price != null && draft.grossPrice != null) {
      const ok = await validateGrossNotLessThanNet(
        ctx,
        draft.price,
        draft.grossPrice,
        "svc_edit_grossPrice"
      );
      if (!ok) return;
    }

    const expirationValue =
      draft.expiration === "" ? null : draft.expiration ?? null;

    const details = {
      category,

      netPrice: draft.price ?? null,
      price: draft.price ?? null,
      grossPrice: draft.grossPrice ?? null,

      directionCountry: country || "",
      directionFrom: isTicket || isHotel ? "" : fromCity || "",
      directionTo: toCity || "",

      country: country || "",
      fromCity: isTicket || isHotel ? "" : fromCity || "",
      toCity: toCity || "",

      startDate: startDate || "",
      endDate: isTicket || isFlight ? "" : endDate || "",

      hotel: isTicket || isFlight ? "" : String(draft.hotel || "").trim(),
      accommodation:
        isTicket || isFlight ? "" : String(draft.accommodation || "").trim(),

      accommodationCategory:
        isTicket || isFlight ? "" : String(draft.roomCategory || "").trim(),
      roomCategory:
        isTicket || isFlight ? "" : String(draft.roomCategory || "").trim(),

      food: isTicket || isFlight ? "" : String(draft.food || "").trim(),
      halal: isHotel ? !!draft.halal : false,
      transfer: isTicket ? "" : String(draft.transfer || "").trim(),
      changeable: isHotel ? !!draft.changeable : false,

      insuranceIncluded: !isTicket && !isFlight ? !!draft.insuranceIncluded : false,
      earlyCheckIn: !isTicket && !isFlight ? !!draft.earlyCheckIn : false,
      arrivalFastTrack: !isTicket && !isFlight ? !!draft.arrivalFastTrack : false,

      adt: isHotel ? Number(draft.adt ?? 0) : 0,
      chd: isHotel ? Number(draft.chd ?? 0) : 0,
      inf: isHotel ? Number(draft.inf ?? 0) : 0,

      departureFlightDate:
        isTicket || isHotel
          ? null
          : String(draft.departureFlightDate || "").trim() || null,

      returnFlightDate:
        isTicket || isHotel
          ? null
          : String(draft.returnFlightDate || "").trim() || null,

      flightDetails:
        isTicket || isHotel
          ? null
          : String(draft.flightDetails || "").trim() || null,

      expiration: expirationValue,
      urgency: draft.urgency || null,
      urgencyLabel: urgencyLabel(draft.urgency),
      isActive: !!draft.isActive,
    };

    const payload = {
      title,
      category: category || undefined,
      price: draft.price ?? null,
      grossPrice: draft.grossPrice ?? null,
      status: "pending",
      expiration: expirationValue,
      isActive: !!draft.isActive,
      details,
      ...(Array.isArray(draft.images) ? { images: draft.images } : {}),
    };

    if (!payload.category) delete payload.category;

    console.log("[tg-bot] finishEditWizard payload:", {
      actorId,
      serviceId: draft.id,
      category,
      payload,
    });

    const { data } = await axios.patch(
      `/api/telegram/provider/${actorId}/services/${draft.id}`,
      payload
    );

    if (!data?.success) {
      console.log("[tg-bot] update service failed:", data);
      await safeReply(ctx, "⚠️ Не удалось сохранить изменения.");
      return;
    }

    await safeReply(ctx, `✅ Изменения сохранены (#${draft.id}).`);

      // 👉 ПЕРЕХОД В PROOF
      ctx.session.awaitingProofForServiceId = draft.id;
      ctx.session.awaitingProofForCategory = category;
      
      // На этапе proof старый edit/create wizard больше не должен перехватывать текст «ГОТОВО».
      ctx.session.state = null;
      ctx.session.editWiz = null;
      ctx.session.wizardStack = [];
      
      await replyProofUploadPrompt(ctx, {
        serviceId: draft.id,
        category,
        isEditMode: true,
      });
      
      return;
  } catch (e) {
    console.error("[tg-bot] finishEditWizard error:", {
      message: e?.message || null,
      responseData: e?.response?.data || null,
      status: e?.response?.status || null,
    });
    await safeReply(ctx, "⚠️ Ошибка сохранения изменений.");
  } finally {
  if (!ctx.session?.awaitingProofForServiceId) {
    resetServiceWizard(ctx);

    await safeReply(ctx, "Что делаем дальше? 👇", {
      reply_markup: {
        keyboard: [
          [{ text: "📋 Мои услуги" }],
          [{ text: "➕ Добавить услугу" }],
          [{ text: "🏠 Главное меню" }],
        ],
        resize_keyboard: true,
      },
    });
  }
}
}

function logUpdate(ctx, label = "update") {
  try {
    const fromId = ctx.from?.id;
    const username = ctx.from?.username;
    const type = ctx.updateType;
    const subTypes = ctx.updateSubTypes;
    console.log("[tg-bot]", label, { type, subTypes, fromId, username });
  } catch (_) {}
}

// Категории, для которых бот обязан запросить proof перед отправкой на модерацию.
// Важно: используется и при создании, и при редактировании.
const proofRequiredCategories = PROOF_REQUIRED_CATEGORIES;

// Маппинг подписей для категорий
const CATEGORY_LABELS = {
  refused_tour: "Отказной тур",
  author_tour: "Авторский тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Отказной билет",
};

// Emoji по категориям
const CATEGORY_EMOJI = {
  refused_tour: "📍",
  author_tour: "🧭",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
};

function extractStars(details) {
  const d = details || {};
  const raw = String(d.accommodationCategory || d.roomCategory || "").trim();
  if (!raw) return null;

  const m = raw.match(/([1-7])\s*\*|⭐\s*([1-7])/);
  const stars = m ? Number(m[1] || m[2]) : null;
  if (!stars) return null;

  return `⭐️ ${stars}*`;
}

function prettyDateTime(value) {
  if (!value) return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return s;
  const [, y, mm, dd, hh, mi] = m;
  if (hh && mi) return `${dd}.${mm}.${y} ${hh}:${mi}`;
  return `${dd}.${mm}.${y}`;
}

function parseDateSafe(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  const s2 = s.replace(/\./g, "-");
  d = new Date(s2);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  return {};
}

function getServiceDisplayTitle(svc) {
  const d = parseDetailsAny(svc?.details);

  // refused_tour / author_tour
  if (d?.title) return normalizeTitleSoft(String(d.title));

  // refused_hotel (разные варианты ключей)
  if (d?.hotelName) return normalizeTitleSoft(String(d.hotelName));
  if (d?.hotel) return normalizeTitleSoft(String(d.hotel));

  // fallback
  if (svc?.title) return normalizeTitleSoft(String(svc.title));
  if (svc?.name) return normalizeTitleSoft(String(svc.name));

  return "";
}

async function fetchTelegramService(serviceId, role) {
  try {
    const { data } = await axios.get(`/api/telegram/service/${serviceId}`, {
      params: { role },
    });
    if (!data?.success || !data?.service) return null;
    return data.service;
  } catch {
    return null;
  }
}

function parseImagesAny(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images;

  if (typeof images === "string") {
    const s = images.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [s];
    }
  }

  // на всякий случай (если вдруг объект)
  if (typeof images === "object") {
    const u =
      images.url ||
      images.src ||
      images.path ||
      images.location ||
      images.href ||
      images.imageUrl ||
      images.image_url ||
      null;
    return u ? [String(u)] : [];
  }

  return [];
}

function getStartDateForSort(svc) {
  const d = parseDetailsAny(svc.details);
  const cat = String(svc.category || svc.type || "").toLowerCase();

  const pick = (...keys) => {
    for (const k of keys) {
      const v = d?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v instanceof Date) return v;
    }
    return null;
  };

  let raw =
    (cat === "refused_hotel" &&
      pick(
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "arrivalDate",
        "arrival_date",
        "startDate",
        "start_date"
      )) ||
    (cat === "refused_ticket" &&
      pick("eventDate", "event_date", "date", "startDate", "start_date")) ||
    (cat === "refused_flight" &&
      pick(
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "startFlightDate",
        "start_flight_date",
        "startDate",
        "start_date"
      )) ||
    pick(
      "departureFlightDate",
      "departureDate",
      "departure_date",
      "startFlightDate",
      "start_flight_date",
      "startDate",
      "start_date",
      "dateFrom",
      "date_from",
      "fromDate",
      "from_date",
      "beginDate",
      "begin_date"
    );

  let dt = parseDateSafe(raw);
  if (dt) return dt;

  raw = pick(
    "endDate",
    "end_date",
    "checkoutDate",
    "checkOutDate",
    "checkout_date",
    "returnFlightDate",
    "return_date"
  );
  dt = parseDateSafe(raw);
  if (dt) return dt;

  dt = parseDateSafe(svc.startDate || svc.start_date || svc.date);
  return dt;
}

function pickPrice(details, svc, role) {
  const d = details || {};
  if (role === "provider") {
    return d.netPrice ?? d.price ?? d.grossPrice ?? svc.price ?? null;
  }
  return d.grossPrice ?? d.price ?? d.netPrice ?? svc.price ?? null;
}

function buildServiceUrl(serviceId) {
  const tpl = SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}";
  return tpl
    .replace(/\{SITE_URL\}/g, SITE_URL)
    .replace(/\{id\}/g, String(serviceId));
}

function buildBotStartUrl() {
  return BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=start` : SITE_URL;
}

function getExpiryBadge(detailsRaw, svc) {
  const d = parseDetailsAny(detailsRaw);
  const expirationRaw = d.expiration || svc?.expiration || null;
  if (!expirationRaw) return null;

  const exp = parseDateFlexible(expirationRaw);
  if (!exp) return null;

  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow0 = new Date(today0.getTime() + 24 * 60 * 60 * 1000);
  const exp0 = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());

  if (exp0.getTime() === today0.getTime()) return "⏳ истекает сегодня";
  if (exp0.getTime() === tomorrow0.getTime()) return "⏳ истекает завтра";
  return null;
}

/* ===================== DATES ===================== */

function normalizeDateInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();
  if (/^(нет|пропустить|skip|-)\s*$/i.test(txt)) return null;

  let y, mm, dd;

  const iso = txt.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (iso) {
    y = Number(iso[1]);
    mm = Number(iso[2]);
    dd = Number(iso[3]);
  } else {
    const dmy = txt.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!dmy) return null;
    dd = Number(dmy[1]);
    mm = Number(dmy[2]);
    y = Number(dmy[3]);
  }

  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  const dt = new Date(y, mm - 1, dd);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== y ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return null;
  }

  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function normalizeDateTimeInput(raw) {
  return normalizeDateTimeInputHelper(raw);
}

// Строгая валидация даты/времени после normalizeDateTimeInputHelper.
// Нужна, чтобы отсеять случаи вроде "2026.29.01" (месяц=29) — helper может пропустить по regex.
function isValidNormalizedDateTime(norm) {
  if (!norm) return false;
  const s = String(norm).trim();

  // допускаем:
  // - YYYY-MM-DD
  // - YYYY-MM-DD HH:mm
  const m = s.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:\s+([0-9]{2}):([0-9]{2}))?$/
  );
  if (!m) return false;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mm = m[5] != null ? Number(m[5]) : 0;

  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (hh < 0 || hh > 23) return false;
  if (mm < 0 || mm > 59) return false;

  // проверяем реальную календарную дату (учёт 30/31 и февраля)
  const dt = new Date(y, mo - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return false;
  if (dt.getFullYear() !== y) return false;
  if (dt.getMonth() !== mo - 1) return false;
  if (dt.getDate() !== d) return false;
  if (dt.getHours() !== hh) return false;
  if (dt.getMinutes() !== mm) return false;

  return true;
}

function normalizeDateTimeInputStrict(raw) {
  const s = String(raw || "").trim();

  // принимает: YYYY-MM-DD HH:mm  и  YYYY.MM.DD HH:mm
  const m = s.match(/^(\d{4})[-.](\d{2})[-.](\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;

  // приводим к единому виду: YYYY-MM-DD HH:mm
  const norm = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;

  // строгая проверка реальной даты/времени (чтобы не пропустить 2026-29-01)
  if (!isValidNormalizedDateTime(norm)) return null;

  return norm;
}


function isPastDateTime(value) {
  const dt = parseDateFlexible(value);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

function ymdToLocalEndOfDay(value) {
  const m = String(value || "").trim().match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function getDraftTripStartForExpiration(draft) {
  const category = String(draft?.category || "").toLowerCase();
  if (category === "refused_flight") {
    return draft?.departureFlightDate || draft?.startFlightDate || draft?.startDate || null;
  }
  return draft?.startDate || draft?.departureFlightDate || draft?.startFlightDate || null;
}

function isExpirationAfterTripStart(draft, expirationValue) {
  const exp = parseDateFlexible(expirationValue);
  const tripStartRaw = getDraftTripStartForExpiration(draft);
  const tripStartEnd = ymdToLocalEndOfDay(tripStartRaw);
  if (!exp || !tripStartEnd) return false;
  return exp.getTime() > tripStartEnd.getTime();
}

function dateAtLocalMidnight(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isPastYMD(ymd) {
  const dt = dateAtLocalMidnight(ymd);
  if (!dt) return false;
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return dt.getTime() < today0.getTime();
}

function isBeforeYMD(a, b) {
  const da = dateAtLocalMidnight(a);
  const db = dateAtLocalMidnight(b);
  if (!da || !db) return false;
  return da.getTime() < db.getTime();
}

/* ===================== IMAGES ===================== */
/**
 * В services.images могут быть:
 * - base64 data:image...
 * - http(s) URL
 * - относительный /path
 * - "tg:<file_id>"
 */
function getFirstImageUrl(svc) {
  // 0) разные варианты поля "готовая ссылка"
  const directCandidates = [
    svc?.imageUrl,
    svc?.image_url,
    svc?.thumbnailUrl,
    svc?.thumbnail_url,
    svc?.image,
    svc?.photo,
  ];

  for (const c of directCandidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  let arr = svc?.images ?? null;

  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }
  if (!Array.isArray(arr)) arr = [];

  // fallback: фото из Telegram, если нет images
  if (!arr.length) {
    const d = parseDetailsAny(svc.details);
    const fid = (d.telegramPhotoFileId || "").trim();
    if (fid) return `tgfile:${fid}`;
    return null;
  }

  let v = arr[0];
  if (v && typeof v === "object") {
    v =
      v.url ||
      v.src ||
      v.path ||
      v.location ||
      v.href ||
      v.imageUrl ||
      v.image_url ||
      null;
  }
  if (typeof v !== "string") return null;

  v = v.trim();
  if (!v) return null;

  if (v.startsWith("tg:")) {
    const fileId = v.slice(3).trim();
    return fileId ? `tgfile:${fileId}` : null;
  }

  if (v.startsWith("data:image")) {
    // ✅ Telegram должен тянуть с прямого домена backend (Railway)
    return `${TG_IMAGE_BASE}/api/telegram/service-image/${svc.id}`;
  }
  
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  
  // относительные пути:
  if (v.startsWith("/")) return TG_IMAGE_BASE + v;
  
  // <-- ключевой фикс: если путь без "/" — тоже собираем URL
  return `${TG_IMAGE_BASE}/${v.replace(/^\/+/, "")}`;

}

/**
 * ✅ Точечный фикс по задаче:
 * - больше НЕ показываем "Отказной тур: ..." в inline description
 * - описание = только маршрут/страна/даты/цена (без префикса категории)
 */
function buildInlineDescription(svc, category, roleForInline) {
  const d = parseDetailsAny(svc.details);
  const parts = [];

  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry ? normalizeWeirdSeparator(d.directionCountry) : null;

  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(to);
  else if (from) parts.push(from);

  if (country) parts.push(country);

  const startRaw = d.departureFlightDate || d.startDate || d.startFlightDate || null;
  const endRaw = d.returnFlightDate || d.endDate || d.endFlightDate || null;

  if (startRaw && endRaw && String(startRaw) !== String(endRaw)) {
    parts.push(`${prettyDateTime(startRaw)}–${prettyDateTime(endRaw)}`);
  } else if (startRaw) {
    parts.push(prettyDateTime(startRaw));
  }

  const priceRaw = pickPrice(d, svc, roleForInline);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  if (priceWithCur) parts.push(priceWithCur);

  const s = parts.filter(Boolean).join(" · ").trim();
  return truncate(s || " ", 96);
}

/* ===================== ROLE RESOLUTION ===================== */

async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") return "provider";

  const actorId = getActorId(ctx);
  if (!actorId) return ctx.session?.role || null;

  try {
    const resProv = await axios.get(`/api/telegram/profile/provider/${actorId}`);
    if (resProv.data && resProv.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "provider";
      ctx.session.linked = true;
      return "provider";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] ensureProviderRole error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return ctx.session?.role || null;
}

async function ensureClientRole(ctx) {
  if (ctx.session?.role === "client") return "client";

  const actorId = getActorId(ctx);
  if (!actorId) return ctx.session?.role || null;

  try {
    const resClient = await axios.get(`/api/telegram/profile/client/${actorId}`);
    if (resClient.data && resClient.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "client";
      ctx.session.linked = true;
      return "client";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] ensureClientRole error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return ctx.session?.role || null;
}

async function resolveRoleByUserId(userId, ctx) {
  try {
    const resProv = await axios.get(`/api/telegram/profile/provider/${userId}`);
    if (resProv.data && resProv.data.success) {
      if (ctx && ctx.session) {
        ctx.session.role = "provider";
        ctx.session.linked = true;
      }
      return "provider";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] resolveRoleByUserId provider error:",
        e?.response?.data || e.message || e
      );
    }
  }

  try {
    const resClient = await axios.get(`/api/telegram/profile/client/${userId}`);
    if (resClient.data && resClient.data.success) {
      if (ctx && ctx.session) {
        ctx.session.role = "client";
        ctx.session.linked = true;
      }
      return "client";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] resolveRoleByUserId client error:",
        e?.response?.data || e.message || e
      );
    }
  }

  return null;
}

/* ===================== WIZARD HELPERS (create refused_tour / refused_hotel) ===================== */

function resetServiceWizard(ctx) {
  if (!ctx.session) return;
  ctx.session.state = null;
  ctx.session.serviceDraft = null;
  ctx.session.wizardStack = null;
}

function isCreateWizardState(state) {
  const s = String(state || "");
  return (
    s === "svc_create_choose_category" ||
    s.startsWith("svc_create_") ||
    s.startsWith("svc_hotel_") ||
    s.startsWith("svc_author_") ||
    s.startsWith("author_stay_") ||
    s.startsWith("author_day_") ||
    s.startsWith("author_included_") ||
    s.startsWith("author_excluded_") ||
    s.startsWith("author_language_")
  );
}

let _providerDraftsReady = false;

async function ensureProviderServiceDraftsTable() {
  if (!pool || _providerDraftsReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_provider_service_drafts (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      provider_id BIGINT,
      category TEXT,
      step TEXT NOT NULL DEFAULT 'category',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      wizard_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tg_provider_service_drafts_chat_status
      ON telegram_provider_service_drafts(chat_id, status, updated_at DESC)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_provider_service_drafts_one_active
      ON telegram_provider_service_drafts(chat_id)
      WHERE status = 'draft'
  `);

  _providerDraftsReady = true;
}

async function resolveProviderIdByTelegramChatId(chatId) {
  if (!pool || !chatId) return null;
  try {
    const r = await pool.query(
      `
      SELECT id
        FROM providers
       WHERE telegram_chat_id::text = $1
          OR tg_chat_id::text = $1
          OR telegram_refused_chat_id::text = $1
          OR telegram_web_chat_id::text = $1
       LIMIT 1
      `,
      [String(chatId)]
    );
    return r.rows?.[0]?.id ? Number(r.rows[0].id) : null;
  } catch (e) {
    console.error("[tg-bot] resolveProviderIdByTelegramChatId error:", e?.message || e);
    return null;
  }
}

async function getActiveProviderServiceDraft(ctx) {
  if (!pool) return null;
  const chatId = getActorId(ctx) || ctx.from?.id || ctx.chat?.id || null;
  if (!chatId) return null;

  try {
    await ensureProviderServiceDraftsTable();

    const r = await pool.query(
      `
      SELECT *
        FROM telegram_provider_service_drafts
       WHERE chat_id = $1
         AND status = 'draft'
       ORDER BY updated_at DESC
       LIMIT 1
      `,
      [Number(chatId)]
    );

    return r.rows?.[0] || null;
  } catch (e) {
    console.error("[tg-bot] getActiveProviderServiceDraft error:", e?.message || e);
    return null;
  }
}

function hydrateProviderDraftSession(ctx, row) {
  if (!row || !ctx) return false;
  if (!ctx.session) ctx.session = {};

  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};

  const images =
    Array.isArray(row.images)
      ? row.images
      : Array.isArray(payload.images)
        ? payload.images
        : [];

  const legacyDraftStateMap = {
    svc_author_transport: "svc_author_cancel",
    svc_author_guide: "svc_author_cancel",
  };
  
    const rawStep = String(row.step || "svc_create_choose_category");
    const normalizedStep = legacyDraftStateMap[rawStep] || rawStep;
  
    const wizardStack = (Array.isArray(row.wizard_stack) ? row.wizard_stack : [])
      .map((s) => legacyDraftStateMap[String(s || "")] || s)
      .filter((s) => !["svc_author_transport", "svc_author_guide"].includes(String(s || "")));

  ctx.session.serviceDraft = {
    ...payload,
    category: row.category || payload.category || null,
    images,
  };
  ctx.session.wizardStack = wizardStack;
  ctx.session.state = normalizedStep;
  ctx.session.editWiz = null;
  ctx.session.editDraft = null;
  ctx.session.editingServiceId = null;
  ctx.session.__draftRestoreOffered = false;

  return true;
}

function providerDraftCategoryLabel(category) {
  const c = String(category || "").toLowerCase();
  if (c === "author_tour") return "Авторский тур";
  if (c === "refused_hotel") return "Отказной отель";
  if (c === "refused_flight") return "Отказной авиабилет";
  if (c === "refused_ticket" || c === "refused_event_ticket") return "Отказной билет";
  if (c === "refused_tour") return "Отказной тур";
  return "Категория ещё не выбрана";
}

function providerDraftFilledCount(payload = {}) {
  if (!payload || typeof payload !== "object") return 0;
  const ignored = new Set(["images", "telegramPhotoFileId"]);
  return Object.entries(payload).filter(([key, value]) => {
    if (ignored.has(key)) return false;
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }).length;
}

async function replyProviderDraftResumePrompt(ctx, row) {
  const payload =
    row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  const category = row?.category || payload.category || "";
  const filled = providerDraftFilledCount(payload);
  const updatedAt = row?.updated_at
    ? new Date(row.updated_at).toLocaleString("ru-RU", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const stepLabels = {
    svc_create_choose_category: "Выбор категории",
  
    svc_author_title: "Название авторского тура",
    svc_author_country: "Страна направления",
    svc_author_from: "Город отправления",
    svc_author_to: "Маршрут / город прибытия",
    svc_author_start: "Дата начала тура",
    svc_author_end: "Дата окончания тура",
    svc_author_format: "Формат тура",
    svc_author_stays: "Проживание тура",
    author_stay_city: "Проживание: город",
    author_stay_hotel: "Проживание: отель",
    author_stay_nights: "Проживание: количество ночей",
    svc_author_program_days: "Программа тура",
    author_day_date: "Программа: дата дня",
    author_day_route: "Программа: маршрут дня",
    author_day_title: "Программа: заголовок дня",
    author_day_items: "Программа: пункты дня",
    svc_author_included: "Что включено",
    svc_author_not_included: "Что не включено",
    author_included_custom: "Что включено: свой пункт",
    author_excluded_custom: "Что не включено: свой пункт",
    svc_author_pax: "Количество человек",
    svc_author_language: "Язык гида",
    author_language_custom: "Язык гида: свой вариант",
    svc_author_meeting: "Место встречи",
    svc_author_cancel: "Условия отмены",
  
    svc_create_title: "Название услуги",
    svc_create_tour_country: "Страна направления",
    svc_create_tour_from: "Город отправления",
    svc_create_tour_to: "Город прибытия",
    svc_create_tour_start: "Дата начала тура",
    svc_create_tour_end: "Дата окончания тура",
    svc_create_flight_departure: "Дата рейса вылета",
    svc_create_flight_return: "Дата рейса обратно",
    svc_ticket_event_date: "Дата мероприятия / билета",
    svc_create_flight_details: "Детали рейса",
    svc_create_tour_hotel: "Отель",
    svc_create_tour_accommodation: "Размещение",
    svc_create_tour_roomcat: "Категория номера",
    svc_create_tour_food: "Питание",
    svc_create_tour_insurance: "Страховка",
    svc_create_tour_early_checkin: "Ранний заезд",
    svc_create_tour_fast_track: "Fast Track",
  
    svc_hotel_country: "Страна отеля",
    svc_hotel_city: "Город отеля",
    svc_hotel_name: "Название отеля",
    svc_hotel_checkin: "Дата заезда",
    svc_hotel_checkout: "Дата выезда",
    svc_hotel_roomcat: "Категория номера",
    svc_hotel_accommodation: "Размещение",
    svc_hotel_food: "Питание",
    svc_hotel_halal: "Halal",
    svc_hotel_transfer: "Трансфер",
    svc_hotel_changeable: "Можно менять",
    svc_hotel_pax: "Количество гостей",
    svc_hotel_insurance: "Страховка",
    svc_hotel_early_checkin: "Ранний заезд",
    svc_hotel_fast_track: "Fast Track",
  
    svc_create_price: "Цена нетто",
    svc_create_grossPrice: "Цена для клиента",
    svc_create_urgency: "Срочность продажи",
    svc_create_expiration: "Срок актуальности",
    svc_create_photo: "Фото услуги",
  };

  const currentStepRaw = String(row?.step || "").trim();
  const currentStep = stepLabels[currentStepRaw] || currentStepRaw || "Не определён";

  await safeReply(
    ctx,
    `⚠️ <b>Создание услуги было прервано из-за обновления бота.</b>\n\n` +
      `Мы сохранили ваш черновик.\n` +
      `📌 Категория: <b>${escapeHtml(providerDraftCategoryLabel(category))}</b>\n` +
      `📝 Заполнено полей: <b>${filled}</b>\n` +
      `📍 Текущий шаг: <b>${escapeHtml(currentStep)}</b>\n` +
      (updatedAt ? `🕒 Последнее сохранение: <b>${escapeHtml(updatedAt)}</b>\n\n` : "\n") +
      `Хотите продолжить создание?`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Продолжить создание", callback_data: "tg_draft:continue" }],
          [{ text: "🗑 Удалить черновик", callback_data: "tg_draft:delete" }],
          [{ text: "🏠 В меню", callback_data: "prov_services:back" }],
        ],
      },
    }
  );
}

async function saveProviderServiceDraft(ctx) {
  if (!pool) return false;
  const chatId = getActorId(ctx) || ctx.from?.id || ctx.chat?.id || null;
  if (!chatId) return false;

  const state = String(ctx.session?.state || "");
  const payload = ctx.session?.serviceDraft || {};
  if (!isCreateWizardState(state) || !payload) return false;

  try {
    await ensureProviderServiceDraftsTable();

    const providerId = await resolveProviderIdByTelegramChatId(chatId);
    const category = payload.category || null;
    const images = Array.isArray(payload.images) ? payload.images : [];
    const wizardStack = Array.isArray(ctx.session?.wizardStack) ? ctx.session.wizardStack : [];

    await pool.query(
      `
      INSERT INTO telegram_provider_service_drafts (
        chat_id,
        provider_id,
        category,
        step,
        payload,
        images,
        wizard_stack,
        status,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'draft',NOW())
      ON CONFLICT (chat_id) WHERE status = 'draft'
      DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        category = EXCLUDED.category,
        step = EXCLUDED.step,
        payload = EXCLUDED.payload,
        images = EXCLUDED.images,
        wizard_stack = EXCLUDED.wizard_stack,
        updated_at = NOW()
      `,
      [
        Number(chatId),
        providerId,
        category,
        state,
        JSON.stringify(payload || {}),
        JSON.stringify(images),
        JSON.stringify(wizardStack),
      ]
    );

    return true;
  } catch (e) {
    console.error("[tg-bot] saveProviderServiceDraft error:", e?.message || e);
    return false;
  }
}

async function finishProviderServiceDraft(ctx, status = "submitted") {
  if (!pool) return false;
  const chatId = getActorId(ctx) || ctx.from?.id || ctx.chat?.id || null;
  if (!chatId) return false;

  try {
    await ensureProviderServiceDraftsTable();

    await pool.query(
      `
      UPDATE telegram_provider_service_drafts
         SET status = $2,
             updated_at = NOW(),
             submitted_at = CASE WHEN $2 = 'submitted' THEN COALESCE(submitted_at, NOW()) ELSE submitted_at END,
             canceled_at = CASE WHEN $2 = 'canceled' THEN COALESCE(canceled_at, NOW()) ELSE canceled_at END
       WHERE chat_id = $1
         AND status = 'draft'
      `,
      [Number(chatId), String(status || "submitted")]
    );

    return true;
  } catch (e) {
    console.error("[tg-bot] finishProviderServiceDraft error:", e?.message || e);
    return false;
  }
}

async function clearProviderServiceDraft(ctx) {
  return finishProviderServiceDraft(ctx, "canceled");
}


async function persistProviderCreateWizard(ctx) {
  try {
    if (
      isCreateWizardState(ctx?.session?.state) &&
      ctx?.session?.serviceDraft
    ) {
      await saveProviderServiceDraft(ctx);
    }
  } catch (e) {
    console.error("[tg-bot] persistProviderCreateWizard error:", e?.message || e);
  }
}


function forceCloseEditWizard(ctx) {
  if (!ctx?.session) return;

  // выключаем edit-wizard, чтобы он больше не перехватывал ввод
  if (typeof ctx.session.state === "string" && ctx.session.state.startsWith("svc_edit_")) {
    ctx.session.state = "";
  }
  if (
    ctx.session.editWiz &&
    typeof ctx.session.editWiz.step === "string" &&
    ctx.session.editWiz.step.startsWith("svc_edit_")
  ) {
    ctx.session.editWiz.step = "";
  }

  if (Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
  if (ctx.session.serviceDraft) delete ctx.session.serviceDraft;
}

function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (["да", "ha", "xa", "yes", "y"].includes(t)) return true;
  if (["нет", "yo'q", "yoq", "yo‘q", "yok", "no", "n"].includes(t)) return false;
  return null;
}

function normalizePrice(text) {
  const cleaned = String(text || "")
    .replace(/[^0-9.,]/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

function parsePaxTriple(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const parts = t.split(/[\/,\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;

  const [a, c, i] = parts.map((x) => Number(String(x).replace(/[^\d]/g, "")));
  if ([a, c, i].some((n) => Number.isNaN(n) || n < 0)) return null;

  return { adt: a, chd: c, inf: i };
}

function shortDM(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}.${m[2]}`;
}
function shortDateRange(startYmd, endYmd) {
  const s = shortDM(startYmd);
  const e = shortDM(endYmd);
  if (!s && !e) return "";
  if (s && e && s !== e) {
    const sm = s.slice(3);
    const em = e.slice(3);
    const sd = s.slice(0, 2);
    const ed = e.slice(0, 2);
    if (sm === em) return `${sd}–${ed}.${sm}`;
    return `${s}–${e}`;
  }
  return s || e || "";
}

function autoTitleRefusedTour(draft) {
  const from = (draft.fromCity || "").trim();
  const to = (draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const dir = from && to ? `${from} → ${to}` : to || from || "";
  const parts = [];
  if (dir) parts.push(dir);
  if (range) parts.push(range);
  if (!parts.length) return "Отказной тур";
  return parts.join(" · ");
}
function autoTitleRefusedFlight(draft) {
  const from = String(draft.fromCity || draft.directionFrom || "").trim();
  const to = String(draft.toCity || draft.directionTo || "").trim();
  const dep = String(draft.departureFlightDate || "").trim();
  const ret = String(draft.returnFlightDate || "").trim();

  const route = [from, to].filter(Boolean).join(" → ");
  const dates = dep && ret ? `${dep}–${ret}` : (dep || ret || "");
  const parts = [route, dates].filter(Boolean);

  return parts.length ? `✈️ ${parts.join(" · ")}` : "✈️ Отказной авиабилет";
}

function buildDetailsForRefusedFlight(draft, netPriceNum) {
  // ВАЖНО: netPriceNum = уже нормализованная priceNum
  return {
    directionCountry: draft.country || null,
    directionFrom: draft.fromCity || null,
    directionTo: draft.toCity || null,

    departureFlightDate: draft.departureFlightDate || null,
    returnFlightDate: draft.returnFlightDate || null,
    flightDetails: draft.flightDetails || null,

    netPrice: netPriceNum,
    grossPrice: draft.grossPriceNum ?? null,
    expiration: draft.expiration || null,

    isActive: true,
  };
}

function autoTitleRefusedTicket(draft) {
  const title = String(draft.title || "").trim();
  if (title) return title;
  const country = String(draft.country || "").trim();
  const city = String(draft.toCity || draft.fromCity || "").trim();
  const eventDate = String(draft.eventDate || draft.startDate || "").trim();
  return ["🎫 Отказной билет", country, city, eventDate].filter(Boolean).join(" · ");
}

function buildDetailsForRefusedTicket(draft, netPriceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionFrom: draft.fromCity || "",
    directionTo: draft.toCity || "",
    eventDate: draft.eventDate || draft.startDate || "",
    startDate: draft.eventDate || draft.startDate || "",
    netPrice: netPriceNum,
    grossPrice: draft.grossPriceNum ?? null,
    expiration: draft.expiration || null,
    isActive: true,
    telegramPhotoFileId: draft.telegramPhotoFileId || null,
  };
}

function autoTitleRefusedHotel(draft) {
  const hotel = (draft.hotel || "Отель").trim();
  const city = (draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const parts = [hotel];
  if (city) parts.push(city);
  if (range) parts.push(range);
  return parts.join(" · ");
}

// gross = net + % (по умолчанию 10%)
const DEFAULT_GROSS_MARKUP_PERCENT = Number(
  process.env.GROSS_MARKUP_PERCENT || "10"
);
function calcGrossFromNet(netNum) {
  const p = Number.isFinite(DEFAULT_GROSS_MARKUP_PERCENT)
    ? DEFAULT_GROSS_MARKUP_PERCENT
    : 10;
  return Math.round(netNum * (1 + p / 100));
}


function autoTitleAuthorTour(draft) {
  const title = String(draft.title || "").trim();
  if (title) return title;
  const country = String(draft.country || "").trim();
  const from = String(draft.fromCity || "").trim();
  const to = String(draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const route = [from, to].filter(Boolean).join(" → ");
  return ["Авторский тур", country, route, range].filter(Boolean).join(" · ");
}


function pluralRuNightsBot(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const abs = Math.abs(Math.trunc(n));
  const last = abs % 10;
  const last2 = abs % 100;
  if (last === 1 && last2 !== 11) return `${abs} ночь`;
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return `${abs} ночи`;
  return `${abs} ночей`;
}

function cleanAuthorTourText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s*[⸻━]{2,}\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAuthorTourStaysFromText(value) {
  const raw = cleanAuthorTourText(value);
  if (!raw) return [];

  const out = [];
  const seen = new Set();

  const add = (hotel, nights, city) => {
    const h = String(hotel || "").replace(/[,.;\s]+$/g, "").trim();
    if (!h) return;
    const key = h.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      hotel: h,
      nights: Number.isFinite(Number(nights)) && Number(nights) > 0 ? Number(nights) : null,
      city: String(city || "").replace(/[,.;\s]+$/g, "").trim() || null,
    });
  };

  // Structured text like: Kar Hotel - 2 nights - Uzungol Mövenpick Hotel - 2 nights - Trabzon
  const durationRegex = /(.+?)\s*-\s*(\d+)\s*(?:nights?|ноч(?:ь|и|ей))\s*-\s*([^\n]+?)(?=\s+[A-ZА-ЯЁÜÖÇĞİŞ][^\n]*?\s*-\s*\d+\s*(?:nights?|ноч(?:ь|и|ей))\s*-|$)/giu;
  let m;
  while ((m = durationRegex.exec(raw))) add(m[1], m[2], m[3]);
  if (out.length) return out.slice(0, 8);

  // Program text like: Размещение в отеле Kar Hotel, Uzungöl
  const programHotelRegex = /Размещение\s+в\s+отеле\s+([^\n]+?)(?=\s+(?:🗓\s*)?ДЕНЬ\s*\d+|\s+Выезд|\s+Трансфер|\s+Возвращение|\s+Экскурсия|$)/giu;
  while ((m = programHotelRegex.exec(raw))) {
    const chunk = String(m[1] || "").trim();
    const [hotel, city] = chunk.split(/,\s*/);
    add(hotel, null, city || null);
  }

  return out.slice(0, 8);
}

function parseAuthorTourProgramDaysFromText(value) {
  const raw0 = cleanAuthorTourText(value)
    .replace(/\s*(?=(?:🗓\s*)?(?:ДЕНЬ|DAY)\s*\d+)/giu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!raw0) return [];

  const dayRegex = /(?:🗓\s*)?(?:ДЕНЬ|DAY)\s*(\d+)\s*(?:\|\s*([^\n]+))?/giu;
  const matches = [];
  let m;
  while ((m = dayRegex.exec(raw0))) {
    matches.push({ index: m.index, end: dayRegex.lastIndex, day: Number(m[1]), dateLabel: String(m[2] || "").trim() });
  }

  if (!matches.length) return [];

  const days = [];
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const next = matches[i + 1];
    let body = raw0.slice(cur.end, next ? next.index : raw0.length).trim();
    body = body
      .replace(/^[-–—\s]+/g, "")
      .replace(/\s*(?:Цена\s+указана|Стоимость\s+указана)[\s\S]*$/i, "")
      .replace(/\s*(?:Для\s+бронирования|Для\s+брони|Бронирование|Обращайтесь)[\s\S]*$/i, "")
      .replace(/\s*(?:@\w{4,}|\+?\d[\d\s().-]{7,})[\s\S]*$/i, "")
      .trim();
    if (!body) continue;

    const routeMatch = body.match(/📍\s*([^✈🕒🏨🚐🌊🎢⛰🍃🛍🕳🌉🏞🛳☕🛫\n]+)/u);
    const route = routeMatch ? routeMatch[1].trim() : "";
    const stayMatch = body.match(/Размещение\s+в\s+отеле\s+([^\n]+?)(?=\s+(?:✈|🕒|🛫|🛬|🚐|🌊|🎢|⛰|🍃|🛍|🕳|🌉|🏞|🛳|☕|$))/iu);
    let stay = null;
    if (stayMatch) {
      const [hotel, city] = String(stayMatch[1] || "").split(/,\s*/);
      stay = { hotel: (hotel || "").trim(), city: (city || "").trim() || null, nights: null };
    }

    const text = body
      .replace(/\s+(?=(?:✈️?|🕒|🏨|🚐|🌊|🎢|⛰|🍃|🛍|🕳|🌉|🏞|🛳|☕|🛫|🛬|🚌|🚗|📍))/gu, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    days.push({ day: cur.day, dateLabel: cur.dateLabel, route, text, stay });
  }

  return days.slice(0, 30);
}

function buildDetailsForAuthorTour(draft, netPriceNum) {
  const durationMeta = calcAuthorDuration(draft.startDate, draft.endDate);

  const stays = Array.isArray(draft.stays)
    ? draft.stays
    : parseAuthorStaysInput(draft.staysText);

  const programDays = Array.isArray(draft.programDays)
    ? draft.programDays
    : parseAuthorProgramDaysInput(draft.programDaysText);

  return {
    title: draft.title || null,
    directionCountry: draft.country || null,
    directionFrom: draft.fromCity || null,
    directionTo: draft.toCity || null,

    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    days: durationMeta.days,
    nights: durationMeta.nights,
    duration: durationMeta.duration,

    tourFormat: draft.tourFormat || null,
    stays,
    programDays,

    // legacy fallback — не удаляем
    program: draft.program || draft.programDaysText || null,

    included: draft.included || null,
    notIncluded: draft.notIncluded || null,
    minPax: draft.minPax || null,
    maxPax: draft.maxPax || null,
    
    guideLanguages: Array.isArray(draft.languages) ? draft.languages : [],
    languages: Array.isArray(draft.languages) ? draft.languages : [],
    guideLanguage: Array.isArray(draft.languages)
      ? draft.languages.join(", ")
      : draft.guideLanguage || draft.language || null,
    language: Array.isArray(draft.languages)
      ? draft.languages.join(", ")
      : draft.guideLanguage || draft.language || null,
    
    meetingPoint: draft.meetingPoint || null,
    transport: draft.transport || null,
    guide: draft.guide || null,
    cancelPolicy: draft.cancelPolicy || null,

    netPrice: netPriceNum,
    grossPrice: draft.grossPriceNum ?? null,
    expiration: draft.expiration || null,
    isActive: true,
  };
}

function normalizeAuthorDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let yyyy;
  let mm;
  let dd;

  let m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    dd = Number(m[1]);
    mm = Number(m[2]);
    yyyy = Number(m[3]);
  } else {
    m = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (!m) return null;
    yyyy = Number(m[1]);
    mm = Number(m[2]);
    dd = Number(m[3]);
  }

  if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
  if (yyyy < 2000 || yyyy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    dt.getUTCFullYear() !== yyyy ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  ) {
    return null;
  }

  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function formatAuthorDateDMY(value) {
  const iso = normalizeAuthorDateInput(value) || String(value || "").trim();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || "").trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function calcAuthorDuration(startDate, endDate) {
  const s = normalizeAuthorDateInput(startDate);
  const e = normalizeAuthorDateInput(endDate);
  if (!s || !e) return { days: null, nights: null, duration: "" };

  const sd = new Date(`${s}T00:00:00Z`);
  const ed = new Date(`${e}T00:00:00Z`);
  const diff = Math.round((ed.getTime() - sd.getTime()) / 86400000);

  if (!Number.isFinite(diff) || diff <= 0) {
    return { days: null, nights: null, duration: "" };
  }

  const nights = diff;
  const days = diff + 1;
  return {
    days,
    nights,
    duration: `${days} дней / ${nights} ночей`,
  };
}

function parseAuthorStaysInput(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((x) => x.trim());
      return {
        city: parts[0] || "",
        hotel: parts[1] || "",
        nights: Number(parts[2] || 0) || null,
      };
    })
    .filter((x) => x.city && x.hotel);
}

function parseAuthorDayItemsInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  return raw
    .replace(/\r/g, "\n")
    .split(/\n|;/g)
    .map((x) =>
      String(x || "")
        .trim()
        .replace(/^[\s•●▪▫◦·*-]+/g, "")
        .replace(/^—\s*/g, "")
        .trim()
    )
    .filter(Boolean);
}

function parseAuthorProgramDaysInput(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((x) => x.trim());
      const items = String(parts[4] || "")
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean);

      const day = Number(parts[0] || index + 1) || index + 1;
      const dateLabel = parts[1] || "";
      const route = parts[2] || "";
      const title = parts[3] || route || "";
      const text = items.join("\n");

      return {
        day,
        number: day,
        date: dateLabel,
        dateLabel,
        route,
        title,
        items,
        text,
      };
    });
}

function buildDetailsForRefusedTour(draft, netPriceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionFrom: draft.fromCity || "",
    directionTo: draft.toCity || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    departureFlightDate: draft.departureFlightDate || "",
    returnFlightDate: draft.returnFlightDate || "",
    flightDetails: draft.flightDetails || "",
    hotel: draft.hotel || "",
    accommodation: draft.accommodation || "",

    // ✅ категория номера + питание (чтобы карточки совпадали)
    accommodationCategory: draft.roomCategory || "",
    roomCategory: draft.roomCategory || "", // legacy-совместимость
    food: draft.food || "",

    insuranceIncluded: !!draft.insuranceIncluded,
    earlyCheckIn: !!draft.earlyCheckIn,
    arrivalFastTrack: !!draft.arrivalFastTrack,
    
    netPrice: netPriceNum,
    grossPrice: typeof draft.grossPriceNum === "number" ? draft.grossPriceNum : null,
    expiration: draft.expiration || null,
    isActive: true,
    telegramPhotoFileId: draft.telegramPhotoFileId || null,
  };
}

function buildDetailsForRefusedHotel(draft, netPriceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionTo: draft.toCity || "",
    hotel: draft.hotel || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    accommodationCategory: draft.roomCategory || "",
    accommodation: draft.accommodation || "",
    food: draft.food || "",
    halal: typeof draft.halal === "boolean" ? draft.halal : false,
    transfer: draft.transfer || "",
    changeable: typeof draft.changeable === "boolean" ? draft.changeable : false,
    adt: typeof draft.adt === "number" ? draft.adt : 0,
    chd: typeof draft.chd === "number" ? draft.chd : 0,
    inf: typeof draft.inf === "number" ? draft.inf : 0,

    insuranceIncluded: !!draft.insuranceIncluded,
    earlyCheckIn: !!draft.earlyCheckIn,
    arrivalFastTrack: !!draft.arrivalFastTrack,
    
    // legacy
    accommodationADT: typeof draft.adt === "number" ? draft.adt : 0,
    accommodationCHD: typeof draft.chd === "number" ? draft.chd : 0,
    accommodationINF: typeof draft.inf === "number" ? draft.inf : 0,
    netPrice: netPriceNum,
    grossPrice: typeof draft.grossPriceNum === "number" ? draft.grossPriceNum : null,
    expiration: draft.expiration || null,
    isActive: true,
    telegramPhotoFileId: draft.telegramPhotoFileId || null,
  };
}

function wizNavKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
          { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
        ],
      ],
    },
  };
}


function getServiceWizardOrder(category = "", state = "") {
  const c = String(category || "").toLowerCase();
  const st = String(state || "");

  const tourOrder = [
    "svc_create_title",
    "svc_create_tour_country",
    "svc_create_tour_from",
    "svc_create_tour_to",
    "svc_create_tour_start",
    "svc_create_tour_end",
    "svc_create_flight_departure",
    "svc_create_flight_return",
    "svc_create_flight_details",
    "svc_create_tour_hotel",
    "svc_create_tour_accommodation",
    "svc_create_tour_roomcat",
    "svc_create_tour_food",
    "svc_create_price",
    "svc_create_grossPrice",
    "svc_create_urgency",
    "svc_create_expiration",
    "svc_create_photo",
  ];

  const hotelOrder = [
    "svc_hotel_country",
    "svc_hotel_city",
    "svc_hotel_name",
    "svc_hotel_checkin",
    "svc_hotel_checkout",
    "svc_hotel_roomcat",
    "svc_hotel_accommodation",
    "svc_hotel_food",
    "svc_hotel_halal",
    "svc_hotel_transfer",
    "svc_hotel_changeable",
    "svc_hotel_pax",
    "svc_create_price",
    "svc_create_grossPrice",
    "svc_create_urgency",
    "svc_create_expiration",
    "svc_create_photo",
  ];

  const flightOrder = [
    "svc_create_title",
    "svc_create_tour_country",
    "svc_create_tour_from",
    "svc_create_tour_to",
    "svc_create_flight_departure",
    "svc_create_flight_return",
    "svc_create_flight_details",
    "svc_create_price",
    "svc_create_grossPrice",
    "svc_create_urgency",
    "svc_create_expiration",
    "svc_create_photo",
  ];

  const ticketOrder = [
    "svc_create_title",
    "svc_create_tour_country",
    "svc_create_tour_from",
    "svc_create_tour_to",
    "svc_ticket_event_date",
    "svc_create_price",
    "svc_create_grossPrice",
    "svc_create_urgency",
    "svc_create_expiration",
    "svc_create_photo",
  ];

  const authorOrder = [
    "svc_author_title",
    "svc_author_country",
    "svc_author_from",
    "svc_author_to",
    "svc_author_start",
    "svc_author_end",
    "svc_author_format",
    "svc_author_stays",
    "svc_author_program_days",
    "svc_author_included",
    "svc_author_not_included",
    "svc_author_pax",
    "svc_author_language",
    "svc_author_meeting",
    "svc_author_cancel",
    "svc_create_price",
    "svc_create_grossPrice",
    "svc_create_urgency",
    "svc_create_expiration",
    "svc_create_photo",
  ];

  if (c === "author_tour" || st.startsWith("svc_author_") || st.startsWith("author_")) return authorOrder;
  if (c === "refused_hotel" || st.startsWith("svc_hotel_")) return hotelOrder;
  if (c === "refused_flight") return flightOrder;
  if (c === "refused_ticket" || c === "refused_event_ticket" || st === "svc_ticket_event_date") return ticketOrder;
  return tourOrder;
}

function wizardProgressText(ctx, state) {
  const draft = ctx.session?.serviceDraft || {};
  const order = getServiceWizardOrder(draft.category, state);
  const idx = order.indexOf(state);
  if (idx < 0) return "";
  const categoryLabel = providerDraftCategoryLabel(draft.category || "");
  const pct = Math.round(((idx + 1) / order.length) * 100);
  const barSize = 8;
  const filled = Math.max(1, Math.round((pct / 100) * barSize));
  const bar = "●".repeat(filled) + "○".repeat(Math.max(0, barSize - filled));
  return `🧭 <b>${escapeHtml(categoryLabel)}</b>\nШаг <b>${idx + 1}</b> из <b>${order.length}</b> · ${pct}%\n${bar}`;
}

function buildUrgencyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔴 Срочно: сегодня", callback_data: "svc_urgency:urgent" }],
        [{ text: "🟠 В течение 1–3 дней", callback_data: "svc_urgency:soon" }],
        [{ text: "🟢 Не срочно", callback_data: "svc_urgency:normal" }],
        [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
          { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
        ],
      ],
    },
  };
}

function urgencyLabel(value) {
  const v = String(value || "").toLowerCase();
  if (v === "urgent") return "🔴 Срочно: сегодня";
  if (v === "soon") return "🟠 В течение 1–3 дней";
  if (v === "normal") return "🟢 Не срочно";
  return "Не указано";
}

function buildProofKeyboard(serviceId, count = 0) {
  const rows = [
    [{ text: "➕ Добавить ещё", callback_data: "proof:add_more" }],
  ];

  if (count > 0) {
    rows.push([{ text: "🧾 Предпросмотр карточки", callback_data: `proof:card:${Number(serviceId || 0)}` }]);
    rows.push([{ text: "👀 Просмотреть proof", callback_data: `proof:view:${Number(serviceId || 0)}` }]);
    rows.push([{ text: "🗑 Удалить последнее", callback_data: "proof:delete_last" }]);
    rows.push([{ text: "✅ Отправить на модерацию", callback_data: "proof:submit" }]);
  }

  rows.push([{ text: "❌ Отменить отправку", callback_data: "proof:cancel" }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function buildDraftProofSummary(ctx, serviceId, count = 0) {
  const draft = ctx.session?.serviceDraft || {};
  const category = ctx.session?.awaitingProofForCategory || draft.category || "";
  const lines = [];
  lines.push(`📌 <b>${escapeHtml(providerDraftCategoryLabel(category))}</b>${serviceId ? ` <code>#${serviceId}</code>` : ""}`);
  if (draft.title) lines.push(`📝 ${escapeHtml(draft.title)}`);
  const route = [draft.country, draft.fromCity, draft.toCity].filter(Boolean).join(" → ");
  if (route) lines.push(`🌍 ${escapeHtml(route)}`);
  if (draft.startDate || draft.endDate) lines.push(`📅 ${escapeHtml([draft.startDate, draft.endDate].filter(Boolean).join(" → "))}`);
  if (draft.price) lines.push(`💰 Нетто: ${escapeHtml(draft.price)}`);
  if (draft.grossPrice) lines.push(`💳 Клиенту: ${escapeHtml(draft.grossPrice)}`);
  if (draft.urgency) lines.push(`⚡ ${escapeHtml(urgencyLabel(draft.urgency))}`);
  lines.push(`📎 Доказательств: <b>${Number(count || 0)}</b>`);
  return lines.join("\n");
}

async function getProofImagesForService(serviceId) {
  if (!pool || !serviceId) return [];
  const r = await pool.query(
    `SELECT details FROM services WHERE id = $1 LIMIT 1`,
    [Number(serviceId)]
  );
  const details = r.rows?.[0]?.details && typeof r.rows[0].details === "object" ? r.rows[0].details : {};
  return Array.isArray(details.proofImages) ? details.proofImages.filter(Boolean) : [];
}

async function replyProofUploadPrompt(ctx, { serviceId, category, isEditMode = false } = {}) {
  if (!ctx.session) ctx.session = {};
  if (serviceId) ctx.session.awaitingProofForServiceId = Number(serviceId);
  if (category) ctx.session.awaitingProofForCategory = String(category || "").toLowerCase();

  const count = (await getProofImagesForService(serviceId)).length;
  await safeReply(
    ctx,
    `${isEditMode ? "✅ Изменения сохранены." : "✅ Услуга сохранена."}\n\n` +
      `📸 <b>Теперь прикрепите доказательства подлинности</b>\n\n` +
      `Можно отправить скриншоты бронирования, ваучер, билет или подтверждение от поставщика.\n\n` +
      `${buildDraftProofSummary(ctx, serviceId, count)}\n\n` +
      `После загрузки нажмите кнопку <b>«✅ Отправить на модерацию»</b>.`,
    {
      parse_mode: "HTML",
      ...buildProofKeyboard(serviceId, count),
    }
  );
}

async function sendProofPreview(ctx, serviceId) {
  const images = await getProofImagesForService(serviceId);
  if (!images.length) {
    await safeReply(ctx, "📎 Доказательства пока не загружены. Отправьте фото/скриншот сюда в чат.", buildProofKeyboard(serviceId, 0));
    return;
  }

  await safeReply(ctx, `👀 Загружено доказательств: ${images.length}. Показываю первые ${Math.min(images.length, 8)}.`);

  for (const item of images.slice(0, 8)) {
    const s = String(item || "");
    try {
      if (s.startsWith("data:image/")) {
        const base64 = s.split(",")[1] || "";
        const buf = Buffer.from(base64, "base64");
        await ctx.replyWithPhoto({ source: buf }, { caption: "📎 Подтверждение" });
      } else {
        await ctx.replyWithPhoto(s, { caption: "📎 Подтверждение" });
      }
    } catch (e) {
      console.error("[tg-bot] proof preview item error:", e?.message || e);
    }
  }

  await safeReply(ctx, "Что сделать дальше?", buildProofKeyboard(serviceId, images.length));
}


async function sendProofCardPreview(ctx, serviceId) {
  if (!pool || !serviceId) return;
  const r = await pool.query(`SELECT * FROM services WHERE id = $1 LIMIT 1`, [Number(serviceId)]);
  const svc = r.rows?.[0] || null;
  if (!svc) {
    await safeReply(ctx, "⚠️ Услуга для предпросмотра не найдена.");
    return;
  }
  try {
    if (typeof svc.details === "string") svc.details = JSON.parse(svc.details);
  } catch {}
  try {
    if (typeof svc.images === "string") svc.images = JSON.parse(svc.images);
  } catch {}

  const category = String(svc.category || svc.type || "refused_tour").toLowerCase();
  const built = buildServiceMessage(svc, category, "provider", { forceRefused: true });
  const caption =
    `🧾 <b>Предпросмотр перед модерацией</b>\n\n` +
    `${built.text || "Карточка сформирована."}\n\n` +
    `Проверьте, как выглядит услуга. Если всё верно — отправьте на модерацию.`;
  const proofCount = (await getProofImagesForService(serviceId)).length;
  const kb = buildProofKeyboard(serviceId, proofCount).reply_markup;

  if (built.photoUrl) {
    await safeReplyWithPhoto(ctx, built.photoUrl, caption, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
    return;
  }

  await safeReply(ctx, caption, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: kb,
  });
}

async function deleteLastProofImage(ctx) {
  const serviceId = Number(ctx.session?.awaitingProofForServiceId || 0);
  if (!serviceId) return;

  const r = await pool.query(`SELECT details FROM services WHERE id = $1 LIMIT 1`, [serviceId]);
  const currentDetails = r.rows?.[0]?.details && typeof r.rows[0].details === "object" ? r.rows[0].details : {};
  const proofImages = Array.isArray(currentDetails.proofImages) ? currentDetails.proofImages.filter(Boolean) : [];
  if (!proofImages.length) {
    await safeReply(ctx, "📎 Список доказательств уже пуст.", buildProofKeyboard(serviceId, 0));
    return;
  }

  proofImages.pop();
  await pool.query(
    `UPDATE services SET details = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ ...currentDetails, proofImages }), serviceId]
  );
  await safeReply(ctx, `🗑 Последнее доказательство удалено. Осталось: ${proofImages.length}.`, buildProofKeyboard(serviceId, proofImages.length));
}

function yesNoWizardKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Да", callback_data: "wiz_bool:yes" },
          { text: "❌ Нет", callback_data: "wiz_bool:no" },
        ],
        [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
          { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
        ],
      ],
    },
  };
}

function authorDayNavKeyboard({ skip = true } = {}) {
  const rows = [];

  if (skip) {
    rows.push([{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }]);
  }

  rows.push([
    { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
    { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}


const AUTHOR_INCLUDED_PRESETS = [
  { key:"flights", label:"Авиабилеты", icon:"✈️" },
  { key:"stay", label:"Проживание", icon:"🏨" },

  { key:"transfer", label:"Трансферы", icon:"🚐" },
  { key:"visa", label:"Виза", icon:"🛂" },

  { key:"guide", label:"Гид", icon:"🧑‍🏫" },
  { key:"insurance", label:"Страхование", icon:"🛡" },

  { key:"excursions", label:"Экскурсии", icon:"🎟" },
  { key:"entrance", label:"Входные билеты", icon:"🎫" },

  { key:"escort", label:"Сопровождение", icon:"📞" },
  { key:"lunch", label:"Обед", icon:"🍲" },

  { key:"dinner", label:"Ужин", icon:"🍽" },
  { key:"photo", label:"Фото/видео съёмка", icon:"📸" },
];

const AUTHOR_EXCLUDED_PRESETS = [
  { key: "flight", icon: "✈️", label: "Авиабилеты" },
  { key: "visa", icon: "🛂", label: "Виза" },

  { key: "insurance", icon: "🛡", label: "Страхование" },
  { key: "personal", icon: "💸", label: "Личные расходы" },

  { key: "shopping", icon: "🛍", label: "Шопинг" },
  { key: "citytax", icon: "🏨", label: "Туристический сбор" },

  { key: "optional", icon: "🎟", label: "Доп. экскурсии" },
  { key: "single", icon: "🛏", label: "Single доплата" },

  { key: "lunch", icon: "🍲", label: "Обед" },
  { key: "dinner", icon: "🍽", label: "Ужин" },

  { key: "photo", icon: "📸", label: "Фото/видео съёмка" },
  { key: "tips", icon: "💵", label: "Чаевые" },
];

function normalizeAuthorList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }

  const raw = String(value || "").trim();
  if (!raw) return [];

  return raw
    .replace(/\r/g, "\n")
    .split(/\n|;/g)
    .map((x) =>
      String(x || "")
        .trim()
        .replace(/^[\s•●▪▫◦·*-]+/g, "")
        .replace(/^—\s*/g, "")
        .trim()
    )
    .filter(Boolean);
}

function authorPresetByKey(kind, key) {
  const list = kind === "excluded" ? AUTHOR_EXCLUDED_PRESETS : AUTHOR_INCLUDED_PRESETS;
  return list.find((x) => x.key === key) || null;
}

function toggleAuthorListItem(list, item) {
  const arr = normalizeAuthorList(list);
  const value = String(item || "").trim();
  if (!value) return arr;

  const idx = arr.findIndex((x) => x.toLowerCase() === value.toLowerCase());
  if (idx >= 0) {
    arr.splice(idx, 1);
    return arr;
  }

  arr.push(value);
  return arr;
}

function formatAuthorListPreview(items) {
  const arr = normalizeAuthorList(items);
  if (!arr.length) return "Пока ничего не выбрано.";
  return arr.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

function buildAuthorIncludedKeyboard(selected = []) {
  const picked = new Set(normalizeAuthorList(selected).map((x) => x.toLowerCase()));
  const rows = [];

  for (let i = 0; i < AUTHOR_INCLUDED_PRESETS.length; i += 2) {
    const pair = AUTHOR_INCLUDED_PRESETS.slice(i, i + 2).map((item) => ({
      text: `${picked.has(item.label.toLowerCase()) ? "✅" : "⬜️"} ${item.icon} ${item.label}`,
      callback_data: `author_included:toggle:${item.key}`,
    }));
    rows.push(pair);
  }

  rows.push([{ text: "➕ Свой пункт", callback_data: "author_included:custom" }]);
  rows.push([{ text: "✅ Продолжить", callback_data: "author_included:done" }]);
  rows.push([
    { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
    { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
  ]);

  return rows;
}

function buildAuthorExcludedKeyboard(selected = []) {
  const picked = new Set(normalizeAuthorList(selected).map((x) => x.toLowerCase()));
  const rows = [];

  for (let i = 0; i < AUTHOR_EXCLUDED_PRESETS.length; i += 2) {
    const pair = AUTHOR_EXCLUDED_PRESETS.slice(i, i + 2).map((item) => ({
      text: `${picked.has(item.label.toLowerCase()) ? "✅" : "⬜️"} ${item.icon} ${item.label}`,
      callback_data: `author_excluded:toggle:${item.key}`,
    }));
    rows.push(pair);
  }

  rows.push([{ text: "➕ Свой пункт", callback_data: "author_excluded:custom" }]);
  rows.push([{ text: "✅ Продолжить", callback_data: "author_excluded:done" }]);
  rows.push([{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }]);
  rows.push([
    { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
    { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
  ]);

  return rows;
}

async function replyAuthorIncludedBuilder(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
  const selected = normalizeAuthorList(ctx.session.serviceDraft.included);

  await ctx.reply(
    `✅ Что включено в стоимость?\n\nВыбрано:\n${formatAuthorListPreview(selected)}`,
    {
      reply_markup: {
        inline_keyboard: buildAuthorIncludedKeyboard(selected),
      },
    }
  );
}

async function replyAuthorExcludedBuilder(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
  const selected = normalizeAuthorList(ctx.session.serviceDraft.notIncluded);

  await ctx.reply(
    `➖ Что не включено?\n\nВыбрано:\n${formatAuthorListPreview(selected)}`,
    {
      reply_markup: {
        inline_keyboard: buildAuthorExcludedKeyboard(selected),
      },
    }
  );
}


function pushWizardState(ctx, prevState) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.wizardStack) ctx.session.wizardStack = [];
  if (
    prevState &&
    (String(prevState).startsWith("svc_create_") ||
      String(prevState).startsWith("svc_hotel_") ||
      String(prevState).startsWith("svc_author_") ||
      String(prevState).startsWith("author_stay_") ||
      String(prevState).startsWith("author_day_") ||
      String(prevState).startsWith("author_included_") ||
      String(prevState).startsWith("author_excluded_"))
  ) {
    ctx.session.wizardStack.push(prevState);
  }
}

const TG_CALENDAR_MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYmdLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseYmdLocal(value) {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function formatYmdDMY(value) {
  const ymd = normalizeDateInput(value) || normalizeAuthorDateInput(value) || String(value || "").slice(0, 10);
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || "").trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function normalizeTimeHHMM(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{2})(\d{2})$/) || s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${pad2(hh)}:${pad2(mm)}`;
}

function getDraftForCalendar(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
  return ctx.session.serviceDraft;
}

function getCurrentCalendarValue(draft, state) {
  switch (state) {
    case "svc_author_start":
    case "svc_create_tour_start":
    case "svc_hotel_checkin":
      return draft.startDate || null;
    case "svc_author_end":
    case "svc_create_tour_end":
    case "svc_hotel_checkout":
      return draft.endDate || null;
    case "svc_create_flight_departure":
      return draft.departureFlightDate || null;
    case "svc_create_flight_return":
      return draft.returnFlightDate || null;
    case "svc_ticket_event_date":
      return draft.eventDate || draft.startDate || null;
    case "author_day_date":
      return draft._programDayDate || null;
    case "svc_create_expiration":
      return draft.expiration || null;
    default:
      return null;
  }
}

function getCalendarConfig(state, draft = {}) {
  switch (state) {
    case "svc_author_start":
      return { title: "📅 Выберите дату начала авторского тура", field: "startDate", next: "svc_author_end", kind: "date", required: true };
    case "svc_author_end":
      return { title: "📅 Выберите дату окончания авторского тура", field: "endDate", next: "svc_author_format", kind: "date", required: true };
    case "author_day_date":
      return { title: "📅 Выберите дату дня программы", field: "_programDayDate", next: "author_day_route", kind: "author_day_date", required: false };
    case "svc_create_tour_start":
      return { title: "📅 Выберите дату начала тура", field: "startDate", next: "svc_create_tour_end", kind: "date", required: true };
    case "svc_create_tour_end":
      return { title: "📅 Выберите дату окончания тура", field: "endDate", next: "svc_create_flight_departure", kind: "date", required: true };
    case "svc_create_flight_departure":
      return { title: "🛫 Выберите дату рейса вылета", field: "departureFlightDate", next: "svc_create_flight_return", kind: "date", required: false };
    case "svc_create_flight_return":
      return { title: "🛬 Выберите дату рейса обратно", field: "returnFlightDate", next: "svc_create_flight_details", kind: "date", required: false };
    case "svc_hotel_checkin":
      return { title: "📅 Выберите дату заезда", field: "startDate", next: "svc_hotel_checkout", kind: "date", required: true };
    case "svc_hotel_checkout":
      return { title: "📅 Выберите дату выезда", field: "endDate", next: "svc_hotel_roomcat", kind: "date", required: true };
    case "svc_ticket_event_date":
      return { title: "🎫 Выберите дату мероприятия / билета", field: "eventDate", next: "svc_create_price", kind: "date", required: true };
    case "svc_create_expiration":
      return { title: "⏳ Выберите дату окончания актуальности", field: "expiration", next: "svc_create_photo", kind: "datetime", required: false };
    default:
      return null;
  }
}

function calendarManualText(state) {
  switch (state) {
    case "svc_create_expiration":
      return "✍️ Введите дату и время актуальности вручную.\n\nФормат: YYYY-MM-DD HH:mm или YYYY.MM.DD HH:mm";
    case "svc_author_start":
      return "✍️ Введите дату начала авторского тура вручную.\n\nФормат: 29.05.2026 или 2026-05-29";
    case "svc_author_end":
      return "✍️ Введите дату окончания авторского тура вручную.\n\nФормат: 05.06.2026 или 2026-06-05";
    case "author_day_date":
      return "✍️ Введите дату дня программы вручную.\n\nФормат: 29.05.2026 или 2026-05-29";
    default:
      return "✍️ Введите дату вручную.\n\nФормат: YYYY-MM-DD или YYYY.MM.DD";
  }
}

function buildCalendarKeyboard(state, year, monthIndex, selectedYmd = null) {
  const rows = [];
  const prev = new Date(year, monthIndex - 1, 1);
  const next = new Date(year, monthIndex + 1, 1);

  rows.push([
    { text: "◀️", callback_data: `cal:nav:${state}:${prev.getFullYear()}:${pad2(prev.getMonth() + 1)}` },
    { text: `${TG_CALENDAR_MONTHS_RU[monthIndex]} ${year}`, callback_data: "cal:noop" },
    { text: "▶️", callback_data: `cal:nav:${state}:${next.getFullYear()}:${pad2(next.getMonth() + 1)}` },
  ]);

  rows.push(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => ({ text: d, callback_data: "cal:noop" })));

  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  let day = 1;

  for (let r = 0; r < 6; r += 1) {
    const row = [];
    for (let c = 0; c < 7; c += 1) {
      if ((r === 0 && c < startOffset) || day > daysInMonth) {
        row.push({ text: " ", callback_data: "cal:noop" });
      } else {
        const ymd = `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
        const mark = selectedYmd && normalizeDateInput(selectedYmd) === ymd ? "✅ " : "";
        row.push({ text: `${mark}${day}`, callback_data: `cal:date:${state}:${ymd}` });
        day += 1;
      }
    }
    rows.push(row);
    if (day > daysInMonth) break;
  }

  rows.push([{ text: "✍️ Ввести вручную", callback_data: `cal:manual:${state}` }]);

  const cfg = getCalendarConfig(state);
  if (cfg && !cfg.required) {
    rows.push([{ text: "❌ Нет / не указано", callback_data: `cal:none:${state}` }]);
  }

  rows.push([{ text: "⬅️ Назад", callback_data: "svc_wiz:back" }, { text: "❌ Отмена", callback_data: "svc_wiz:cancel" }]);

  return { inline_keyboard: rows };
}

async function replyWizardCalendar(ctx, state, opts = {}) {
  const draft = getDraftForCalendar(ctx);
  const cfg = getCalendarConfig(state, draft);
  if (!cfg) return false;

  const current = getCurrentCalendarValue(draft, state);
  const base = current ? (normalizeDateInput(current) || normalizeAuthorDateInput(current) || String(current).slice(0, 10)) : null;
  const baseDate = parseYmdLocal(opts.ymd || base) || new Date();
  const year = Number(opts.year || baseDate.getFullYear());
  const month = Number(opts.month || baseDate.getMonth() + 1);
  const monthIndex = Math.max(0, Math.min(11, month - 1));
  const currentText = current
    ? `\n\nТекущее: ${state === "svc_create_expiration" ? String(current).replace("T", " ").slice(0, 16) : formatYmdDMY(current)}`
    : "\n\nТекущее: не указано";

  await ctx.reply(`${cfg.title}${currentText}`, {
    reply_markup: buildCalendarKeyboard(state, year, monthIndex, current),
  });
  return true;
}

async function replyExpirationTimePicker(ctx, state, ymd) {
  const pretty = formatYmdDMY(ymd);
  await ctx.reply(`🕒 Выберите время актуальности для даты ${pretty}`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "09:00", callback_data: `cal:time:${state}:${ymd}:0900` },
          { text: "12:00", callback_data: `cal:time:${state}:${ymd}:1200` },
        ],
        [
          { text: "18:00", callback_data: `cal:time:${state}:${ymd}:1800` },
          { text: "23:59", callback_data: `cal:time:${state}:${ymd}:2359` },
        ],
        [{ text: "✍️ Ввести вручную", callback_data: `cal:manual:${state}` }],
        [{ text: "⬅️ Назад к календарю", callback_data: `cal:nav:${state}:${ymd.slice(0, 4)}:${ymd.slice(5, 7)}` }],
      ],
    },
  });
}

function setDraftDateByState(draft, state, ymdOrDateTime) {
  const cfg = getCalendarConfig(state, draft);
  if (!cfg) return false;

  if (state === "author_day_date") {
    draft._programDayDate = formatAuthorDateDMY(ymdOrDateTime);
    return true;
  }

  if (state === "svc_ticket_event_date") {
    draft.eventDate = ymdOrDateTime;
    draft.startDate = ymdOrDateTime;
    return true;
  }

  draft[cfg.field] = ymdOrDateTime;
  return true;
}

async function advanceAfterCalendarDate(ctx, state) {
  const draft = getDraftForCalendar(ctx);
  const cfg = getCalendarConfig(state, draft);
  if (!cfg) return;

  pushWizardState(ctx, state);
  ctx.session.state = cfg.next;

  if (cfg.next === "svc_create_photo") {
    await promptWizardState(ctx, "svc_create_photo");
  } else {
    await promptWizardState(ctx, cfg.next);
  }

  await persistProviderCreateWizard(ctx);
}

function calendarDateValidationError(draft, state, ymdOrDateTime) {
  if (state === "svc_create_expiration") {
    if (ymdOrDateTime && isPastDateTime(ymdOrDateTime)) {
      return "⚠️ Дата актуальности уже в прошлом. Выберите будущую дату.";
    }
    if (ymdOrDateTime && isExpirationAfterTripStart(draft, ymdOrDateTime)) {
      return "⚠️ Срок актуальности не может быть позже даты начала тура / вылета.";
    }
    return null;
  }

  const ymd = normalizeDateInput(ymdOrDateTime) || normalizeAuthorDateInput(ymdOrDateTime);
  if (!ymd) return "⚠️ Некорректная дата.";

  if (isPastYMD(ymd)) {
    return "⚠️ Эта дата уже в прошлом. Выберите будущую дату.";
  }

  if ((state === "svc_author_end" || state === "svc_create_tour_end" || state === "svc_hotel_checkout") && draft.startDate && isBeforeYMD(ymd, draft.startDate)) {
    return "⚠️ Дата окончания раньше даты начала. Выберите корректную дату.";
  }

  if (state === "svc_create_flight_return" && draft.departureFlightDate && isBeforeYMD(ymd, draft.departureFlightDate)) {
    return "⚠️ Дата обратного рейса раньше даты вылета. Выберите корректную дату.";
  }

  return null;
}

async function handleCalendarApply(ctx, state, value) {
  const draft = getDraftForCalendar(ctx);
  const err = calendarDateValidationError(draft, state, value);
  if (err) {
    await safeCb(ctx, err, true);
    return;
  }

  setDraftDateByState(draft, state, value);
  ctx.session.serviceDraft = draft;
  await safeCb(ctx, "Дата выбрана");
  await advanceAfterCalendarDate(ctx, state);
}

function normReq(text) {
  const v = String(text ?? "").replace(/\s+/g, " ").trim();
  return v.length ? v : null;
}

// универсальная проверка “обязательное текстовое поле”
async function requireTextField(ctx, text, label, opts = {}) {
  const { min = 2 } = opts;
  const v = normReq(text);
  if (!v) {
    await ctx.reply(`⚠️ Поле *${label}* обязательно.\nВведите значение ещё раз.`, {
      parse_mode: "Markdown",
      ...wizNavKeyboard(),
    });
    return null;
  }
  if (v.length < min) {
    await ctx.reply(`⚠️ Слишком коротко для *${label}*.\nВведите минимум ${min} символа(ов).`, {
      parse_mode: "Markdown",
      ...wizNavKeyboard(),
    });
    return null;
  }
  return v;
}

// проверка gross >= net
async function validateGrossNotLessThanNet(ctx, netStr, grossStr, backToState) {
  const net = normalizePrice(netStr);
  const gross = normalizePrice(grossStr);

  // если gross пустой/пропуск — валидировать нечего
  if (grossStr == null || String(grossStr).trim() === "") return true;
  if (gross === null) return true; // это уже отдельно обрабатывается у тебя

  if (net !== null && gross < net) {
    await ctx.reply(
      `⚠️ Цена *БРУТТО* не может быть меньше *НЕТТО*.\n` +
        `НЕТТО: *${net}*\nБРУТТО: *${gross}*\n\nВведите корректную цену БРУТТО.`,
      { parse_mode: "Markdown", ...wizNavKeyboard() }
    );
    if (backToState) ctx.session.state = backToState;
    return false;
  }
  return true;
}

function wizardCurrentPreview(ctx, state) {
  const d = ctx.session?.serviceDraft || {};
  const show = (label, value) => {
    if (value === null || value === undefined || value === "") return "";
    if (Array.isArray(value)) return value.length ? `📌 Сейчас сохранено:\n${label}: ${value.join(", ")}` : "";
    return `📌 Сейчас сохранено:\n${label}: ${value}`;
  };

  const bool = (v) => {
    if (v === true) return "Да";
    if (v === false) return "Нет";
    return "";
  };

  const map = {
    svc_author_title: ["Название", d.title],
    svc_author_country: ["Страна", d.country],
    svc_author_from: ["Старт", d.fromCity],
    svc_author_to: ["Финиш/маршрут", d.toCity || d.directionTo],
    svc_author_start: ["Дата начала", d.startDate],
    svc_author_end: ["Дата окончания", d.endDate],
    svc_author_format: ["Формат", d.tourFormat],

    author_stay_city: ["Проживание", (d.stays || []).map(x => `${x.city} — ${x.hotel} — ${x.nights} ноч.`)],
    author_stay_hotel: ["Город", d._stayCity],
    author_stay_nights: ["Город / отель", [d._stayCity, d._stayHotel].filter(Boolean).join(" — ")],

    author_day_date: ["Программа", (d.programDays || []).map(x => `${x.day}. ${x.date} — ${x.route} — ${x.title}`)],
    author_day_route: ["Дата дня", d._programDayDate],
    author_day_title: ["Дата / маршрут", [d._programDayDate, d._programDayRoute].filter(Boolean).join(" — ")],
    author_day_items: ["День программы", [d._programDayDate, d._programDayRoute, d._programDayTitle].filter(Boolean).join(" — ")],

    svc_author_language: ["Языки", d.languages || d.language],
    author_language_custom: ["Языки", d.languages || d.language],
    svc_author_meeting: ["Место встречи", d.meetingPoint],
    svc_author_cancel: ["Условия отмены", d.cancelPolicy || d.cancellationPolicy],

    svc_create_title: ["Название", d.title],
    svc_create_tour_country: ["Страна", d.country],
    svc_create_tour_from: ["Город вылета", d.fromCity],
    svc_create_tour_to: ["Город прибытия", d.toCity],
    svc_create_tour_start: ["Дата начала", d.startDate],
    svc_create_tour_end: ["Дата окончания", d.endDate],
    svc_create_flight_departure: ["Дата рейса вылета", d.departureFlightDate],
    svc_create_flight_return: ["Дата рейса обратно", d.returnFlightDate],
    svc_ticket_event_date: ["Дата мероприятия", d.eventDate || d.ticketDate],
    svc_create_flight_details: ["Детали рейса", d.flightDetails],
    svc_create_tour_hotel: ["Отель", d.hotel],
    svc_create_tour_accommodation: ["Размещение", d.accommodation],
    svc_create_tour_roomcat: ["Категория номера", d.roomCategory],
    svc_create_tour_food: ["Питание", d.food],
    svc_create_tour_insurance: ["Страховка", bool(d.insuranceIncluded)],
    svc_create_tour_early_checkin: ["Ранний заезд", bool(d.earlyCheckIn)],
    svc_create_tour_fast_track: ["Fast Track", bool(d.arrivalFastTrack)],

    svc_hotel_country: ["Страна", d.country],
    svc_hotel_city: ["Город", d.toCity || d.city],
    svc_hotel_name: ["Отель", d.hotel],
    svc_hotel_checkin: ["Заезд", d.startDate],
    svc_hotel_checkout: ["Выезд", d.endDate],
    svc_hotel_roomcat: ["Категория номера", d.roomCategory],
    svc_hotel_accommodation: ["Размещение", d.accommodation],
    svc_hotel_food: ["Питание", d.food],
    svc_hotel_transfer: ["Трансфер", d.transfer],
    svc_hotel_pax: ["Гости", `${d.adt || 0}/${d.chd || 0}/${d.inf || 0}`],
    svc_hotel_halal: ["Halal", bool(d.halal)],
    svc_hotel_changeable: ["Можно менять", bool(d.changeable)],
    svc_hotel_insurance: ["Страховка", bool(d.insuranceIncluded)],
    svc_hotel_early_checkin: ["Ранний заезд", bool(d.earlyCheckIn)],
    svc_hotel_fast_track: ["Fast Track", bool(d.arrivalFastTrack)],

    svc_create_price: ["Нетто", d.price || d.netPrice],
    svc_create_grossPrice: ["Цена для клиента", d.grossPrice],
    svc_create_urgency: ["Срочность", urgencyLabel(d.urgency)],
    svc_create_expiration: ["Актуально до", d.expiration],
    svc_create_photo: ["Фото", Array.isArray(d.images) ? `${d.images.length} шт.` : ""],
  };

  const row = map[state];
  return row ? show(row[0], row[1]) : "";
}

async function promptWizardState(ctx, state) {
  await trackProviderFunnelFromBot(ctx, "wizard_step", {
    step: state,
    meta: { state },
  });

  const progressText = wizardProgressText(ctx, state);
  if (progressText) {
    await ctx.reply(progressText, { parse_mode: "HTML" });
  }

  const currentPreview = wizardCurrentPreview(ctx, state);
  if (currentPreview) {
    await ctx.reply(currentPreview);
  }
  switch (state) {
    case "svc_author_title":
      await ctx.reply(
        "🧭 Напишите *название авторского тура*.\nПример: *Авторский тур по Самарканду и горам*.\n\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_author_country":
      await ctx.reply("🌍 Укажите *страну / направление* авторского тура:", { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;

    case "svc_author_from":
      await ctx.reply("📍 Укажите *город старта / место начала* тура:", { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;

    case "svc_author_to":
      await ctx.reply("🏁 Укажите *город финиша / конечную точку*. Если маршрут круговой — можно повторить город старта:", { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;

    case "svc_author_start":
      await replyWizardCalendar(ctx, "svc_author_start");
      return;

    case "svc_author_end":
      await replyWizardCalendar(ctx, "svc_author_end");
      return;

    case "svc_author_format":
      await ctx.reply(
        "👥 Выберите формат авторского тура",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Групповой тур", callback_data: "author_fmt:group" }],
              [{ text: "👤 Индивидуальный тур", callback_data: "author_fmt:private" }],
              [{ text: "✨ Под запрос", callback_data: "author_fmt:custom" }],
              [{ text: "⬅️ Назад", callback_data: "svc_wiz:back" }],
              [{ text: "❌ Отмена", callback_data: "svc_wiz:cancel" }],
            ],
          },
        }
      );
      return;

    case "svc_author_stays": {
      const draft = ctx.session.serviceDraft || {};
    
      const stays = Array.isArray(draft.stays)
        ? draft.stays
        : Array.isArray(draft.details?.stays)
          ? draft.details.stays
          : [];
    
      const text = stays.length
        ? stays
            .map((x, i) => {
              const city = x.city || "Город";
              const hotel =
                x.hotel ||
                x.hotelName ||
                x.name ||
                "Отель";
    
              const nights =
                Number(
                  x.nights ??
                  x.nightCount ??
                  x.days ??
                  0
                ) || 0;
    
              return `${i + 1}. 🌍 ${city}\n🏨 ${hotel}${nights ? `\n🌙 ${nights} ноч.` : ""}`;
            })
            .join("\n\n")
        : "Пока ничего не добавлено.\n\nДобавьте проживание по городам.";
    
      await ctx.reply(
        `🏨 *Проживание тура*\n\n${text}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: stays.length
                    ? "➕ Добавить ещё"
                    : "➕ Добавить проживание",
                  callback_data: "author_stay:add",
                },
              ],
              [{ text: "✅ Продолжить", callback_data: "author_stay:done" }],
              [
                { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
              ],
            ],
          },
        }
      );
    
      return;
    }

    case "svc_author_program_days": {
      const draft = ctx.session.serviceDraft || {};
    
      const programDays = Array.isArray(draft.programDays)
        ? draft.programDays
        : Array.isArray(draft.details?.programDays)
          ? draft.details.programDays
          : [];
    
      const text = programDays.length
        ? programDays
            .map((x, i) => {
              const date = x.date ? `📅 ${x.date}\n` : "";
              const route = x.route ? `🛣 ${x.route}\n` : "";
              const title = x.title ? `📝 ${x.title}\n` : "";
              const items = Array.isArray(x.items)
                ? x.items.map((it) => `• ${it}`).join("\n")
                : String(x.items || "").trim();
    
              return `${i + 1}-kun\n${date}${route}${title}${items}`;
            })
            .join("\n\n")
        : "Пока дни программы не добавлены.\n\nДобавьте каждый день как отдельный блок: дата, маршрут, заголовок и пункты программы.";
    
      await ctx.reply(
        `🗓 *Программа тура по дням*\n\n${text}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: programDays.length ? "➕ Добавить ещё день" : "➕ Добавить день программы",
                  callback_data: "author_day:add",
                },
              ],
              [{ text: "✅ Продолжить", callback_data: "author_day:done" }],
              [
                { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
              ],
            ],
          },
        }
      );
    
      return;
    }

    case "author_stay_city":
      await ctx.reply(
        "🌍 Укажите город проживания\n\nНапример:\nUzungol",
        authorDayNavKeyboard({ skip: false })
      );
      return;

    case "author_stay_hotel":
      await ctx.reply(
        "🏨 Укажите отель\n\nНапример:\nKar Hotel",
        authorDayNavKeyboard({ skip: false })
      );
      return;

    case "author_stay_nights":
      await ctx.reply(
        "🌙 Количество ночей\n\nНапример:\n2",
        authorDayNavKeyboard({ skip: false })
      );
      return;
    
    case "author_day_date":
      await replyWizardCalendar(ctx, "author_day_date");
      return;

    case "author_day_route":
      await ctx.reply(
        "🛫 Укажите *маршрут / локацию дня*\n\nНапример:\nУзунгёль → Трабзон\n\nЕсли маршрута нет — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...authorDayNavKeyboard({ skip: true }) }
      );
      return;

    case "author_day_title":
      await ctx.reply(
        "📝 Укажите *заголовок дня*\n\nНапример:\nЭкскурсия по окрестностям Узунгёля\n\nЕсли заголовок не нужен — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...authorDayNavKeyboard({ skip: true }) }
      );
      return;

    case "author_day_items":
      await ctx.reply(
        "📌 Укажите *пункты программы*\n\nМожно через точку с запятой или каждый пункт с новой строки.\n\nПример:\nВстреча в аэропорту; Трансфер; Размещение в отеле",
        { parse_mode: "Markdown", ...authorDayNavKeyboard({ skip: false }) }
      );
      return;

    case "svc_author_included":
      await replyAuthorIncludedBuilder(ctx);
      return;

    case "svc_author_not_included":
      await replyAuthorExcludedBuilder(ctx);
      return;

    case "author_included_custom":
      await ctx.reply(
        "➕ Введите свой пункт, который включён в стоимость.\n\nНапример:\nСтраховка",
        { ...wizNavKeyboard() }
      );
      return;

    case "author_excluded_custom":
      await ctx.reply(
        "➕ Введите свой пункт, который не включён в стоимость.\n\nНапример:\nЛичные расходы",
        { ...wizNavKeyboard() }
      );
      return;

    case "svc_author_pax": {
      const currentMin = ctx.session.serviceDraft?.minPax || "";
      const currentMax = ctx.session.serviceDraft?.maxPax || "";
      const current =
        currentMin || currentMax
          ? `\n\nТекущее: ${currentMin || "?"}/${currentMax || "?"}`
          : "";
      await ctx.reply(`👥 Укажите *минимум/максимум человек* в формате \`2/10\`.${current}`, { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;
    }

    case "svc_author_language": {
        const selected = Array.isArray(ctx.session.serviceDraft?.languages)
          ? ctx.session.serviceDraft.languages
          : [];
      
        const has = (name) => selected.includes(name);
      
        await ctx.reply(
          "🗣 Укажите язык гида\n\nМожно выбрать несколько языков, затем нажмите ✅ Продолжить.",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: `${has("Узбекский") ? "✅" : "☐"} 🇺🇿 УЗБ`,
                    callback_data: "author_lang:uz",
                  },
                  {
                    text: `${has("Русский") ? "✅" : "☐"} 🇷🇺 РУС`,
                    callback_data: "author_lang:ru",
                  },
                ],
                [
                  {
                    text: `${has("Английский") ? "✅" : "☐"} 🇬🇧 АНГ`,
                    callback_data: "author_lang:en",
                  },
                ],
                [
                  { text: "➕ Свой вариант", callback_data: "author_lang:custom" },
                ],
                [
                  { text: "✅ Продолжить", callback_data: "author_lang:done" },
                ],
                [
                  { text: "⏭ Пропустить", callback_data: "svc_wiz:skip" },
                ],
                [
                  { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                  { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
                ],
              ],
            },
          }
        );
      return;
      }
  
      case "author_language_custom":
    await ctx.reply(
      "🗣 Введите язык гида\n\nНапример:\nТурецкий",
      { ...wizNavKeyboard() }
    );
    return;
    
    case "svc_author_meeting":
      await ctx.reply("📌 Укажите *место встречи*. Если по договорённости — так и напишите.", { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;

    case "svc_author_cancel":
      await ctx.reply("📄 Укажите *условия отмены / важные условия*. Если не нужно — нажмите «⏭ Пропустить».", { parse_mode: "Markdown", ...wizNavKeyboard() });
      return;

    case "svc_create_title": {
      const category = String(ctx.session?.serviceDraft?.category || "");
    
      const label =
        category === "refused_flight"
          ? "отказного авиабилета"
          : category === "refused_hotel"
            ? "отказного отеля"
            : "отказного тура";
    
      await ctx.reply(
        `✍️ Напишите *название ${label}*.\n\nЕсли не нужно — нажмите «⏭ Пропустить».`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_tour_country":
      await ctx.reply("🌍 Укажите *страну направления* (например: Таиланд):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_from":
      await ctx.reply("🛫 Укажите *город вылета* (например: Ташкент):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_to":
      await ctx.reply("🛬 Укажите *город прибытия* (например: Бангкок):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_start":
      await replyWizardCalendar(ctx, "svc_create_tour_start");
      return;

    case "svc_create_tour_end":
      await replyWizardCalendar(ctx, "svc_create_tour_end");
      return;

    case "svc_create_flight_departure":
      await replyWizardCalendar(ctx, "svc_create_flight_departure");
      return;

    case "svc_create_flight_return":
      await replyWizardCalendar(ctx, "svc_create_flight_return");
      return;

    case "svc_ticket_event_date":
      await replyWizardCalendar(ctx, "svc_ticket_event_date");
      return;

    case "svc_create_flight_details":
      await ctx.reply(
        "✈️ Укажите *детали рейса* (номер/время/авиакомпания)\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_hotel":
      await ctx.reply("🏨 Укажите *название отеля*:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_accommodation":
      await ctx.reply(
        "🛏 Укажите *размещение*\nНапример: *DBL*, *SGL*, *2ADL+1CHD* и т.д.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
        case "svc_create_tour_roomcat":
      await ctx.reply(
        "⭐️ Укажите *категорию номера* (например: Standard / Deluxe / Suite):\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_food":
      await ctx.reply(
        "🍽 Укажите *питание* (например: BB / HB / FB / AI / UAI):\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_insurance":
      await ctx.reply("🛡 *Страховка включена?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_create_tour_early_checkin":
      await ctx.reply("🏨 *Раннее заселение доступно?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_create_tour_fast_track":
      await ctx.reply("🛬 *Arrival Fast Track включён?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    // ===== REFUSED HOTEL =====
    case "svc_hotel_country":
      await ctx.reply("🌍 Укажите *страну* (например: Турция):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_city":
      await ctx.reply("🏙 Укажите *город* (например: Стамбул):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_name":
      await ctx.reply("🏨 Укажите *название отеля*:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_checkin":
      await replyWizardCalendar(ctx, "svc_hotel_checkin");
      return;

    case "svc_hotel_checkout":
      await replyWizardCalendar(ctx, "svc_hotel_checkout");
      return;

    case "svc_hotel_roomcat":
      await ctx.reply(
        "⭐️ Укажите *категорию номера* (например: Standard / Deluxe / Suite):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_accommodation":
      await ctx.reply(
        "🛏 Укажите *размещение*\nНапример: *DBL*, *SGL*, *2ADL+1CHD* и т.д.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_food":
      await ctx.reply(
        "🍽 Укажите *питание* (например: BB / HB / FB / AI / UAI):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_halal":
      await ctx.reply("🥗 *Halal питание?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_hotel_transfer":
      await ctx.reply(
        "🚗 Укажите *трансфер* (Индивидуальный / Групповой / Отсутствует):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_changeable":
      await ctx.reply("🔁 *Можно вносить изменения?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_hotel_pax":
      await ctx.reply(
        "👥 Укажите количество человек в формате *ADT/CHD/INF*\nПример: *2/1/0*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

        case "svc_hotel_insurance":
      await ctx.reply("🛡 *Страховка включена?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_hotel_early_checkin":
      await ctx.reply("🏨 *Раннее заселение доступно?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;

    case "svc_hotel_fast_track":
      await ctx.reply("🛬 *Arrival Fast Track включён?*", {
        parse_mode: "Markdown",
        ...yesNoWizardKeyboard(),
      });
      return;
      
    case "svc_create_price": {
      const cat = ctx.session?.serviceDraft?.category;
            const label =
        cat === "refused_hotel"
          ? "за отель"
          : cat === "refused_flight"
            ? "за авиабилет"
            : cat === "refused_ticket" || cat === "refused_event_ticket"
              ? "за билет"
              : "за тур";
      await ctx.reply(
        `💰 Укажите *цену НЕТТО* (${label})\nПример: *1130* или *1130 USD*`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_grossPrice": {
      const cat = ctx.session?.serviceDraft?.category;
            const label =
        cat === "refused_hotel"
          ? "за отель"
          : cat === "refused_flight"
            ? "за авиабилет"
            : cat === "refused_ticket" || cat === "refused_event_ticket"
              ? "за билет"
              : "за тур";
      await ctx.reply(
        `💳 Укажите *цену БРУТТО* (${label})\nПример: *1250* или *1250 USD*\n` +
          `Или нажмите «⏭ Пропустить» — посчитаю автоматически (+${
            DEFAULT_GROSS_MARKUP_PERCENT || 10
          }%).`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_urgency":
      await ctx.reply(
        "⚡ <b>Как быстро нужно продать?</b>\n\nЭто поможет Travella выделять самые срочные отказные предложения и правильнее сортировать карточки.",
        { parse_mode: "HTML", ...buildUrgencyKeyboard() }
      );
      return;

    case "svc_create_expiration":
      await replyWizardCalendar(ctx, "svc_create_expiration");
      return;

    case "svc_create_photo": {
      const photos = Array.isArray(ctx.session.serviceDraft?.images)
        ? ctx.session.serviceDraft.images
        : [];
      const currentText = photos.length
        ? `\n\nСейчас загружено: ${photos.length} фото`
        : "\n\nСейчас фото нет";
      await ctx.reply(
        `🖼 Отправьте фото услуги${currentText}\n\n• Можно отправить несколько фото\n• Нажмите «✅ Готово», когда закончите`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧹 Очистить фото", callback_data: "svc_photo:clear" }],
              [{ text: "✅ Завершить фото", callback_data: "svc_photo:done" }],
              [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
              [
                { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
              ],
            ],
          },
        }
      );
      return;
    }

    default:
      await ctx.reply("Продолжаем создание услуги 👇", wizNavKeyboard());
      return;
  }
}

async function finishCreateServiceFromWizard(ctx) {
  try {
    const draft = ctx.session?.serviceDraft;
    const category = draft?.category;

    if (!draft || !["refused_tour", "author_tour", "refused_hotel", "refused_flight", "refused_ticket", "refused_event_ticket"].includes(category)) {
      await ctx.reply(
        "⚠️ Не вижу данных мастера.\nПожалуйста, начните заново через «🧳 Мои услуги»."
      );
      resetServiceWizard(ctx);
      return;
    }

    const priceNum = normalizePrice(draft.price);
    if (priceNum === null) {
      await ctx.reply(
        "😕 Не понял цену.\nВведите число, например: *1130* или *1130 USD*.",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_price";
      return;
    }

    const grossNum = normalizePrice(draft.grossPrice);
    if (grossNum === null && String(draft.grossPrice || "").trim()) {
      await ctx.reply(
        "😕 Не понял цену брутто.\nВведите число (например *1250*) или нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_grossPrice";
      return;
    }

    draft.grossPriceNum = grossNum;
    let grossNumFinal = normalizePrice(draft.grossPrice);
    if (grossNumFinal === null) grossNumFinal = calcGrossFromNet(priceNum);
    draft.grossPriceNum = grossNumFinal;
    
    // ✅ ВАЛИДАЦИЯ: БРУТТО НЕ МОЖЕТ БЫТЬ МЕНЬШЕ НЕТТО
    // grossNumFinal уже финальный (введённый или рассчитанный)
    if (grossNumFinal !== null && grossNumFinal < priceNum) {
      await ctx.reply(
        `⚠️ Цена *БРУТТО* не может быть меньше *НЕТТО*.\n` +
          `Сейчас: нетто=${priceNum}, брутто=${grossNumFinal}.\n\n` +
          `Введите цену БРУТТО заново (например: *1250* или *1250 USD*) ` +
          `или нажмите «⏭ Пропустить».`,
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_grossPrice";
      return;
    }
    
    // ✅ мягкая нормализация строк перед сборкой details
    const clean = (v) => String(v || "").trim();
    
    draft.hotel = clean(draft.hotel);
    draft.accommodation = clean(draft.accommodation);
    draft.roomCategory = clean(draft.roomCategory);
    draft.food = clean(draft.food);
    draft.country = clean(draft.country);
    draft.fromCity = clean(draft.fromCity);
    draft.toCity = clean(draft.toCity);
    
    let details;
    let title;

    if (category === "author_tour") {
      details = buildDetailsForAuthorTour(draft, priceNum);
      title = autoTitleAuthorTour(draft);

    } else if (category === "refused_tour") {
      details = buildDetailsForRefusedTour(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedTour(draft);
    
    } else if (category === "refused_flight") {
      details = buildDetailsForRefusedFlight(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedFlight(draft);

    } else if (category === "refused_ticket" || category === "refused_event_ticket") {
      details = buildDetailsForRefusedTicket(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedTicket(draft);

    } else {
      details = buildDetailsForRefusedHotel(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedHotel(draft);
    }

    if (details && typeof details === "object") {
      details.urgency = draft.urgency || null;
      details.urgencyLabel = urgencyLabel(draft.urgency);
    }

    const payload = {
      category,
      title,
      price: priceNum,
      details,
      images: draft.images || [],
    };

    const chatId = getActorId(ctx);
    if (!chatId) return;

    const isEditMode = Number.isFinite(Number(draft.id)) && Number(draft.id) > 0;

    const { data } = isEditMode
      ? await axios.patch(
          `/api/telegram/provider/${chatId}/services/${Number(draft.id)}`,
          payload
        )
      : await axios.post(
          `/api/telegram/provider/${chatId}/services`,
          payload
        );

    if (!data || !data.success) {
      console.log("[tg-bot] createServiceFromWizard resp:", data);
      await ctx.reply(
        "⚠️ Не удалось сохранить услугу.\nПопробуйте позже или добавьте через кабинет."
      );
      resetServiceWizard(ctx);
      return;
    }

    const createdServiceId = data?.service?.id || (Number.isFinite(Number(draft.id)) ? Number(draft.id) : null);

    await trackProviderFunnelFromBot(ctx, "wizard_saved_draft", {
      serviceId: createdServiceId,
      category,
      status: "draft",
      meta: { is_edit_mode: isEditMode },
    });

    await finishProviderServiceDraft(ctx, "submitted");

    if (proofRequiredCategories.includes(String(category || "").toLowerCase())) {
      ctx.session.awaitingProofForServiceId = createdServiceId;
      ctx.session.awaitingProofForCategory = String(category || "").toLowerCase();

      await replyProofUploadPrompt(ctx, {
        serviceId: createdServiceId,
        category,
        isEditMode,
      });

      resetServiceWizard(ctx);

      return;
    }

    await trackProviderFunnelFromBot(ctx, "submitted_to_moderation", {
      serviceId: createdServiceId,
      category,
      status: "pending",
      meta: { proof_required: false, is_edit_mode: isEditMode },
    });

    await ctx.reply(
      isEditMode
        ? `✅ Готово!\n\nИзменения услуги #${createdServiceId} сохранены и отправлены на модерацию.`
        : `✅ Готово!\n\nУслуга #${createdServiceId} создана и отправлена на модерацию.\nПосле одобрения она появится в поиске.`
    );

    resetServiceWizard(ctx);

    await ctx.reply("Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    const apiError = e?.response?.data?.error || null;
    console.error(
      "[tg-bot] finishCreateServiceFromWizard error:",
      e?.response?.data || e
    );

    if (apiError === "BAD_EXPIRATION_AFTER_START") {
      await ctx.reply(
        "⚠️ Срок актуальности не может быть позже даты начала тура / вылета.\n" +
          "Вернитесь к шагу актуальности и укажите дату до начала услуги."
      );
      ctx.session.state = "svc_create_expiration";
      return;
    }

    if (apiError === "BAD_EXPIRATION") {
      await ctx.reply(
        "⚠️ Неверный формат срока актуальности. Используйте YYYY-MM-DD HH:mm или YYYY.MM.DD HH:mm."
      );
      ctx.session.state = "svc_create_expiration";
      return;
    }

    await ctx.reply("⚠️ Ошибка при сохранении услуги. Попробуйте позже.");
    resetServiceWizard(ctx);
  }
}

/* ===================== PHONE LINKING ===================== */

async function handlePhoneRegistration(ctx, requestedRole, phone) {
  try {
    if (ctx.chat?.type && ctx.chat.type !== "private") {
      await ctx.reply(
        "📌 Привязка номера доступна только в личных сообщениях.\nОткройте бота и нажмите /start."
      );
      return;
    }

    const chatId = ctx.chat.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const payload = { role: requestedRole, phone, chatId, username, firstName };
    console.log("[bot] handlePhoneRegistration payload:", payload);

    const { data } = await axios.post(`/api/telegram/link`, payload);
    console.log("[bot] /api/telegram/link response:", data);

    if (!data || !data.success) {
      await ctx.reply("⚠️ Не удалось привязать номер. Попробуйте позже.");
      return;
    }

    const finalRole =
      data.role === "provider" || data.role === "provider_lead"
        ? "provider"
        : "client";

    if (!ctx.session) ctx.session = {};

    // ✅ pending/lead = НЕ даём меню и НЕ считаем привязку "одобренной"
    const isPending =
      data.role === "provider_lead" ||
      data.created === "provider_lead" ||
      data.pending === true;

    if (isPending) {
      ctx.session.role = null;
      ctx.session.linked = false;
      ctx.session.pending = true;
      ctx.session.pendingRole = finalRole;

      await ctx.reply(
        "🕒 Заявка принята и отправлена на модерацию.\n\n" +
          "⏳ Пожалуйста, дождитесь одобрения администратора.\n" +
          "После одобрения меню станет доступно.\n\n" +
          `🌐 Сайт: ${SITE_URL}`,
        { parse_mode: "Markdown" }
      );

      // ❗️ВАЖНО: тут выходим, меню ниже НЕ показываем
      return;
    }

    // ✅ Одобрено (аккаунт найден/создан не через lead)
    ctx.session.role = finalRole;
    ctx.session.linked = true;
    ctx.session.pending = false;
    ctx.session.pendingRole = null;


    if (finalRole === "client") {
      await showClientHome(ctx);
      return;
    }
    
    if (data.existed && data.role === "provider") {
      await ctx.reply(
        "✅ Готово!\n\nВаш Telegram привязан к аккаунту *поставщика*.",
        { parse_mode: "Markdown" }
      );
    
      if (data.requestedRole === "client") {
        await ctx.reply(
          "ℹ️ По этому номеру уже есть аккаунт поставщика.\nЕсли хотите быть клиентом — зарегистрируйтесь на сайте отдельно."
        );
      }
    } else if (data.created === "provider_lead") {
      await ctx.reply(
        "📝 Заявка принята!\n\nМы зарегистрировали вас как *нового поставщика*.\nПосле модерации менеджер свяжется с вами.\n\n" +
          `🌐 Сайт: ${SITE_URL}`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply("✅ Привязка выполнена.");
    }
    
    await ctx.reply("📌 Готово! Меню доступно ниже 👇", getMainMenuKeyboard(finalRole));
  } catch (e) {
    console.error("[tg-bot] handlePhoneRegistration error:", e?.response?.data || e);
    await ctx.reply("⚠️ Ошибка привязки номера. Попробуйте позже.");
  }
}

bot.hears(/^\/testpay(?:@\w+)?$/i, async (ctx) => {
  try {
    if (!PAYMENTS_PROVIDER_TOKEN) {
      await ctx.reply("❌ TELEGRAM_PAYMENTS_PROVIDER_TOKEN отсутствует");
      return;
    }

    await ctx.telegram.sendInvoice(ctx.chat.id, {
      title: "Тест Payme",
      description: "Проверка Telegram Payments",
      payload: `contact_topup:${ctx.from.id}:10000:${Date.now()}`,
      provider_token: PAYMENTS_PROVIDER_TOKEN,
      currency: PAYMENTS_CURRENCY,
      prices: [
        {
          label: "Тестовый платеж",
          amount: 10000 * currencyMinorFactor(PAYMENTS_CURRENCY),
        },
      ],
      start_parameter: "test_payment",
    });
  } catch (e) {
    console.error("[tg-bot] /testpay error:", e?.message || e);
    await ctx.reply("❌ Ошибка Telegram Payme testpay");
  }
});

/* ===================== /start ===================== */

bot.start(async (ctx) => {
  logUpdate(ctx, "/start");

  const actorId = getActorId(ctx);
  if (!actorId) {
    await ctx.reply("⚠️ Не удалось определить пользователя. Попробуйте позже.");
    return;
  }

  const startPayloadRaw = (ctx.startPayload || "").trim();

  try {
    let role = null;

    // ✅ ПРИОРИТЕТ: СНАЧАЛА provider, ПОТОМ client
    try {
      const resProv = await axios.get(`/api/telegram/profile/provider/${actorId}`);
      if (resProv.data && resProv.data.success) role = "provider";
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.log("[tg-bot] profile provider error:", e?.response?.data || e.message || e);
      }
    }

    // client проверяем ТОЛЬКО если провайдера нет
    if (!role) {
      try {
        const resClient = await axios.get(`/api/telegram/profile/client/${actorId}`);
        if (resClient.data && resClient.data.success) role = "client";
      } catch (e) {
        if (e?.response?.status !== 404) {
          console.log("[tg-bot] profile client error:", e?.response?.data || e.message || e);
        }
      }
    }

    if (role) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      // ✅ Deep-link: refused_<serviceId> => показать конкретную услугу
      const mRef = startPayloadRaw.match(/^refused_(\d+)$/i);
      if (mRef) {
        const serviceId = Number(mRef[1]);

        try {
          // берём услугу и данные поставщика (имена полей подстрой под свою БД)
          const { data } = await axios.get(`/api/telegram/service/${serviceId}`, {
            params: { role },
          });

          if (!data?.success || !data?.service) {
            await ctx.reply("❗️Услуга не найдена или уже снята с публикации.");
            await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
            return;
          }

        const svc = data.service;

        // ✅ важно: в некоторых местах категория хранится в s.type, а не в s.category
        const category = String(svc.category || svc.type || "refused_tour")
          .trim()
          .toLowerCase();

        // 🔐 вычисляем unlock заранее
        let unlocked = true;
        let unlockPrice = 0;

        if (role === "client") {
          const clientRow = await getClientRowByChatId(pool, actorId);

        const unlockSettings = await getContactUnlockSettings(pool);
        unlockPrice = tiyinToSum(unlockSettings.effective_price || 0);

          const alreadyUnlocked = clientRow?.id
            ? await isContactsUnlocked(pool, {
                clientId: clientRow.id,
                serviceId,
              })
            : false;

          // ✅ бесплатный режим = сразу считаем карточку открытой
          unlocked = unlockPrice <= 0 ? true : alreadyUnlocked;
        }

        const cardRole = role === "client" ? "client" : role;
        const isRefused = String(category || "").startsWith("refused_") || String(category || "").toLowerCase() === "author_tour";

        const { text, photoUrl, serviceUrl, kbExtra } =
          buildServiceMessage(svc, category, cardRole, {
            unlocked,
            unlockPrice,
            isInline: false,
            forceRefused: isRefused,
          });

        let textFinal = text;
        let kb = { inline_keyboard: [] };

        if (role === "client") {
          if (!unlocked) {
            textFinal = stripLockedLinks(text);

            kb = kbExtra?.replaceDefault && kbExtra?.inline_keyboard?.length
              ? { inline_keyboard: kbExtra.inline_keyboard }
              : {
                  inline_keyboard: [
                    [
                      {
                        text:
                          unlockPrice > 0
                            ? `🔓 Открыть контакты (${unlockPrice.toLocaleString("ru-RU")} сум)`
                            : "🔓 Открыть контакты",
                        callback_data: buildUnlockCbData(ctx.from.id, serviceId),
                      },
                    ],
                  ],
                };
          } else {
            // ✅ в бесплатном режиме / после unlock показываем сразу открытые действия
            kb = kbExtra?.replaceDefault && kbExtra?.inline_keyboard?.length
              ? { inline_keyboard: kbExtra.inline_keyboard }
              : {
                  inline_keyboard: [
                    ...(kbExtra?.inline_keyboard?.length ? kbExtra.inline_keyboard : []),
                    [{ text: "🌐 Подробнее на сайте", url: serviceUrl }],
                    [{ text: "💬 Быстрый запрос", callback_data: `quick:${serviceId}` }],
                  ],
                };
          }
        } else {
          // provider/admin
          kb = kbExtra?.replaceDefault && kbExtra?.inline_keyboard?.length
            ? { inline_keyboard: kbExtra.inline_keyboard }
            : {
                inline_keyboard: [
                  ...(kbExtra?.inline_keyboard?.length ? kbExtra.inline_keyboard : []),
                  [{ text: "🌐 Подробнее на сайте", url: serviceUrl }],
                  [{ text: "💬 Быстрый запрос", callback_data: `quick:${serviceId}` }],
                ],
              };
        }

          if (photoUrl) {
            await safeReplyWithPhoto(ctx, photoUrl, textFinal, {
              parse_mode: "HTML",
              reply_markup: kb,
            });
          } else {
            await ctx.reply(textFinal, {
              parse_mode: "HTML",
              reply_markup: kb,
              disable_web_page_preview: true,
            });
          }

          return; // ✅ не показываем главное меню вместо услуги
        } catch (e) {
          console.log("[tg-bot] refused_<id> open error:", e?.response?.data || e?.message || e);
          await ctx.reply("⚠️ Не удалось открыть услугу. Попробуйте позже.");
          await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
          return;
        }
      }

      if (startPayloadRaw === "start") {
        await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
        return;
      }

      if (startPayloadRaw === "my_empty") {
        if (role !== "provider") {
          await ctx.reply(
            "🧳 «Мои услуги» доступны только поставщикам.\nЕсли вы поставщик — привяжите номер как поставщик.",
            getMainMenuKeyboard("client")
          );
          return;
        }

        await ctx.reply(
          "🛑 У вас сейчас нет *актуальных* услуг в боте.\n\nЧто можно сделать:\n• Создать новую услугу\n• Открыть список и продлить/активировать услуги\n",
          { parse_mode: "Markdown" }
        );

        await ctx.reply("🧳 Выберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
              [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        });
        return;
      }

      if (startPayloadRaw === "search_empty") {
        await ctx.reply(
          "😕 Сейчас нет *актуальных* предложений по выбранному типу.\nПопробуйте другой тип услуги или проверьте позже 👇",
          { parse_mode: "Markdown" }
        );

        await ctx.reply("🔎 Выберите тип услуги (отправка в текущий чат):", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📍 Отказной тур", switch_inline_query_current_chat: "#tour refused_tour" }],
              [{ text: "🏨 Отказной отель", switch_inline_query_current_chat: "#tour refused_hotel" }],
              [{ text: "✈️ Отказной авиабилет", switch_inline_query_current_chat: "#tour refused_flight" }],
              [{ text: "🎫 Отказной билет", switch_inline_query_current_chat: "#tour refused_ticket" }],
            ],
          },
        });

        await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
        return;
      }

      await ctx.reply("✅ Аккаунт найден.\n\nВыберите раздел в меню ниже 👇", getMainMenuKeyboard(role));
      return;
    }

    if (
      startPayloadRaw === "start" ||
      startPayloadRaw === "my_empty" ||
      startPayloadRaw === "search_empty"
    ) {
      await ctx.reply(
        "👋 Чтобы бот работал корректно, нужно привязать аккаунт по номеру телефона.\nСейчас сделаем это 👇"
      );
      await askRole(ctx);
      return;
    }

    await ctx.reply(
      "👋 Добро пожаловать в Travella!\n\nЧтобы показать ваши бронирования/заявки — привяжем аккаунт по номеру телефона."
    );
    await askRole(ctx);
  } catch (e) {
    console.error("[tg-bot] /start error:", e?.response?.data || e);
    await ctx.reply("⚠️ Ошибка. Попробуйте позже.");
  }
});

/* ===================== ROLE PICK ===================== */

bot.action(/^role:(client|provider)$/, async (ctx) => {
  try {
    const role = ctx.match[1];
    if (!ctx.session) ctx.session = {};
    ctx.session.requestedRole = role;

    await ctx.answerCbQuery();

    await ctx.reply(
      role === "client"
        ? "👤 <b>Вы вошли как клиент</b>\n\n" +
          "🔥 <b>Найдём туры и услуги дешевле рынка</b>\n" +
          "(отказные предложения со скидками)\n\n" +
          "💰 <b>Экономия обычно 20–40%</b>\n" +
          "⚡ Лучшие варианты быстро разбирают\n\n" +
          "📲 Чтобы продолжить, подтвердите номер телефона\n\n" +
          "Это нужно для:\n" +
          "— входа в ваш кабинет\n" +
          "— заявок и бронирований\n" +
          "— открытия контактов поставщиков\n\n" +
          "Нажмите кнопку ниже 👇"
        : "🏢 <b>Вы вошли как поставщик</b>\n\n" +
          "📲 Отправьте номер телефона, указанный при регистрации на <b>travella.uz</b>.\n\n" +
          "После подтверждения вы сможете:\n" +
          "— размещать свои отказы\n" +
          "— искать предложения\n" +
          "— получать заявки\n\n" +
          "Можно текстом или через кнопку ниже 👇",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "📲 Отправить мой номер", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] role action error:", e);
  }
});

bot.on("contact", async (ctx) => {
  logUpdate(ctx, "contact");

  const contact = ctx.message.contact;
  if (!contact || !contact.phone_number) {
    await ctx.reply("⚠️ Не удалось прочитать номер. Попробуйте ещё раз.");
    return;
  }

  if (ctx.chat?.type && ctx.chat.type !== "private") {
    await ctx.reply(
      "📌 Привязка номера доступна только в личных сообщениях.\nОткройте бота и нажмите /start."
    );
    return;
  }

  const phone = contact.phone_number;
  const requestedRole = ctx.session?.requestedRole || "client";
  await handlePhoneRegistration(ctx, requestedRole, phone);
});

// ==== TEXT PHONE INPUT (не мешаем мастеру/датам) ====
bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx, next) => {
  const st = ctx.session?.state || null;

  if (
    st &&
    (String(st).startsWith("svc_create_") ||
      String(st).startsWith("svc_hotel_") ||
      String(st).startsWith("svc_edit_"))
  ) {
    return next();
  }

  const t = String(ctx.message?.text || "").trim();
  if (normalizeDateInput(t)) return next();

  if (!ctx.session || !ctx.session.requestedRole) return next();

  const phone = t;
  const requestedRole = ctx.session.requestedRole;
  await handlePhoneRegistration(ctx, requestedRole, phone);
});

/* ===================== MAIN MENU BUTTONS ===================== */

bot.hears(/🔍 Найти услугу/i, async (ctx) => {
  logUpdate(ctx, "hears Найти услугу");
  forceCloseEditWizard(ctx);
  resetServiceWizard(ctx);


  const maybeProvider = await ensureProviderRole(ctx);
  const maybeClient = maybeProvider ? null : await ensureClientRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || maybeClient || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы искать и бронировать услуги, нужно привязать аккаунт по номеру телефона.");
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "🔥 <b>Что ищем?</b>\n\n" +
      "Выберите выгодное предложение 👇\n\n" +
      "💰 Обычно такие варианты дешевле рынка на 20–40%",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌴 Отказной тур (пакет)", switch_inline_query_current_chat: "#tour refused_tour" }],
          [{ text: "🧭 Авторский тур", switch_inline_query_current_chat: "#author" }],
          [{ text: "🏨 Отказной отель", switch_inline_query_current_chat: "#tour refused_hotel" }],
          [{ text: "✈️ Отказной авиабилет", switch_inline_query_current_chat: "#tour refused_flight" }],
          [{ text: "🎫 Билет / мероприятие", switch_inline_query_current_chat: "#tour refused_ticket" }],
        ],
      },
      disable_web_page_preview: true,
    }
  );

  await ctx.reply("💡 Нажмите кнопку, выберите карточку — бот отправит её в этот чат.");
});

bot.hears(/❤️ Избранное/i, async (ctx) => {
  logUpdate(ctx, "hears Избранное");
  await ctx.reply(
    "❤️ Избранное в боте пока в разработке.\n\nСейчас вы можете добавлять и смотреть избранное на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/📄 (Мои брони|Бронирования)/i, async (ctx) => {
  logUpdate(ctx, "hears Бронирования");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы показать ваши бронирования, нужно привязать аккаунт по номеру телефона.");
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "📄 Раздел бронирований в боте пока в разработке.\n\nВсе бронирования доступны в личном кабинете на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/📨 (Мои заявки|Заявки)/i, async (ctx) => {
  logUpdate(ctx, "hears Заявки");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы показать ваши заявки, нужно привязать аккаунт по номеру телефона.");
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "📨 Раздел заявок в боте пока в разработке.\n\nЗаявки/отклики доступны в личном кабинете на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/👤 Профиль/i, async (ctx) => {
  logUpdate(ctx, "hears Профиль");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "👤 Похоже, аккаунт ещё не привязан.\n\nДавайте привяжем по номеру телефона 👇"
    );
    await askRole(ctx);
    return;
  }

  if (role === "provider") {
    await ctx.reply(
      `🏢 Профиль поставщика можно изменить в кабинете:\n\n${SITE_URL}/dashboard/profile`
    );
    return;
  }

  // ✅ CLIENT: добавляем кнопку оферты + ссылку на оферту
  await ctx.reply(
    `👤 Профиль клиента можно изменить на сайте:\n\n${SITE_URL}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌐 Открыть сайт", url: SITE_URL }],
          [{ text: "📄 Оферта (что я принял)", callback_data: "profile:offer" }],
          [{ text: "📄 Открыть оферту", url: "https://travella.uz/page/oferta" }],
        ],
      },
      disable_web_page_preview: true,
    }
  );
});

bot.hears(/🏢 Стать поставщиком/i, async (ctx) => {
  logUpdate(ctx, "hears Стать поставщиком");
  await ctx.reply(
    "🏢 Хотите стать поставщиком Travella?\n\nЗаполните форму на сайте и дождитесь модерации:\n" +
      `${SITE_URL}\n\nМы свяжемся с вами по указанным контактам.`
  );
});

/* ===================== PROVIDER MENU: МОИ УСЛУГИ ===================== */

bot.hears(/🧳 Мои услуги/i, async (ctx) => {
  logUpdate(ctx, "hears Мои услуги");
  forceCloseEditWizard(ctx);
  resetServiceWizard(ctx);


  const role = await ensureProviderRole(ctx);
  if (role !== "provider") {
    await ctx.reply(
      "🧳 «Мои услуги» доступны только поставщикам.\n\nЕсли хотите размещать туры/отели — зарегистрируйтесь как поставщик на сайте:\n" +
        `${SITE_URL}`
    );
    return;
  }

const counters = await fetchProviderServiceCounters(ctx);

await ctx.reply("🧳 Выберите действие:", {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
      [{ text: "📢 Актуальные", callback_data: "prov_services:list_cards" }],
      [
        { text: pendingButtonLabel(counters.pending), callback_data: "pending:open" },
        { text: draftButtonLabel(counters.draft), callback_data: "drafts:open" },
      ],
      [
        { text: archiveButtonLabel(counters.archive), callback_data: "archive:open" },
        { text: trashButtonLabel(counters.trash), callback_data: "trash:open" },
      ],
      [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
      [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
    ],
  },
});
});


bot.hears("🗄 Архив", async (ctx) => {
  try {
    await renderArchive(ctx);
  } catch (e) {
    console.error("[bot] archive hears error:", e?.message || e);
    return ctx.reply("❌ Не удалось загрузить архив. Попробуйте позже.");
  }
});

bot.hears("🧺 Корзина", async (ctx) => {
  try {
    await renderTrash(ctx);
  } catch (e) {
    console.error("[bot] trash hears error:", e?.message || e);
    return ctx.reply("❌ Не удалось загрузить корзину. Попробуйте позже.");
  }
});

bot.hears("📝 Черновики", async (ctx) => {
  try {
    await renderDrafts(ctx);
  } catch (e) {
    console.error("[bot] drafts hears error:", e?.message || e);
    return ctx.reply("❌ Не удалось загрузить черновики. Попробуйте позже.");
  }
});

bot.hears("🕓 На модерации", async (ctx) => {
  try {
    await renderPending(ctx);
  } catch (e) {
    console.error("[bot] pending hears error:", e?.message || e);
    return ctx.reply("❌ Не удалось загрузить услуги на модерации. Попробуйте позже.");
  }
});

bot.action("drafts:open", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    forceCloseEditWizard(ctx);
    await renderDrafts(ctx);
  } catch (e) {
    console.error("[tg-bot] drafts:open error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось загрузить черновики. Попробуйте позже.");
  }
});

bot.action("pending:open", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    forceCloseEditWizard(ctx);
    await renderPending(ctx);
  } catch (e) {
    console.error("[tg-bot] pending:open error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось загрузить услуги на модерации. Попробуйте позже.");
  }
});

bot.action("profile:offer", async (ctx) => {
  try {
    await safeCb(ctx);

    const chatId = ctx.from?.id;
    if (!chatId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя.");
      return;
    }

    if (!pool) {
      await safeReply(ctx, "⚠️ База данных недоступна. Попробуйте позже.");
      return;
    }

    // ⚠️ У тебя оферта хранится “на пользователя” (user_id = chatId)
    const r = await pool.query(
      `SELECT offer_version, accepted_at, source
         FROM user_offer_accepts
        WHERE user_role = 'client'
          AND user_id = $1
        ORDER BY accepted_at DESC
        LIMIT 1`,
      [Number(chatId)]
    );

    if (!r.rowCount) {
      await safeReply(
        ctx,
        "📄 Вы ещё не принимали оферту.\n\nОна будет предложена при первом открытии контактов.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📄 Открыть оферту", url: "https://travella.uz/page/oferta" }],
            ],
          },
        }
      );
      return;
    }

    const row = r.rows[0];
    const acceptedAt = row.accepted_at
      ? new Date(row.accepted_at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })
      : "—";

    const acceptedVer = row.offer_version || "—";
    const nowVer = OFFER_VERSION || "—";
    const src = row.source ? String(row.source) : "—";

    await safeReply(
      ctx,
      "📄 <b>Оферта Travella</b>\n\n" +
      "ℹ️ <b>Оферта принимается один раз и действует для всех открытий контактов.</b>\n\n" +
        `✅ Принятая версия: <b>${acceptedVer}</b>\n` +
        `🕒 Дата принятия: <b>${acceptedAt}</b>\n` +
        `📌 Источник: <b>${src}</b>\n` +
        `📎 Текущая версия в боте: <b>${nowVer}</b>\n\n` +
        "👇 Открыть текст оферты:",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📄 Открыть оферту", url: "https://travella.uz/page/oferta" }],
          ],
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] profile:offer error:", e?.message || e);
    try {
      await safeReply(ctx, "⚠️ Не удалось получить данные оферты. Попробуйте позже.");
    } catch {}
  }
});

bot.action("prov_services:back", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}

    const role = (await ensureProviderRole(ctx)) || ctx.session?.role || "client";
    await safeReply(ctx, "🏠 Главное меню:", getMainMenuKeyboard(role));
  } catch (e) {
    console.error("[tg-bot] prov_services:back error:", e?.response?.data || e);
  }
});

bot.action("prov_services:create", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply("➕ Ок! Давайте создадим новую услугу 👇");

    if (!ctx.session) ctx.session = {};
    // ✅ ВАЖНО: сбрасываем edit-wizard, чтобы создание НЕ перехватывалось редактированием
    ctx.session.editWiz = null;
    ctx.session.editDraft = null;
    ctx.session.editingServiceId = null;
    
    ctx.session.serviceDraft = { category: null, images: [] };
    ctx.session.wizardStack = [];
    ctx.session.state = "svc_create_choose_category";

    await ctx.reply("Выберите категорию отказной услуги:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📍 Отказной тур", callback_data: "svc_new_cat:refused_tour" }],
          [{ text: "🧭 Авторский тур", callback_data: "svc_new_cat:author_tour" }],
          [{ text: "🏨 Отказной отель", callback_data: "svc_new_cat:refused_hotel" }],
          [{ text: "✈️ Отказной авиабилет", callback_data: "svc_new_cat:refused_flight" }],
          [{ text: "🎫 Отказной билет", callback_data: "svc_new_cat:refused_ticket" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:list" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] prov_services:create error:", e?.response?.data || e);
  }
});

bot.action("prov_services:list", async (ctx) => {
  await ctx.answerCbQuery();

  // 🔴 принудительно закрываем wizard
  forceCloseEditWizard(ctx);

  const counters = await fetchProviderServiceCounters(ctx);

  return ctx.telegram.sendMessage(
    ctx.chat.id,
    "🧳 Выберите действие:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
          [{ text: "📢 Актуальные", callback_data: "prov_services:list_cards" }],
          [
            { text: pendingButtonLabel(counters.pending), callback_data: "pending:open" },
            { text: draftButtonLabel(counters.draft), callback_data: "drafts:open" },
          ],
          [
            { text: archiveButtonLabel(counters.archive), callback_data: "archive:open" },
            { text: trashButtonLabel(counters.trash), callback_data: "trash:open" },
          ],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    }
  );
});

bot.action(/^prov_services:list_cards(?::more)?$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
        // 🔴 ВАЖНО: принудительно закрываем wizard редактирования
    forceCloseEditWizard(ctx);

    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Раздел доступен только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(
        ctx,
        "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз."
      );
      return;
    }

    await safeReply(ctx, "⏳ Загружаю ваши услуги...");
    const { data } = await axios.get(
        `/api/telegram/provider/${actorId}/services/all`
      );

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] provider services malformed:", data);
      await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    if (!data.items.length) {
      await safeReply(
        ctx,
        "Пока нет опубликованных услуг.\n\nНажмите «➕ Создать услугу» или добавьте через кабинет.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "🌐 Открыть кабинет", url: `${SITE_URL}/dashboard/services/marketplace?from=tg` }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        }
      );
      return;
    }

    const PAGE_SIZE = 5;
    await safeReply(
      ctx,
      `✅ Найдено услуг: ${data.items.length}.\nПоказываю первые ${PAGE_SIZE} (по ближайшей дате).`
    );
    const offset = Number(ctx.session?.cardsOffset || 0);
    
    const itemsSorted = [...data.items].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
    const escapeHtml = (s) =>
      String(s ?? "")
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#39;");

    const pageItems = itemsSorted.slice(offset, offset + PAGE_SIZE);

    for (const svc of pageItems) {
      const category = svc.category || svc.type || "refused_tour";
      const details = parseDetailsAny(svc.details);

      const { photoUrl, serviceUrl } = buildServiceMessage(svc, category, "provider", { forceRefused: true });
      const msg = buildProviderCompactManageCardHtml(svc, category, details);
      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;
      const detailsUrl = serviceUrl || buildServiceUrl(svc.id);

      const keyboard = {
        inline_keyboard: [
          [
            { text: "✏️ Редактировать", callback_data: `svc_edit_start:${svc.id}` },
            { text: "⏳ Продлить", callback_data: `svc_extend:${svc.id}` },
          ],
          [
            { text: "⛔ Снять", callback_data: `svc_unpublish:${svc.id}` },
            { text: "🗄 Архивировать", callback_data: `svc_archive:${svc.id}` },
            { text: "🗑 Удалить", callback_data: `svc_delete:${svc.id}` },
          ],
          [{ text: "👁 Подробнее", url: detailsUrl }],
          [{ text: "🌐 Открыть в кабинете", url: manageUrl }],
        ],
      };

      if (photoUrl) {
        const photo = String(photoUrl).startsWith("tgfile:")
          ? String(photoUrl).replace(/^tgfile:/, "").trim()
          : photoUrl;
      
        await safeReplyWithPhoto(ctx, photo, msg, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } else {
        await ctx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          disable_web_page_preview: true,
        });
      }
    }
    ctx.session.cardsOffset = offset + PAGE_SIZE;

    if (itemsSorted.length > ctx.session.cardsOffset) {
      await ctx.reply("⬇️ Показать ещё?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬇️ Показать ещё", callback_data: "prov_services:list_cards:more" }],
            [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
          ],
        },
      });
      return; // ⛔ важно: не показываем "Что делаем дальше?"
    } else {
      ctx.session.cardsOffset = 0;
    }

    await safeReply(ctx, "Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    console.error(
      "[tg-bot] provider services error:",
      e?.response?.data || e?.message || e
    );
    await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
  }
});

/* ===================== SERVICE ACTION BUTTONS ===================== */

bot.action(/^svc_extend:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("⏳ Продлеваю…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/extend7`
    );

    await safeReply(ctx, "✅ Услуга продлена на 7 дней.");
  } catch (e) {
    console.error("[tg-bot] svc_extend error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось продлить услугу.");
  }
});

bot.action(/^svc_unpublish:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("⛔ Снимаю…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/unpublish`
    );

    await safeReply(ctx, "⛔ Услуга снята с публикации.");

    await replyProviderSupportPrompt(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] svc_unpublish error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось снять услугу.");
  }
});


bot.action(/^svc_restore_archive:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("♻️ Возвращаю…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/restore-archive`
    );

    await safeReply(ctx, "♻️ Услуга возвращена в активные и продлена на 7 дней.");
  } catch (e) {
    console.error("[tg-bot] svc_restore_archive error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось вернуть услугу в активные.");
  }
});

bot.action(/^svc_archive:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("🗄 Архивирую…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/archive`
    );

    await safeReply(ctx, "🗄 Услуга архивирована.");

    await replyProviderSupportPrompt(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] svc_archive error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось архивировать услугу.");
  }
});

/* ===================== УДАЛЕНИЕ УСЛУГИ ИЗ "МОИ КАРТОЧКИ" ===================== */

bot.action(/^svc_delete:(\d+)$/, async (ctx) => {
  try {
    const serviceId = ctx.match[1];
    await ctx.answerCbQuery();

    // гасим кнопки на исходной карточке, чтобы не было повторных кликов
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    await ctx.reply(
      `🗑 <b>Удалить услугу #${serviceId}?</b>\n\nУслуга будет скрыта из всех списков и попадёт в корзину.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "↩️ Отмена", callback_data: "prov_services:list" },
              { text: "🗑 Удалить", callback_data: `svc_delete_confirm:${serviceId}` },
            ],
            [{ text: "📢 Актуальные", callback_data: "prov_services:list_cards" }],
          ],
        },
      }
    );
  } catch (e) {
    console.error("[bot] svc_delete error:", e?.message || e);
    return ctx.reply("❌ Не удалось открыть подтверждение удаления.");
  }
});

// Подтверждение в боте

bot.action(/^svc_delete_confirm:(\d+)$/, async (ctx) => {
  try {
    const serviceId = ctx.match[1];
    await ctx.answerCbQuery("Удаляю...");

    // гасим кнопки confirm-сообщения
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    const actorId = getActorId(ctx);

    const r = await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/delete`
    );

    if (r?.data?.success === true) {
      await ctx.reply(
        `✅ Услуга <code>#${serviceId}</code> удалена.\n\nОна перемещена в корзину.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🧺 Открыть корзину", callback_data: "trash:open" },
                { text: "📢 Актуальные", callback_data: "prov_services:list_cards" },
              ],
              [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
            ],
          },
        }
      );
      return;
    }

    return ctx.reply(`❌ Не удалось удалить услугу <code>#${serviceId}</code>.`, {
      parse_mode: "HTML",
    });
  } catch (e) {
    const data = e?.response?.data || {};
    const code = e?.response?.status;

    console.error("[bot] svc_delete_confirm error:", data || e?.message || e);

    if (code === 404 || data?.error === "SERVICE_NOT_FOUND") {
      return ctx.reply("⚠️ Услуга уже не найдена.");
    }

    if (code === 409 || data?.error === "ALREADY_DELETED") {
      return ctx.reply("⚠️ Услуга уже удалена.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🧺 Открыть корзину", callback_data: "trash:open" }]],
        },
      });
    }

    if (
      code === 403 ||
      data?.error === "FORBIDDEN" ||
      data?.error === "PROVIDER_NOT_FOUND"
    ) {
      return ctx.reply("⛔ Нет доступа к этой услуге.");
    }

    return ctx.reply("❌ Ошибка при удалении услуги.");
  }
});



// ❌ Purge (confirm screen)
bot.action(/^svc_purge:(\d+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  await ctx.answerCbQuery();

  // ✅ гасим кнопки на панели выбора (restore/purge), чтобы не нажали 2 раза
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  return ctx.reply(
    `❌ <b>Удалить навсегда услугу</b> <code>#${serviceId}</code>?\n\nЭто действие нельзя отменить.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "↩️ Отмена", callback_data: "noop:0" },
            { text: "❌ Удалить навсегда", callback_data: `svc_purge_confirm:${serviceId}` },
          ],
        ],
      },
    }
  );
});


bot.action(/^archive:open$/, async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await renderArchive(ctx);
  } catch (e) {
    console.error("[bot] archive:open error:", e?.message || e);
    return ctx.reply("❌ Не удалось обновить архив.");
  }
});

bot.action(/^archive:item:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const serviceId = Number(ctx.match[1]);

  const chatId = ctx.update?.callback_query?.message?.chat?.id;
  const items = ARCHIVE_ITEMS_BY_CHAT.get(String(chatId)) || [];
  let svc = items.find((x) => Number(x.id) === serviceId);

  if (!svc) {
    try {
      const actorId = getActorId(ctx);
      const { data } = await axios.get(`/api/telegram/provider/${actorId}/services/archive`);
      const freshItems = data?.services || data?.items || [];
      if (Array.isArray(freshItems)) {
        ARCHIVE_ITEMS_BY_CHAT.set(String(chatId), freshItems);
        svc = freshItems.find((x) => Number(x.id) === serviceId);
      }
    } catch (e) {
      console.error("[bot] archive:item refetch error:", e?.response?.data || e?.message || e);
    }
  }

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "♻️ Вернуть в активные", callback_data: `svc_restore_archive:${serviceId}` },
        { text: "⏳ Продлить 7 дней", callback_data: `svc_extend:${serviceId}` },
      ],
      [
        { text: "✏️ Редактировать", callback_data: `svc_edit_start:${serviceId}` },
        { text: "🗑 Удалить", callback_data: `svc_delete:${serviceId}` },
      ],
      [{ text: "⬅️ Назад в архив", callback_data: "archive:open" }],
    ],
  };

  try {
    if (!svc) {
      await ctx.reply(
        `🗄 <b>Архивная услуга</b> <code>#R${serviceId}</code>\n\nНе удалось загрузить подробности, но действия доступны ниже.`,
        { parse_mode: "HTML", reply_markup, disable_web_page_preview: true }
      );
      return;
    }

    const category = svc.category || svc.type || "refused_tour";
    const built = buildServiceMessage(svc, category, "provider", { forceRefused: true });
    const introHtml = buildArchiveItemIntroHtml(svc, serviceId);
    const msg = `${introHtml}\n\n${built.text}`;

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    if (built.photoUrl) {
      const photo = String(built.photoUrl).startsWith("tgfile:")
        ? String(built.photoUrl).replace(/^tgfile:/, "").trim()
        : built.photoUrl;

      await safeReplyWithPhoto(ctx, photo, msg, {
        parse_mode: "HTML",
        reply_markup,
      });
      return;
    }

    await ctx.reply(msg, {
      parse_mode: "HTML",
      reply_markup,
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("[bot] archive:item render error:", e?.response?.data || e?.message || e);
    await ctx.reply(
      `🗄 <b>Архивная услуга</b> <code>#R${serviceId}</code>\n\nЧто сделать?`,
      { parse_mode: "HTML", reply_markup, disable_web_page_preview: true }
    );
  }
});

bot.action(/^trash:open$/, async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await renderTrash(ctx);
  } catch (e) {
    console.error("[bot] trash:open error:", e?.message || e);
    return ctx.reply("❌ Не удалось обновить корзину.");
  }
});

bot.action(/^trash:item:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const serviceId = Number(ctx.match[1]);

  const chatId = ctx.update?.callback_query?.message?.chat?.id;
  const items = TRASH_ITEMS_BY_CHAT.get(String(chatId)) || [];
  const s = items.find((x) => Number(x.id) === serviceId);

  const text = s
    ? buildTrashItemText(s)
    : (`🧺 <b>Выбрана услуга</b>\n\n🧾 <b>ID:</b> <code>#${serviceId}</code>\n\nЧто сделать?`);

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "♻️ Восстановить", callback_data: `trash:restore:${serviceId}` },
        { text: "❌ Удалить навсегда", callback_data: `trash:purge:${serviceId}` },
      ],
      [{ text: "⬅️ Назад", callback_data: "trash:open" }],
    ],
  };

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup });
  } catch (e) {
    console.error("[bot] trash:item edit error:", e?.message || e);
  }
});

bot.action(/^trash:restore:(\d+)$/, async (ctx) => {
  try {
    const serviceId = ctx.match[1];
    await ctx.answerCbQuery("Восстанавливаю...");

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    const actorId = getActorId(ctx);
    const r = await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/restore`
    );

    if (r?.data?.success === true || r?.data?.ok === true) {
      await ctx.reply(`♻️ Услуга <code>#${serviceId}</code> восстановлена.`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🧺 Обновить корзину", callback_data: "trash:open" },
              { text: "📢 Актуальные", callback_data: "prov_services:list_cards" },
            ],
          ],
        },
      });

      await renderTrash(ctx);
      return;
    }

    if (
      (r?.data?.success === false && r?.data?.error === "NOT_DELETED") ||
      (r?.data?.ok === false && r?.data?.reason === "NOT_IN_TRASH")
    ) {
      await ctx.reply(`⚠️ Услуга <code>#${serviceId}</code> уже не в корзине.`, {
        parse_mode: "HTML",
      });
      await renderTrash(ctx);
      return;
    }

    await ctx.reply(`❌ Не удалось восстановить услугу <code>#${serviceId}</code>.`, {
      parse_mode: "HTML",
    });
    return renderTrash(ctx);
  } catch (e) {
    const data = e?.response?.data || {};
    const code = e?.response?.status;

    console.error("[bot] trash:restore error:", data || e?.message || e);

    if (code === 404 || data?.error === "SERVICE_NOT_FOUND") {
      await ctx.reply("⚠️ Услуга не найдена.");
      return renderTrash(ctx);
    }

    if (code === 409 || data?.error === "NOT_DELETED") {
      await ctx.reply("⚠️ Услуга уже восстановлена.");
      return renderTrash(ctx);
    }

    if (
      code === 403 ||
      data?.error === "FORBIDDEN" ||
      data?.error === "PROVIDER_NOT_FOUND"
    ) {
      await ctx.reply("⛔ Нет доступа к этой услуге.");
      return renderTrash(ctx);
    }

    await ctx.reply("❌ Ошибка при восстановлении услуги.");
    return renderTrash(ctx);
  }
});

bot.action(/^trash:purge:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const serviceId = ctx.match[1];

  const text =
    `❌ <b>Удалить навсегда услугу</b> <code>#${serviceId}</code>?\n\n` +
    `Это действие нельзя отменить.`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "↩️ Отмена", callback_data: `trash:item:${serviceId}` },
        { text: "❌ Удалить навсегда", callback_data: `trash:purge_confirm:${serviceId}` },
      ],
      [{ text: "⬅️ В корзину", callback_data: "trash:open" }],
    ],
  };

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup });
  } catch (e) {
    console.error("[bot] trash:purge confirm screen error:", e?.message || e);
  }
});

bot.action(/^trash:purge_confirm:(\d+)$/, async (ctx) => {
  try {
    const serviceId = ctx.match[1];
    await ctx.answerCbQuery("Удаляю навсегда...");

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}

    const actorId = getActorId(ctx);
    const r = await axios.delete(
      `/api/telegram/provider/${actorId}/services/${serviceId}/purge`
    );

    if (r?.data?.success === true || r?.data?.ok === true) {
      await ctx.reply(`🔥 Услуга <code>#${serviceId}</code> удалена навсегда.`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🧺 Обновить корзину", callback_data: "trash:open" }]],
        },
      });

      await renderTrash(ctx);
      return;
    }

    if (
      (r?.data?.success === false && r?.data?.error === "NOT_IN_TRASH") ||
      (r?.data?.ok === false && r?.data?.reason === "NOT_IN_TRASH")
    ) {
      await ctx.reply("⚠️ Услуга уже не находится в корзине.");
      await renderTrash(ctx);
      return;
    }

    await ctx.reply(`❌ Не удалось удалить навсегда <code>#${serviceId}</code>.`, {
      parse_mode: "HTML",
    });
    return renderTrash(ctx);
  } catch (e) {
    const data = e?.response?.data || {};
    const code = e?.response?.status;

    console.error("[bot] trash:purge_confirm error:", data || e?.message || e);

    if (code === 404 || data?.error === "SERVICE_NOT_FOUND") {
      await ctx.reply("⚠️ Услуга не найдена.");
      return renderTrash(ctx);
    }

    if (code === 409 || data?.error === "NOT_IN_TRASH") {
      await ctx.reply("⚠️ Услуга не находится в корзине.");
      return renderTrash(ctx);
    }

    if (code === 409 || data?.error === "FK_CONSTRAINT") {
      await ctx.reply("⚠️ Нельзя удалить навсегда: услуга связана с другими данными.");
      return renderTrash(ctx);
    }

    if (
      code === 403 ||
      data?.error === "FORBIDDEN" ||
      data?.error === "PROVIDER_NOT_FOUND"
    ) {
      await ctx.reply("⛔ Нет доступа к этой услуге.");
      return renderTrash(ctx);
    }

    await ctx.reply("❌ Ошибка при полном удалении услуги.");
    return renderTrash(ctx);
  }
});


// noop (если ещё нет)
bot.action(/^noop:\d+$/, async (ctx) => {
  await ctx.answerCbQuery();
});


/* ===================== PERSISTENT DRAFT ACTIONS ===================== */

bot.action("tg_draft:continue", async (ctx) => {
  try {
    await safeCb(ctx);

    const row = await getActiveProviderServiceDraft(ctx);
    if (!row) {
      await safeReply(ctx, "ℹ️ Активный черновик не найден. Можно начать новую услугу.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
            [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          ],
        },
      });
      return;
    }

    hydrateProviderDraftSession(ctx, row);

    const state = String(ctx.session?.state || "");
    if (state === "svc_create_choose_category" || !ctx.session?.serviceDraft?.category) {
      await safeReply(ctx, "▶️ Продолжаем черновик. Выберите категорию отказной услуги:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📍 Отказной тур", callback_data: "svc_new_cat:refused_tour" }],
            [{ text: "🧭 Авторский тур", callback_data: "svc_new_cat:author_tour" }],
            [{ text: "🏨 Отказной отель", callback_data: "svc_new_cat:refused_hotel" }],
            [{ text: "✈️ Отказной авиабилет", callback_data: "svc_new_cat:refused_flight" }],
            [{ text: "🎫 Отказной билет", callback_data: "svc_new_cat:refused_ticket" }],
            [{ text: "⬅️ Назад", callback_data: "prov_services:list" }],
          ],
        },
      });
      return;
    }

    await safeReply(ctx, "▶️ Продолжаем сохранённый черновик.");
    await promptWizardState(ctx, state);
  } catch (e) {
    console.error("[tg-bot] tg_draft:continue error:", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось открыть черновик. Попробуйте начать создание заново.");
  }
});

bot.action("tg_draft:delete", async (ctx) => {
  try {
    await safeCb(ctx);
    await clearProviderServiceDraft(ctx);
    resetServiceWizard(ctx);
    if (!ctx.session) ctx.session = {};
    ctx.session.__draftRestoreOffered = false;

    await safeReply(ctx, "🗑 Черновик удалён.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] tg_draft:delete error:", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось удалить черновик.");
  }
});

/* ===================== WIZARD: CANCEL/BACK ===================== */

bot.action("svc_wiz:cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await clearProviderServiceDraft(ctx);
    resetServiceWizard(ctx);
    await safeReply(ctx, "❌ Создание услуги отменено.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] svc_wiz:cancel error:", e?.response?.data || e);
  }
});


bot.action(/^svc_urgency:(urgent|soon|normal)$/, async (ctx) => {
  try {
    await safeCb(ctx, "Срочность сохранена");
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
    const value = String(ctx.match[1] || "normal");
    ctx.session.serviceDraft.urgency = value;
    pushWizardState(ctx, "svc_create_urgency");
    ctx.session.state = "svc_create_expiration";
    await safeReply(ctx, `${urgencyLabel(value)}\n\nПереходим к сроку актуальности.`);
    await promptWizardState(ctx, "svc_create_expiration");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[tg-bot] svc_urgency error:", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось сохранить срочность. Попробуйте ещё раз.");
  }
});

bot.action("svc_wiz:back", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const cur = ctx.session?.state || null;
    if (
          !cur ||
          !(
            String(cur).startsWith("svc_create_") ||
            String(cur).startsWith("svc_hotel_") ||
            String(cur).startsWith("svc_author_") ||
            String(cur).startsWith("author_stay_") ||
            String(cur).startsWith("author_day_") ||
            String(cur).startsWith("author_included_") ||
            state.startsWith("author_excluded_") ||
            state.startsWith("author_language_")
          )
        )
      return;

    if (String(cur).startsWith("author_day_")) {
      const localBackMap = {
        author_day_date: "svc_author_program_days",
        author_day_route: "author_day_date",
        author_day_title: "author_day_route",
        author_day_items: "author_day_title",
      };

      const prevLocal = localBackMap[String(cur)] || "svc_author_program_days";

      if (cur === "author_day_date") {
        delete ctx.session.serviceDraft?._programDayDate;
        delete ctx.session.serviceDraft?._programDayRoute;
        delete ctx.session.serviceDraft?._programDayTitle;
      } else if (cur === "author_day_route") {
        delete ctx.session.serviceDraft?._programDayRoute;
        delete ctx.session.serviceDraft?._programDayTitle;
      } else if (cur === "author_day_title") {
        delete ctx.session.serviceDraft?._programDayTitle;
      }

      ctx.session.state = prevLocal;
      await promptWizardState(ctx, prevLocal);
      await persistProviderCreateWizard(ctx);
      return;
    }

    if (cur === "author_included_custom") {
      ctx.session.state = "svc_author_included";
      await promptWizardState(ctx, "svc_author_included");
      await persistProviderCreateWizard(ctx);
      return;
    }

    if (cur === "author_excluded_custom") {
      ctx.session.state = "svc_author_not_included";
      await promptWizardState(ctx, "svc_author_not_included");
      await persistProviderCreateWizard(ctx);
      return;
    }

    const stack = ctx.session?.wizardStack || [];
    const prev = stack.length ? stack.pop() : null;

    if (!prev) {
      resetServiceWizard(ctx);
      await safeReply(ctx, "⬅️ Возвращаюсь в меню.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
            [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
            [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
          ],
        },
      });
      return;
    }

    ctx.session.state = prev;
    await promptWizardState(ctx, prev);
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[tg-bot] svc_wiz:back error:", e?.response?.data || e);
  }
});

// ⏭ Пропустить шаг при СОЗДАНИИ услуги.
// Важно: пропуск разрешён только для опциональных полей.
bot.action("svc_wiz:skip", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const state = String(ctx.session?.state || "");
    const draft = ctx.session?.serviceDraft;
    if (!state || !draft) {
      await safeReply(ctx, "⚠️ Нечего пропускать. Начните создание услуги заново.");
      return;
    }

    const category = String(draft.category || "");
    const isEditFlow = !!ctx.session?.editingServiceId || !!draft?.id;

    const tourOrder = [
      "svc_create_title",
      "svc_create_tour_country",
      "svc_create_tour_from",
      "svc_create_tour_to",
      "svc_create_tour_start",
      "svc_create_tour_end",
      "svc_create_flight_departure",
      "svc_create_flight_return",
      "svc_create_flight_details",
      "svc_create_tour_hotel",
      "svc_create_tour_accommodation",
      "svc_create_tour_roomcat",   
      "svc_create_tour_food",   
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const hotelOrder = [
      "svc_hotel_country",
      "svc_hotel_city",
      "svc_hotel_name",
      "svc_hotel_checkin",
      "svc_hotel_checkout",
      "svc_hotel_roomcat",
      "svc_hotel_accommodation",
      "svc_hotel_food",
      "svc_hotel_halal",
      "svc_hotel_transfer",
      "svc_hotel_changeable",
      "svc_hotel_pax",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const flightOrder = [
      "svc_create_title",
      "svc_create_tour_country",
      "svc_create_tour_from",
      "svc_create_tour_to",
      "svc_create_flight_departure",
      "svc_create_flight_return",
      "svc_create_flight_details",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const ticketOrder = [
      "svc_create_title",
      "svc_create_tour_country",
      "svc_create_tour_from",
      "svc_create_tour_to",
      "svc_ticket_event_date",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const authorOrder = [
      "svc_author_title",
      "svc_author_country",
      "svc_author_from",
      "svc_author_to",
      "svc_author_start",
      "svc_author_end",
      "svc_author_format",
      "svc_author_stays",
      "svc_author_program_days",
      "svc_author_included",
      "svc_author_not_included",
      "svc_author_pax",
      "svc_author_language",
      "svc_author_meeting",
      "svc_author_cancel",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const isAuthorFlow = category === "author_tour" || state.startsWith("svc_author_");
    const isHotelFlow = category === "refused_hotel" || state.startsWith("svc_hotel_");
    const isFlightFlow = category === "refused_flight";
    const isTicketFlow = category === "refused_ticket" || category === "refused_event_ticket" || state === "svc_ticket_event_date";
    const order = isAuthorFlow ? authorOrder : (isTicketFlow ? ticketOrder : (isFlightFlow ? flightOrder : (isHotelFlow ? hotelOrder : tourOrder)));

    // какие шаги реально можно пропустить кнопкой
    const optional = new Set([
      "svc_author_title",
      "svc_author_not_included",
      "svc_author_cancel",
      "author_day_date",
      "author_day_route",
      "author_day_title",
      "svc_create_flight_departure",
      "svc_create_flight_return",
      "svc_create_flight_details",
      "svc_create_tour_roomcat",
      "svc_create_tour_food",
      "svc_create_grossPrice",
      "svc_create_urgency",
      "svc_create_expiration", // можно поставить "нет" (кнопка = быстрый переход)
      "svc_create_photo",
    ]);

    // При создании часть шагов обязательная.
    // При редактировании кнопка «Пропустить» означает «оставить сохранённое значение»
    // и всегда должна переводить на следующий шаг.
    if (!isEditFlow && !optional.has(state)) {
      await safeReply(ctx, "⚠️ Этот шаг обязателен — его нельзя пропустить.", wizNavKeyboard());
      return;
    }

    // Спец-логика для создания: пропуск записывает дефолт/пустое значение.
    // В режиме редактирования ничего не очищаем — сохраняем текущее значение из услуги.
    if (!isEditFlow) {
      if (state === "author_day_date") {
        draft._programDayDate = "";
      }
      if (state === "author_day_route") {
        draft._programDayRoute = "";
      }
      if (state === "author_day_title") {
        draft._programDayTitle = "";
      }
      if (state === "svc_author_not_included") {
        draft.notIncluded = [];
      }

      if (state === "svc_create_grossPrice") {
        draft.grossPrice = null;
      }
      if (state === "svc_create_urgency") {
        draft.urgency = "normal";
      }
      if (state === "svc_create_expiration") {
        draft.expiration = null;
      }
      if (state === "svc_create_flight_departure") {
        draft.departureFlightDate = null;
      }
      if (state === "svc_create_flight_return") {
        draft.returnFlightDate = null;
      }
      if (state === "svc_create_flight_details") {
        draft.flightDetails = null;
      }
    }

    // Иногда пользователи нажимают кнопку «Пропустить» под старым сообщением,
    // когда ctx.session.state уже успел измениться. Чтобы не получать
    // «Уже нечего пропускать», делаем явные переходы для optional-шагов.
  const forcedNext =
    state === "author_day_date"
      ? "author_day_route"
      : state === "author_day_route"
        ? "author_day_title"
        : state === "author_day_title"
          ? "author_day_items"
          : state === "svc_author_title"
      ? "svc_author_country"
      : state === "svc_author_not_included"
        ? "svc_author_pax"
        : state === "svc_author_cancel"
          ? "svc_create_price"
          : state === "svc_create_flight_departure"
      ? "svc_create_flight_return"
      : state === "svc_create_flight_return"
        ? "svc_create_flight_details"
        : state === "svc_create_flight_details"
          ? (category === "refused_flight" ? "svc_create_price" : "svc_create_tour_hotel")
          : state === "svc_create_grossPrice"
            ? "svc_create_urgency"
            : state === "svc_create_urgency"
              ? "svc_create_expiration"
              : state === "svc_create_expiration"
                ? "svc_create_photo"
              : null;

    const idx = order.indexOf(state);
    const nextState = forcedNext || (idx >= 0 ? order[idx + 1] : null);

    // Если пропускаем фото — финализируем.
    // В создании очищаем фото, в редактировании оставляем уже сохранённые фото.
    if (state === "svc_create_photo") {
      if (isEditFlow) {
        await finishEditWizard(ctx);
      } else {
        draft.images = [];
        draft.telegramPhotoFileId = null;
        await finishCreateServiceFromWizard(ctx);
      }
      return;
    }

    if (!nextState) {
      await safeReply(ctx, "⚠️ Уже нечего пропускать на этом шаге.");
      return;
    }

    pushWizardState(ctx, state);
    ctx.session.state = nextState;
    await promptWizardState(ctx, nextState);
    if (!isEditFlow) {
      await persistProviderCreateWizard(ctx);
    }
  } catch (e) {
    console.error("[tg-bot] svc_wiz:skip error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Ошибка при пропуске. Попробуйте ещё раз.");
  }
});

/* ===================== CREATE: choose category ===================== */

bot.action(
  /^svc_new_cat:(refused_tour|author_tour|refused_hotel|refused_flight|refused_ticket|refused_event_ticket)$/,
  async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const category = ctx.match[1];

      if (!ctx.session) ctx.session = {};
      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      ctx.session.serviceDraft.category = category;

      await trackProviderFunnelFromBot(ctx, "wizard_started", {
        category,
        step: "choose_category",
      });

      // ✅ Разрешаем создание через бот только для: tour, hotel, flight
      if (
        category !== "refused_tour" &&
        category !== "author_tour" &&
        category !== "refused_hotel" &&
        category !== "refused_flight" &&
        category !== "refused_ticket" &&
        category !== "refused_event_ticket"
      ) {
        await ctx.reply(
          "⚠️ Создание через бот доступно для отказного тура, авторского тура, отеля, авиабилета и билета на мероприятие.\n\n" +
            "Для остальных категорий используйте личный кабинет:\n" +
            `${SITE_URL}`
        );
        resetServiceWizard(ctx);
        return;
      }

      // старт мастера (очищаем историю шагов)
      ctx.session.wizardStack = [];

      // author_tour — отдельный поток без обязательного отеля/рейса/proof
      if (category === "author_tour") {
        ctx.session.state = "svc_author_title";
        await promptWizardState(ctx, "svc_author_title");
        await persistProviderCreateWizard(ctx);
        return;
      }

      // refused_hotel — отдельный поток
      if (category === "refused_hotel") {
        ctx.session.state = "svc_hotel_country";
        await promptWizardState(ctx, "svc_hotel_country");
        await persistProviderCreateWizard(ctx);
        return;
      }

      // refused_tour и refused_flight начинаем одинаково (с title)
      ctx.session.state = "svc_create_title";
      await promptWizardState(ctx, "svc_create_title");
      await persistProviderCreateWizard(ctx);
    } catch (e) {
      console.error("[tg-bot] svc_new_cat action error:", e);
    }
  }
);


/* ===================== QUICK REQUEST ===================== */

bot.action(/^request:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingRequestServiceId = serviceId;
    ctx.session.pendingRequestSource = "inline";
    ctx.session.state = "awaiting_request_message";

    await ctx.answerCbQuery();

    await safeReply(
      ctx,
      "📩 *Быстрый запрос*\n\nНапишите сообщение по услуге:\n• пожелания\n• даты\n• количество человек\n\n" +
        "Если контактный номер отличается от Telegram — добавьте его в сообщение.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] request action error:", e);
  }
});

/* ===================== REQUEST STATUS (manager buttons) ===================== */
bot.action(/^reqst:(\d+):(new|accepted|booked|rejected)$/, async (ctx) => {
  try {
    const requestId = Number(ctx.match[1]);

    if (!(await isRequestOperatorChat(ctx, requestId))) {
      await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
      return;
    }

    const status = String(ctx.match[2]);
    const statusLabel = statusLabelForManager(status);

    const ok = await updateReqStatus(requestId, status);
    if (!ok) {
      await ctx.answerCbQuery("⚠️ Не удалось обновить статус", { show_alert: true });
      return;
    }

    await ctx.answerCbQuery(statusLabel);

    // 🔁 Обновляем текст сообщения (показываем новый статус)
    try {
      const currentText = ctx.update.callback_query.message.text;
      const updatedText = replaceStatusLine(currentText, statusLabel);
      await ctx.editMessageText(updatedText, { parse_mode: "Markdown" });
    } catch (_) {}

    // ❌ Убираем кнопки, чтобы не нажимали повторно
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
  } catch (e) {
    console.error("[tg-bot] reqst action error:", e);
    try {
      await ctx.answerCbQuery("Ошибка", { show_alert: true });
    } catch {}
  }
});

bot.action(/^reqreply:(\d+)$/, async (ctx) => {
  try {
    const requestId = Number(ctx.match[1]);

    if (!(await isRequestOperatorChat(ctx, requestId))) {
      await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
      return;
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.state = "awaiting_operator_reply";
    ctx.session.operatorReplyRequestId = requestId;

    await ctx.answerCbQuery("✍️ Напишите ответ текстом");

    await ctx.reply(
      `✍️ Ответ по заявке #${requestId}\n\n` +
      `Отправьте одним сообщением текст, который нужно переслать клиенту.`
    );
  } catch (e) {
    console.error("[tg-bot] reqreply action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});

bot.action(/^reqadd:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const requestId = Number(ctx.match[1]);
    if (!requestId) {
      await safeReply(ctx, "⚠️ Некорректный ID заявки.");
      return;
    }

    const req = await getReqById(requestId);
    if (!req) {
      await safeReply(ctx, "⚠️ Заявка не найдена (или БД недоступна).");
      return;
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.state = "awaiting_request_add";
    ctx.session.activeRequestId = requestId;
    ctx.session.pendingAddRequestId = null;

    await safeReply(
      ctx,
      `💬 Дополнение к заявке #${requestId}\n\nНапишите сообщение — я отправлю владельцу услуги.`
    );
  } catch (e) {
    console.error("[tg-bot] reqadd action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});

bot.action(/^reqhist:(\d+)$/, async (ctx) => {
  try {
    const requestId = Number(ctx.match[1]);

    if (!(await isRequestOperatorChat(ctx, requestId))) {
      await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
      return;
    }

    const req = await getReqById(requestId);
    if (!req) {
      await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });
      return;
    }

    const msgs = await getReqMessages(requestId, 30);

    const header =
      `📜 *История по заявке #${requestId}*\n` +
      `Услуга ID: *${escapeMarkdown(String(req.service_id))}*\n` +
      `Статус: ${statusLabelForManager(req.status || "new")}\n`;

    if (!msgs.length) {
      await ctx.answerCbQuery();
      await ctx.reply(header + "\n\n(сообщений пока нет)", { parse_mode: "Markdown" });
      return;
    }

    const lines = msgs.map((m) => {
      const role =
      m.sender_role === "operator" ? "🧑‍💼 Оператор" :
      m.sender_role === "manager" ? "🧑‍💼 Менеджер" :
      "👤 Клиент";
      const when = formatTashkentTime(m.created_at);
      const txt = escapeMarkdown(String(m.text || ""));
      const whenLine = when ? `_${escapeMarkdown(when)}_` : "";
      return `*${role}* ${whenLine}\n${txt}`;
    });

    let body = lines.join("\n\n");
    const maxLen = 3500;
    if (body.length > maxLen) body = body.slice(body.length - maxLen);

    await ctx.answerCbQuery();
    await ctx.reply(header + "\n\n" + body, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("[tg-bot] reqhist action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});

/* ===================== FLIGHT DETAILS (popup) ===================== */
bot.action(/^fd:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match?.[1]);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await ctx.answerCbQuery("⚠️ Некорректная кнопка", { show_alert: true });
      return;
    }

    // ⚠️ используем ту же функцию, которой ты уже получаешь услугу по id в этом файле
    // (если у тебя она называется иначе — просто подставь существующее имя функции)
    const svc = await fetchTelegramService(serviceId);

    if (!svc) {
      await ctx.answerCbQuery("⚠️ Услуга не найдена", { show_alert: true });
      return;
    }

    const d = parseDetailsAny(svc.details);
    const raw = String(d.flightDetails || "").trim();

    if (!raw) {
      await ctx.answerCbQuery("ℹ️ Детали рейса не указаны", { show_alert: true });
      return;
    }

    // лимит alert — страхуемся
    const msg = raw.length > 3500 ? raw.slice(0, 3500) + "…" : raw;
    await ctx.answerCbQuery(msg, { show_alert: true });
  } catch {
    try {
      await ctx.answerCbQuery("⚠️ Ошибка", { show_alert: true });
    } catch {}
  }
});

/* ===================== AUTHOR TOUR PROGRAM (popup/message) ===================== */
bot.action(/^atp:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match?.[1]);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await ctx.answerCbQuery("⚠️ Некорректная кнопка", { show_alert: true });
      return;
    }

    const userChatId = Number(ctx.from?.id || ctx.chat?.id || 0);
    if (!Number.isFinite(userChatId) || userChatId <= 0) {
      await ctx.answerCbQuery("⚠️ Не удалось определить чат", { show_alert: true });
      return;
    }

    const svc = await fetchTelegramService(serviceId, "client");
    if (!svc) {
      await ctx.answerCbQuery("⚠️ Тур не найден", { show_alert: true });
      return;
    }

    const d = parseDetailsAny(svc.details);

    const escapeHtmlLocal = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const normalizeProgramText = (value) =>
      String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\s*[⸻━]{2,}\s*/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\s*(?=(?:🗓\s*)?(?:ДЕНЬ|DAY)\s*\d+)/giu, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const stripCommercialTail = (value) =>
      String(value || "")
        .replace(/\s*(?:Цена\s+указана|Стоимость\s+указана)[\s\S]*$/i, "")
        .replace(/\s*(?:Для\s+бронирования|Для\s+брони|Бронирование|Обращайтесь)[\s\S]*$/i, "")
        .replace(/\s*(?:@\w{4,}|https?:\/\/\S+|\+?\d[\d\s().-]{7,})[\s\S]*$/i, "")
        .trim();

    const formatStayLine = (stay) => {
      if (!stay || typeof stay !== "object") return "";
      const hotel = String(stay.hotel || stay.name || stay.hotelName || "").trim();
      if (!hotel) return "";
      const city = String(stay.city || stay.location || "").trim();
      const nights = pluralRuNightsBot(stay.nights || stay.days || stay.nightCount || "");
      return [hotel, nights, city].filter(Boolean).join(" — ");
    };

    const formatStructuredProgramDays = (programDays) => {
      if (!Array.isArray(programDays) || !programDays.length) return "";

      return programDays
        .map((day, idx) => {
          if (!day || typeof day !== "object") return "";
          const dayNum = day.day || day.number || idx + 1;
          const dateLabel = day.dateLabel || day.date || "";
          const title = day.title || day.route || day.name || "";
          const text = String(day.text || day.description || day.body || "").trim();
          const stayLine = formatStayLine(day.stay);

          const lines = [];
          lines.push(`📍 <b>День ${escapeHtmlLocal(dayNum)}${dateLabel ? ` — ${escapeHtmlLocal(dateLabel)}` : ""}</b>`);
          if (title) lines.push(`🧭 <b>${escapeHtmlLocal(title)}</b>`);
          if (text) {
            const activityLines = text
              .split(/\n+/g)
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => `• ${escapeHtmlLocal(x)}`);
            lines.push(...activityLines);
          }
          if (stayLine) lines.push(`🏨 ${escapeHtmlLocal(stayLine)}`);
          return lines.join("\n");
        })
        .filter(Boolean)
        .join("\n\n");
    };

    const prettifyDayBody = (value) => {
      const s = String(value || "")
        .replace(/\s+/g, " ")
        .replace(/\s+(?=(?:✈️?|🕒|🏨|🚐|🌊|🎢|⛰|🍃|🛍|🕳|🌉|🏞|🛳|☕|🛫|🛬|🚌|🚗|📍))/gu, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();

      return s
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `• ${escapeHtmlLocal(line)}`)
        .join("\n");
    };

    const formatLegacyProgram = (value) => {
      const cleaned = stripCommercialTail(normalizeProgramText(value));
      if (!cleaned) return "";

      const dayRegex = /(?:🗓\s*)?(?:ДЕНЬ|DAY)\s*(\d+)\s*(?:\|\s*([^\n]+))?/giu;
      const matches = [];
      let m;

      while ((m = dayRegex.exec(cleaned))) {
        matches.push({ index: m.index, end: dayRegex.lastIndex, number: m[1], date: String(m[2] || "").trim() });
      }

      if (!matches.length) return prettifyDayBody(cleaned);

      const sections = [];
      for (let i = 0; i < matches.length; i += 1) {
        const cur = matches[i];
        const next = matches[i + 1];
        const bodyRaw = cleaned
          .slice(cur.end, next ? next.index : cleaned.length)
          .replace(/^\s*[—–-]+\s*/g, "")
          .trim();
        const body = prettifyDayBody(bodyRaw);
        const datePart = cur.date ? ` — ${cur.date}` : "";
        sections.push(`📍 <b>День ${escapeHtmlLocal(cur.number)}${escapeHtmlLocal(datePart)}</b>${body ? `\n${body}` : ""}`);
      }

      return sections.join("\n\n");
    };

    const rawProgram = String(
      d.program ||
        d.tourProgram ||
        d.programText ||
        d.itinerary ||
        d.routeProgram ||
        ""
    ).trim();

    const formattedProgram = formatStructuredProgramDays(d.programDays) || formatLegacyProgram(rawProgram);

    if (!formattedProgram) {
      await ctx.answerCbQuery("ℹ️ Программа тура не указана", { show_alert: true });
      return;
    }

    await ctx.answerCbQuery("🗓 Отправляю программу тура");

    const title = String(svc.title || d.title || "Авторский тур").trim();
    const header =
      `🗓 <b>Программа тура</b> <code>#R${serviceId}</code>\n` +
      `🧭 <b>${escapeHtmlLocal(title)}</b>`;

    const splitHtmlMessages = (body, maxLen = 3600) => {
      const blocks = String(body || "").split(/\n{2,}/g).filter(Boolean);
      const chunks = [];
      let current = header;

      for (const block of blocks) {
        const candidate = `${current}\n\n${block}`;
        if (candidate.length <= maxLen) {
          current = candidate;
          continue;
        }
        if (current && current !== header) chunks.push(current.trim());
        current = `${header}\n\n${block}`;
      }

      if (current.trim()) chunks.push(current.trim());
      return chunks.length ? chunks.slice(0, 6) : [header];
    };

    const chunks = splitHtmlMessages(formattedProgram, 3600);
    for (let i = 0; i < chunks.length; i += 1) {
      const suffix = chunks.length > 1 ? `\n\n<i>Часть ${i + 1}/${chunks.length}</i>` : "";
      await bot.telegram.sendMessage(userChatId, `${chunks[i]}${suffix}`, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    console.error("[tg-bot] author tour program action error:", e?.message || e);

    const desc = String(e?.response?.description || e?.description || e?.message || "");
    if (/bot was blocked|chat not found|user is deactivated|forbidden/i.test(desc)) {
      try {
        await ctx.answerCbQuery("Откройте личный чат с ботом и нажмите Start", { show_alert: true });
      } catch {}
      return;
    }

    try { await ctx.answerCbQuery("⚠️ Ошибка", { show_alert: true }); } catch {}
  }
});

bot.action(/^author_fmt:(group|private|custom)$/, async (ctx) => {
  try {
    const mode = ctx.match[1];

    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    ctx.session.serviceDraft.tourFormat = mode;

    pushWizardState(ctx, "svc_author_format");

    ctx.session.state = "svc_author_stays";

    await safeCb(ctx);

    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [],
      });
    } catch {}

    await promptWizardState(ctx, "svc_author_stays");

  } catch (e) {
    console.error("[author_fmt]", e);
  }
});

bot.action("author_stay:add", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    pushWizardState(ctx, "svc_author_stays");
    ctx.session.state = "author_stay_city";
    
    await persistProviderCreateWizard(ctx);
    
    await safeCb(ctx);

    await ctx.reply(
      "🌍 Укажите город проживания\n\nНапример:\nUzungol"
    );
  } catch (e) {
    console.error("[author_stay:add]", e);
  }
});

bot.action("author_stay:done", async (ctx) => {
  try {
    if (!ctx.session?.serviceDraft) return;

    const stays = ctx.session.serviceDraft.stays || [];

    if (!stays.length) {
      await ctx.answerCbQuery(
        "Добавьте хотя бы одно проживание",
        { show_alert: true }
      );
      return;
    }

    pushWizardState(ctx, "svc_author_stays");

    ctx.session.state = "svc_author_program_days";

    await persistProviderCreateWizard(ctx);

    await safeCb(ctx);

    await promptWizardState(
      ctx,
      "svc_author_program_days"
    );

  } catch (e) {
    console.error("[author_stay:done]", e);
  }
});


bot.action("author_day:add", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    pushWizardState(ctx, "svc_author_program_days");
    ctx.session.state = "author_day_date";

    await persistProviderCreateWizard(ctx);

    await safeCb(ctx);

    await promptWizardState(ctx, "author_day_date");
  } catch (e) {
    console.error("[author_day:add]", e);
  }
});

bot.action("author_day:done", async (ctx) => {
  try {
    if (!ctx.session?.serviceDraft) return;

    const programDays = ctx.session.serviceDraft.programDays || [];

    if (!programDays.length) {
      await ctx.answerCbQuery(
        "Добавьте хотя бы один день программы",
        { show_alert: true }
      );
      return;
    }

    pushWizardState(ctx, "svc_author_program_days");

    ctx.session.state = "svc_author_included";
    
    await persistProviderCreateWizard(ctx);

    await safeCb(ctx);

    await promptWizardState(ctx, "svc_author_included");
  } catch (e) {
    console.error("[author_day:done]", e);
  }
});


bot.action(/^author_included:toggle:([a-z0-9_]+)$/, async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    const key = String(ctx.match?.[1] || "");
    const preset = authorPresetByKey("included", key);
    if (!preset) {
      await ctx.answerCbQuery("⚠️ Неизвестный пункт", { show_alert: true });
      return;
    }

    ctx.session.serviceDraft.included = toggleAuthorListItem(
      ctx.session.serviceDraft.included,
      preset.label
    );
    ctx.session.state = "svc_author_included";

    await safeCb(ctx);

    try {
      await ctx.editMessageText(
        `✅ Что включено в стоимость?\n\nВыбрано:\n${formatAuthorListPreview(ctx.session.serviceDraft.included)}`,
        {
          reply_markup: {
            inline_keyboard: buildAuthorIncludedKeyboard(ctx.session.serviceDraft.included),
          },
        }
      );
    } catch {
      await replyAuthorIncludedBuilder(ctx);
    }

    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_included:toggle]", e);
  }
});

bot.action("author_included:custom", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    ctx.session.state = "author_included_custom";

    await safeCb(ctx);
    await promptWizardState(ctx, "author_included_custom");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_included:custom]", e);
  }
});

bot.action("author_included:done", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    const included = normalizeAuthorList(ctx.session.serviceDraft.included);

    if (!included.length) {
      await ctx.answerCbQuery("Добавьте хотя бы один пункт", { show_alert: true });
      return;
    }

    ctx.session.serviceDraft.included = included;

    pushWizardState(ctx, "svc_author_included");
    ctx.session.state = "svc_author_not_included";

    await safeCb(ctx);
    await promptWizardState(ctx, "svc_author_not_included");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_included:done]", e);
  }
});



async function applyWizardBooleanChoice(ctx, value) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
  const draft = ctx.session.serviceDraft;
  const state = String(ctx.session.state || "");

  const move = async (field, nextState) => {
    draft[field] = value;
    pushWizardState(ctx, state);
    ctx.session.state = nextState;
    await safeCb(ctx, value ? "Да" : "Нет");
    await promptWizardState(ctx, nextState);
    await persistProviderCreateWizard(ctx);
  };

  switch (state) {
    case "svc_create_tour_insurance":
      return move("insuranceIncluded", "svc_create_tour_early_checkin");
    case "svc_create_tour_early_checkin":
      return move("earlyCheckIn", "svc_create_tour_fast_track");
    case "svc_create_tour_fast_track":
      return move("arrivalFastTrack", "svc_create_price");
    case "svc_hotel_halal":
      return move("halal", "svc_hotel_transfer");
    case "svc_hotel_changeable":
      return move("changeable", "svc_hotel_pax");
    case "svc_hotel_insurance":
      return move("insuranceIncluded", "svc_hotel_early_checkin");
    case "svc_hotel_early_checkin":
      return move("earlyCheckIn", "svc_hotel_fast_track");
    case "svc_hotel_fast_track":
      return move("arrivalFastTrack", "svc_create_price");
    default:
      await safeCb(ctx, "Этот шаг не ожидает Да/Нет", true);
  }
}

bot.action(/^wiz_bool:(yes|no)$/, async (ctx) => {
  try {
    await applyWizardBooleanChoice(ctx, ctx.match[1] === "yes");
  } catch (e) {
    console.error("[wiz_bool]", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось сохранить выбор. Попробуйте ещё раз.");
  }
});


bot.action("cal:noop", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
});

bot.action(/^cal:nav:([^:]+):(\d{4}):(\d{2})$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const state = String(ctx.match?.[1] || "");
    const year = Number(ctx.match?.[2]);
    const month = Number(ctx.match?.[3]);
    const draft = getDraftForCalendar(ctx);
    const current = getCurrentCalendarValue(draft, state);

    await ctx.editMessageReplyMarkup(
      buildCalendarKeyboard(state, year, Math.max(0, Math.min(11, month - 1)), current)
    );
  } catch (e) {
    console.error("[calendar nav]", e?.message || e);
  }
});

bot.action(/^cal:manual:([^:]+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Ручной ввод");
    const state = String(ctx.match?.[1] || "");
    if (!ctx.session) ctx.session = {};
    ctx.session.state = state;
    await ctx.reply(calendarManualText(state), { ...wizNavKeyboard() });
  } catch (e) {
    console.error("[calendar manual]", e?.message || e);
  }
});

bot.action(/^cal:none:([^:]+)$/, async (ctx) => {
  try {
    const state = String(ctx.match?.[1] || "");
    const draft = getDraftForCalendar(ctx);

    if (state === "svc_create_expiration") {
      draft.expiration = null;
      ctx.session.serviceDraft = draft;
      await safeCb(ctx, "Без срока актуальности");
      await advanceAfterCalendarDate(ctx, state);
      return;
    }

    if (state === "author_day_date") {
      draft._programDayDate = "";
      ctx.session.serviceDraft = draft;
      await safeCb(ctx, "Дата не указана");
      await advanceAfterCalendarDate(ctx, state);
      return;
    }

    await safeCb(ctx, "Этот шаг нельзя очистить", true);
  } catch (e) {
    console.error("[calendar none]", e?.message || e);
  }
});

bot.action(/^cal:date:([^:]+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  try {
    const state = String(ctx.match?.[1] || "");
    const ymd = String(ctx.match?.[2] || "");

    if (state === "svc_create_expiration") {
      await safeCb(ctx, "Выберите время");
      await replyExpirationTimePicker(ctx, state, ymd);
      return;
    }

    await handleCalendarApply(ctx, state, ymd);
  } catch (e) {
    console.error("[calendar date]", e?.message || e);
  }
});

bot.action(/^cal:time:([^:]+):(\d{4}-\d{2}-\d{2}):(\d{4})$/, async (ctx) => {
  try {
    const state = String(ctx.match?.[1] || "");
    const ymd = String(ctx.match?.[2] || "");
    const hhmm = normalizeTimeHHMM(ctx.match?.[3]);
    if (!hhmm) {
      await safeCb(ctx, "Некорректное время", true);
      return;
    }
    await handleCalendarApply(ctx, state, `${ymd} ${hhmm}`);
  } catch (e) {
    console.error("[calendar time]", e?.message || e);
  }
});

bot.action(/^(svc_photo|author_photo):clear$/, async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
    ctx.session.serviceDraft.images = [];
    ctx.session.serviceDraft.telegramPhotoFileId = null;
    await safeCb(ctx, "Фото очищены");
    await promptWizardState(ctx, "svc_create_photo");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[svc_photo clear]", e?.message || e);
  }
});

bot.action(/^(svc_photo|author_photo):done$/, async (ctx) => {
  try {
    await safeCb(ctx, "Готово");
    const draft = ctx.session?.serviceDraft;
    const isEditFlow = !!ctx.session?.editingServiceId || !!draft?.id;
    if (isEditFlow) {
      await finishEditWizard(ctx);
    } else {
      await finishCreateServiceFromWizard(ctx);
    }
  } catch (e) {
    console.error("[svc_photo done]", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось завершить сохранение. Попробуйте ещё раз.");
  }
});


bot.action(/^author_lang:(.+)$/, async (ctx) => {
  try {
    const value = String(ctx.match?.[1] || "");

    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    const draft = ctx.session.serviceDraft;

    if (value === "done") {
      pushWizardState(ctx, "svc_author_language");
      ctx.session.state = "svc_author_meeting";
      await safeCb(ctx, "Продолжаем");
      await promptWizardState(ctx, "svc_author_meeting");
      await persistProviderCreateWizard(ctx);
      return;
    }

    if (value === "custom") {
      ctx.session.state = "author_language_custom";
      await safeCb(ctx);
      await ctx.reply(
        "🗣 Введите язык гида\n\nНапример:\nТурецкий",
        { ...wizNavKeyboard() }
      );
      await persistProviderCreateWizard(ctx);
      return;
    }

    const map = {
      uz: "Узбекский",
      ru: "Русский",
      en: "Английский",
    };

    const lang = map[value];
    if (!lang) {
      await safeCb(ctx, "⚠️ Неизвестный язык", true);
      return;
    }

    draft.languages = Array.isArray(draft.languages) ? draft.languages : [];

    if (draft.languages.includes(lang)) {
      draft.languages = draft.languages.filter((x) => x !== lang);
    } else {
      draft.languages.push(lang);
    }

    draft.guideLanguage = draft.languages.join(", ");
    draft.language = draft.guideLanguage;

    ctx.session.serviceDraft = draft;
    ctx.session.state = "svc_author_language";

    await safeCb(ctx, draft.languages.length ? `Языки: ${draft.languages.join(", ")}` : "Языки не выбраны");

    try {
      const selected = draft.languages;
      const has = (name) => selected.includes(name);

      await ctx.editMessageText(
        "🗣 Укажите язык гида\n\nМожно выбрать несколько языков, затем нажмите ✅ Продолжить.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: `${has("Узбекский") ? "✅" : "☐"} 🇺🇿 УЗБ`, callback_data: "author_lang:uz" },
                { text: `${has("Русский") ? "✅" : "☐"} 🇷🇺 РУС`, callback_data: "author_lang:ru" },
              ],
              [
                { text: `${has("Английский") ? "✅" : "☐"} 🇬🇧 АНГ`, callback_data: "author_lang:en" },
              ],
              [{ text: "➕ Свой вариант", callback_data: "author_lang:custom" }],
              [{ text: "✅ Продолжить", callback_data: "author_lang:done" }],
              [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
              [
                { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
              ],
            ],
          },
        }
      );
    } catch {
      await promptWizardState(ctx, "svc_author_language");
    }

    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_lang]", e);
  }
});

bot.action(/^author_excluded:toggle:([a-z0-9_]+)$/, async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    const key = String(ctx.match?.[1] || "");
    const preset = authorPresetByKey("excluded", key);
    if (!preset) {
      await ctx.answerCbQuery("⚠️ Неизвестный пункт", { show_alert: true });
      return;
    }

    ctx.session.serviceDraft.notIncluded = toggleAuthorListItem(
      ctx.session.serviceDraft.notIncluded,
      preset.label
    );
    ctx.session.state = "svc_author_not_included";

    await safeCb(ctx);

    try {
      await ctx.editMessageText(
        `➖ Что не включено?\n\nВыбрано:\n${formatAuthorListPreview(ctx.session.serviceDraft.notIncluded)}`,
        {
          reply_markup: {
            inline_keyboard: buildAuthorExcludedKeyboard(ctx.session.serviceDraft.notIncluded),
          },
        }
      );
    } catch {
      await replyAuthorExcludedBuilder(ctx);
    }

    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_excluded:toggle]", e);
  }
});

bot.action("author_excluded:custom", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    ctx.session.state = "author_excluded_custom";

    await safeCb(ctx);
    await promptWizardState(ctx, "author_excluded_custom");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_excluded:custom]", e);
  }
});

bot.action("author_excluded:done", async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};

    ctx.session.serviceDraft.notIncluded = normalizeAuthorList(ctx.session.serviceDraft.notIncluded);

    pushWizardState(ctx, "svc_author_not_included");
    ctx.session.state = "svc_author_pax";

    await safeCb(ctx);
    await promptWizardState(ctx, "svc_author_pax");
    await persistProviderCreateWizard(ctx);
  } catch (e) {
    console.error("[author_excluded:done]", e);
  }
});


// ✅ Alias для кнопок из deep-link карточек (refused_<id>), где callback_data = quick:<id>
bot.action(/^quick:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingRequestServiceId = serviceId;
    ctx.session.pendingRequestSource = "deeplink";
    ctx.session.state = "awaiting_request_message";

    await ctx.answerCbQuery();

    await safeReply(
      ctx,
      "📩 *Быстрый запрос*\n\nНапишите сообщение по услуге:\n• пожелания\n• даты\n• количество человек\n\n" +
        "Если контактный номер отличается от Telegram — добавьте его в сообщение.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] quick action error:", e);
    try { await ctx.answerCbQuery("Ошибка. Попробуйте ещё раз", { show_alert: true }); } catch {}
  }
});


/* ===================== AUTHOR TOUR / CARD CONTACTS ALIAS ===================== */
bot.action(/^contacts:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match?.[1]);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await ctx.answerCbQuery("⚠️ Некорректная кнопка", { show_alert: true });
      return;
    }

    await doUnlockFlow(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] contacts action error:", e?.message || e);
    try { await ctx.answerCbQuery("⚠️ Ошибка. Попробуйте позже.", { show_alert: true }); } catch {}
  }
});

/* ===================== UNLOCK CORE (ENTERPRISE SHIELD) ===================== */

/* ===================== UNLOCK HANDLER ===================== */

bot.action(/^u:(\d+):(\d+):(\d+):([a-f0-9]{12,64})$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match?.[1]);
    const buttonChatId = Number(ctx.match?.[2]);
    const ts = Number(ctx.match?.[3]);
    const sig = String(ctx.match?.[4] || "");

    // 🛡 sanity serviceId
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await ctx.answerCbQuery("⚠️ Некорректная кнопка", { show_alert: true });
      return;
    }
    
    // 🛡 sanity buttonChatId
    if (!Number.isFinite(buttonChatId) || buttonChatId <= 0) {
      await ctx.answerCbQuery("⚠️ Некорректная кнопка", { show_alert: true });
      return;
    }
    
    // 🔒 кнопку может нажать только тот пользователь
    if (buttonChatId !== Number(ctx.from?.id)) {
      await ctx.answerCbQuery("⛔️ Эта кнопка не для вас", { show_alert: true });
      return;
    }

    const v = verifyUnlockCbData({
      chatId: buttonChatId,
      serviceId,
      ts,
      sig,
    });

    if (!v.ok) {
      await ctx.answerCbQuery(
        "⛔️ Кнопка устарела. Откройте карточку заново.",
        { show_alert: true }
      );
      return;
    }

    await doUnlockFlow(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] unlock action error:", e?.message || e);
    try {
      await ctx.answerCbQuery("⚠️ Ошибка. Попробуйте позже.", { show_alert: true });
    } catch {}
  }
});

/* ===================== OFFER ACCEPT (BANK++) ===================== */

/* ===================== OFFER ACCEPT (oa:<serviceId>:<ts>:<sig12>) ===================== */

bot.action(/^oa:(\d+):(\d+):([a-f0-9]+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match?.[1]);
    const ts = Number(ctx.match?.[2]);
    const sig = String(ctx.match?.[3] || "");
    const chatId = ctx.from?.id;

    if (!chatId) {
      try { await ctx.answerCbQuery("Ошибка пользователя", { show_alert: true }); } catch {}
      return;
    }

    const v = verifyOfferAcceptCbData({ chatId, serviceId, ts, sig });
    if (!v.ok) {
      try {
        await ctx.answerCbQuery("⛔️ Кнопка устарела. Откройте карточку заново.", { show_alert: true });
      } catch {}
      return;
    }

    // ✅ КРИТИЧНО: оферту пишем по clientRow.id (ID клиента в БД), а не по chatId
    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) {
      try { await ctx.answerCbQuery("👋 Сначала привяжите аккаунт через /start", { show_alert: true }); } catch {}
      return;
    }

    await pool.query(
      `INSERT INTO user_offer_accepts
       (user_role, user_id, offer_version, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      ["client", clientRow.id, OFFER_VERSION || "v1.0", "telegram_unlock"]
    );

    try {
      await ctx.answerCbQuery("✅ Условия приняты", { show_alert: false });
    } catch {}

    // 🚀 AUTO-UNLOCK
    try {
      await doUnlockFlow(ctx, serviceId);
    } catch (e) {
      console.error("[tg-bot] auto unlock after offer failed:", e?.message || e);
    }
  } catch (e) {
    console.error("[tg-bot] offer_accept error:", e?.message || e);
    try {
      await ctx.answerCbQuery("Ошибка. Попробуйте позже", { show_alert: true });
    } catch {}
  }
});

bot.action("balance:check", async (ctx) => {
  try {
    await safeCb(ctx);

    const chatId = ctx.from?.id;
    if (!chatId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя.");
      return;
    }

    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) {
      await safeReply(ctx, "👋 Сначала привяжите аккаунт через /start");
      return;
    }

    // ✅ unified balance
    const balNum = await getClientBalanceUnified(pool, clientRow.id);
    const bal = Number(balNum || 0).toLocaleString("ru-RU");
    const unlockSettings = await getContactUnlockSettings(pool);
    const need = tiyinToSum(unlockSettings.effective_price || 0).toLocaleString("ru-RU");
    const topupUrl = `${SITE_URL}/client/balance`;

    const hasLast = !!ctx.session?.lastUnlockServiceId;

    // ✅ last ops
    const ops = await getLastBalanceOpsUnified(pool, clientRow.id, 5);
    const lines = [];

    for (const it of ops) {
      const amt = Number(it?.amount || 0);
      const sign = amt >= 0 ? "+" : "−";
      const abs = Math.abs(Math.trunc(amt)).toLocaleString("ru-RU");

      const reason = String(it?.reason || it?.source || "").trim();
      const sid = Number(it?.service_id || 0);
      const hint = sid ? ` • #${sid}` : "";

      const dt = it?.created_at ? new Date(it.created_at) : null;
      const dts =
        dt && !isNaN(dt.getTime())
          ? dt.toLocaleString("ru-RU", {
              timeZone: "Asia/Tashkent",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";

      lines.push(`• ${dts} — <b>${sign}${abs}</b> сум${hint}${reason ? ` (${escapeHtml(reason)})` : ""}`);
    }

    const opsBlock = lines.length
      ? `\n\n<b>Последние операции</b>\n${lines.join("\n")}`
      : `\n\n<i>Операций пока нет.</i>`;

    await safeReply(
      ctx,
      "💰 <b>Баланс контактов</b>\n\n" +
        `Баланс: <b>${bal}</b> сум\n` +
        `Открытие контактов: <b>${need}</b> сум` +
        opsBlock,
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              PAYMENTS_PROVIDER_TOKEN
                ? { text: "💳 Пополнить баланс", callback_data: "balance:topup" }
                : { text: "💳 Пополнить баланс", url: topupUrl },
            ],
            ...(hasLast ? [[{ text: "🔓 Повторить открытие", callback_data: "balance:retry" }]] : []),
          ],
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] balance:check error:", e?.message || e);
    try {
      await safeReply(ctx, "⚠️ Не удалось проверить баланс. Попробуйте позже.");
    } catch {}
  }
});

// ===================== TOP-UP INSIDE BOT (Telegram Payments) =====================

bot.action("balance:topup", async (ctx) => {
  try {
    await safeCb(ctx);

    if (!PAYMENTS_PROVIDER_TOKEN) {
      await safeReply(
        ctx,
        `💳 Пополнение через сайт:\n${SITE_URL}/client/balance`,
        {
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "Открыть страницу пополнения", url: `${SITE_URL}/client/balance` }]],
          },
        }
      );
      return;
    }

    const chatId = ctx.from?.id;
    if (!chatId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя.");
      return;
    }

    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) {
      await safeReply(ctx, "👋 Сначала привяжите аккаунт через /start");
      return;
    }

    const balNum = await getClientBalanceUnified(pool, clientRow.id);
    const bal = Number(balNum || 0).toLocaleString("ru-RU");

    const rows = TOPUP_AMOUNTS.map((a) => [
      { text: `+${a.toLocaleString("ru-RU")} сум`, callback_data: `balance:topup:${a}` },
    ]);
    rows.push([{ text: "⬅️ Назад", callback_data: "balance:check" }]);

    await safeReply(
      ctx,
      `💳 <b>Пополнение баланса</b>\n\nТекущий баланс: <b>${bal}</b> сум\n\nВыберите сумму пополнения:`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } }
    );
  } catch (e) {
    console.error("[tg-bot] balance:topup error:", e?.message || e);
    try { await safeReply(ctx, "⚠️ Не удалось открыть пополнение. Попробуйте позже."); } catch {}
  }
});

bot.action(/^balance:topup:(\d+)$/, async (ctx) => {
  try {
    const amountSum = Number(ctx.match?.[1] || 0);
    if (!Number.isFinite(amountSum) || amountSum <= 0) {
      await safeCb(ctx, "⚠️ Некорректная сумма", true);
      return;
    }

    const MERCHANT_ID = process.env.PAYME_MERCHANT_ID || "";
    const CHECKOUT_URL = process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz";
    const SITE_PUBLIC = process.env.SITE_PUBLIC_URL || process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "";
    const lang = "ru";

    if (!MERCHANT_ID || !SITE_PUBLIC) {
      await safeReply(ctx, "⚠️ Payme не настроен на сервере (нет PAYME_MERCHANT_ID / SITE_PUBLIC_URL).");
      return;
    }

    // создаём order в БД
    const amountTiyin = Math.trunc(amountSum * 100); // сум -> тийин (UZS) :contentReference[oaicite:6]{index=6}
    const chatId = ctx.from?.id;
    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) {
      await safeReply(ctx, "👋 Сначала привяжите аккаунт через /start");
      return;
    }
    const clientId = Number(clientRow.id);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const redirectUrl = `${SITE_PUBLIC.replace(/\/+$/, "")}/client/balance?source=telegram`;

    const r = await pool.query(
      `INSERT INTO topup_orders (
         client_id,
         amount,
         amount_tiyin,
         provider,
         status,
         purpose,
         order_type,
         redirect_url,
         expires_at,
         meta
       )
       VALUES (
         $1,
         $2,
         $2,
         'payme',
         'created',
         'client_topup',
         'balance_topup',
         $3,
         $4,
         $5::jsonb
       )
       RETURNING id`,
      [
        clientId,
        amountTiyin,
        redirectUrl,
        expiresAt,
        JSON.stringify({ source: "telegram_bot", chat_id: chatId }),
      ]
    );
    const orderId = Number(r.rows?.[0]?.id);

    const callbackUrl = `${SITE_PUBLIC.replace(/\/+$/, "")}/client/balance?order_id=${orderId}&source=telegram`;
    const payUrl = buildPaymeCheckoutUrl({
      merchantId: MERCHANT_ID,
      checkoutBase: CHECKOUT_URL,
      orderId,
      amountTiyin,
      lang,
      callbackUrl,
    });

    await pool.query(
      `UPDATE topup_orders SET pay_url = $2, redirect_url = $3 WHERE id = $1`,
      [orderId, payUrl, callbackUrl]
    );

    const guideUrl = buildPaymeGuideUrlForTelegram(payUrl, {
      purpose: "balance_topup",
      amount: amountSum,
      orderId,
    });

    await safeReply(
      ctx,
      `${PAYME_CARD_ONLY_HINT}

💳 <b>Сумма:</b> ${amountSum.toLocaleString("ru-RU")} сум
<b>Заказ:</b> #${orderId}

После оплаты нажмите «Проверить баланс».`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Понятно, перейти к оплате", url: guideUrl || payUrl }],
            [{ text: "🔄 Проверить баланс", callback_data: "balance:check" }],
            [{ text: "⬅️ Назад", callback_data: "balance:topup" }],
          ],
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] balance:topup:amount error:", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось создать ссылку. Попробуйте позже.");
  }
});


const PROVIDER_SUPPORT_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getProviderSupportContext(ctx) {
  const data = String(ctx?.callbackQuery?.data || "");
  if (data.startsWith("svc_archive") || data.startsWith("archive:")) return "after_archive";
  if (data.startsWith("svc_unpublish")) return "after_unpublish";
  if (data.includes("proof")) return "after_proof";
  return "manual";
}

async function recentlySupportedProject(providerId) {
  try {
    if (!pool || !providerId) return false;
    const r = await pool.query(
      `
      SELECT 1
        FROM provider_support_donations
       WHERE provider_id = $1
         AND status IN ('paid','succeeded')
         AND paid_at >= NOW() - INTERVAL '24 hours'
       LIMIT 1
      `,
      [Number(providerId)]
    );
    return !!r.rowCount;
  } catch {
    return false;
  }
}

async function replyProviderSupportPrompt(ctx, serviceId = null) {
  try {
    if (!pool) return;
    const settings = await getProviderSupportSettings(pool);
    if (!settings?.enabled) return;

    if (!ctx.session) ctx.session = {};
    const now = Date.now();
    const lastPromptAt = Number(ctx.session.__providerSupportPromptAt || 0);
    if (lastPromptAt && now - lastPromptAt < PROVIDER_SUPPORT_PROMPT_COOLDOWN_MS) return;

    const telegramChatId = getActorId(ctx) || ctx.from?.id || null;
    const providerId = await resolveProviderIdByTelegramChatId(telegramChatId).catch(() => null);
    if (providerId && await recentlySupportedProject(providerId)) return;

    const amounts = Array.isArray(settings.suggested_amounts)
      ? settings.suggested_amounts
      : [10000, 25000, 50000, 100000];

    const rows = amounts
      .map((x) => Math.trunc(Number(x)))
      .filter((x) => Number.isFinite(x) && x > 0)
      .slice(0, 8)
      .map((x) => [{
        text: `💛 ${x.toLocaleString("ru-RU")} сум`,
        callback_data: `support_project:pay:${x}:${Number(serviceId || 0)}`,
      }]);

    if (!rows.length) return;

    rows.push([{ text: "⏭ Продолжить без поддержки", callback_data: "support_project:skip" }]);
    rows.push([
      { text: "📋 Мои услуги", callback_data: "prov_services:list" },
      { text: "🗄 Архив", callback_data: "archive:open" },
    ]);
    rows.push([{ text: "📈 Спрос и клиенты", url: `${SITE_URL}/dashboard/finance` }]);

    const text =
      `❤️ <b>Спасибо, что помогаете держать базу отказов актуальной.</b>

` +
      `Поддержка проекта — добровольная. Она помогает развивать <b>Bot Otkaznyx Turov</b> и делает базу отказных предложений удобнее для всех.

` +
      `Ваш вклад помогает нам:
` +
      `• улучшать поиск и карточки
` +
      `• поддерживать Telegram-бота и веб-кабинет
` +
      `• быстрее дорабатывать инструменты для поставщиков

` +
      `Выберите комфортную сумму или продолжайте работу с услугами.`;

    ctx.session.__providerSupportPromptAt = now;

    await safeReply(ctx, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    });
  } catch (e) {
    console.error("[tg-bot] provider support prompt error:", e?.message || e);
  }
}

bot.action("support_project:skip", async (ctx) => {
  try {
    await safeCb(ctx, "Продолжаем работу с услугами");
    await safeReply(ctx, "Хорошо, продолжаем без поддержки проекта.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] support_project:skip error:", e?.message || e);
  }
});

async function sendProviderSupportInvoice(ctx, { providerId, serviceId = null, amountSum }) {
  const pid = Number(providerId || 0);
  const sid = Number(serviceId || 0) || 0;
  const amount = Math.trunc(Number(amountSum || 0));

  if (!PAYMENTS_PROVIDER_TOKEN) {
    await safeReply(ctx, "⚠️ Telegram Payme не настроен на сервере.");
    return { ok: false, reason: "no_provider_token" };
  }

  if (ctx.chat?.type !== "private") {
    await safeReply(ctx, "🔒 Поддержать проект через Telegram Payme можно только в личном чате с ботом.");
    return { ok: false, reason: "not_private" };
  }

  if (!Number.isFinite(pid) || pid <= 0) {
    await safeReply(ctx, "⚠️ Не удалось определить поставщика. Откройте бота через /start.");
    return { ok: false, reason: "bad_provider" };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    await safeReply(ctx, "⚠️ Некорректная сумма поддержки проекта.");
    return { ok: false, reason: "bad_amount" };
  }

  const supportContext = getProviderSupportContext(ctx);
  const amountMinor = amount * currencyMinorFactor(PAYMENTS_CURRENCY);

  await ensureTelegramPaymentsTables(pool);

  const donationQ = await pool.query(
    `
    INSERT INTO provider_support_donations (
      provider_id,
      telegram_chat_id,
      service_id,
      amount_tiyin,
      status,
      source,
      note,
      expires_at
    )
    VALUES ($1, $2, $3, $4, 'created', 'telegram_invoice', $5, NOW() + INTERVAL '30 minutes')
    RETURNING id
    `,
    [
      pid,
      Number(ctx.from?.id || ctx.chat?.id || 0) || null,
      sid || null,
      amountMinor,
      supportContext,
    ]
  );

  const donationId = Number(donationQ.rows?.[0]?.id || 0) || 0;
  const payload = `support_project:${pid}:${sid}:${amount}:${donationId}:${Date.now()}`;

  await pool.query(
    `
    INSERT INTO telegram_payments (
      status, payment_type, service_id, invoice_payload,
      amount_minor, amount_sum, currency, source, meta
    )
    VALUES ('created', 'provider_support', $1, $2, $3, $4, $5, 'telegram_bot', $6::jsonb)
    `,
    [
      sid || null,
      payload,
      amountMinor,
      amount,
      String(PAYMENTS_CURRENCY || "UZS"),
      JSON.stringify({
        provider_id: pid,
        service_id: sid || null,
        donation_id: donationId || null,
        support_context: supportContext,
        source: "telegram_invoice",
        stage: "invoice_created",
      }),
    ]
  );

  await safeReply(ctx, PAYME_CARD_ONLY_HINT, { parse_mode: "HTML" });

  await ctx.telegram.sendInvoice(ctx.chat.id, {
    title: "❤️ Поддержка проекта",
    description: "Добровольный вклад в развитие Bot Otkaznyx Turov",
    payload,
    provider_token: PAYMENTS_PROVIDER_TOKEN,
    currency: PAYMENTS_CURRENCY,
    prices: [
      {
        label: "Развитие Bot Otkaznyx Turov",
        amount: amountMinor,
      },
    ],
    start_parameter: "provider_support",
  });

  return { ok: true };
}

bot.action(/^support_project:pay:(\d+):(\d+)$/, async (ctx) => {
  try {
    await safeCb(ctx);

    const amountSum = Number(ctx.match?.[1] || 0);
    const serviceId = Number(ctx.match?.[2] || 0) || null;
    const telegramChatId = getActorId(ctx) || ctx.from?.id || null;

    const providerId = await resolveProviderIdByTelegramChatId(telegramChatId);
    if (!providerId) {
      await safeReply(ctx, "⚠️ Не удалось определить ваш аккаунт поставщика. Откройте бота через /start.");
      return;
    }

    await sendProviderSupportInvoice(ctx, {
      providerId,
      serviceId,
      amountSum,
    });
  } catch (e) {
    console.error("[tg-bot] support_project:pay error:", e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось создать Telegram Payme оплату поддержки проекта. Попробуйте позже.");
  }
});

async function sendUnlockedServiceCard(ctx, serviceId) {
  try {
    const { data } = await axios.get(`/api/telegram/service/${serviceId}`, {
      params: { role: "client", chatId: ctx.from?.id },
    });

    if (!data?.success || !data?.service) {
      await safeReply(ctx, "✅ Контакты открыты. Откройте карточку услуги повторно, чтобы увидеть контакты.");
      return;
    }

    const svc = data.service;
    const category = String(svc.category || svc.type || "refused_tour").trim().toLowerCase();
    const { text, photoUrl, serviceUrl, kbExtra } = buildServiceMessage(svc, category, "client", {
      unlocked: true,
      isInline: false,
      forceRefused: String(category || "").startsWith("refused_") || category === "author_tour",
    });

    const kb = kbExtra?.replaceDefault && kbExtra?.inline_keyboard?.length
      ? { inline_keyboard: kbExtra.inline_keyboard }
      : {
          inline_keyboard: [
            ...(kbExtra?.inline_keyboard?.length ? kbExtra.inline_keyboard : []),
            [{ text: "🌐 Подробнее на сайте", url: serviceUrl }],
            [{ text: "💬 Быстрый запрос", callback_data: `quick:${serviceId}` }],
          ],
        };

    if (photoUrl) {
      await safeReplyWithPhoto(ctx, photoUrl, text, {
        parse_mode: "HTML",
        reply_markup: kb,
      });
    } else {
      await safeReply(ctx, text, {
        parse_mode: "HTML",
        reply_markup: kb,
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    console.error("[tg-bot] sendUnlockedServiceCard error:", e?.message || e);
    await safeReply(ctx, "✅ Контакты открыты. Откройте карточку услуги повторно, чтобы увидеть контакты.");
  }
}


async function ensureTelegramPaymentsTables(poolArg = pool) {
  if (!poolArg) return false;

  await poolArg.query(`
    CREATE TABLE IF NOT EXISTS telegram_payments (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'created',
      payment_type TEXT NOT NULL,
      client_id BIGINT,
      service_id BIGINT,
      invoice_payload TEXT,
      telegram_payment_charge_id TEXT,
      provider_payment_charge_id TEXT,
      amount_minor BIGINT NOT NULL DEFAULT 0,
      amount_sum BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'UZS',
      source TEXT NOT NULL DEFAULT 'telegram_bot',
      error TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await poolArg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_telegram_payments_tg_charge
    ON telegram_payments (telegram_payment_charge_id)
    WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
  `);

  await poolArg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_telegram_payments_provider_charge
    ON telegram_payments (provider_payment_charge_id)
    WHERE provider_payment_charge_id IS NOT NULL AND provider_payment_charge_id <> ''
  `);

  await poolArg.query(`CREATE INDEX IF NOT EXISTS idx_telegram_payments_client ON telegram_payments (client_id, created_at DESC)`);
  await poolArg.query(`CREATE INDEX IF NOT EXISTS idx_telegram_payments_service ON telegram_payments (service_id, created_at DESC)`);
  await poolArg.query(`CREATE INDEX IF NOT EXISTS idx_telegram_payments_status ON telegram_payments (status, created_at DESC)`);

  return true;
}

function parseTelegramPaymentPayload(payload) {
  const raw = String(payload || '').trim();
  const parts = raw.split(':');
  const paymentType = String(parts[0] || '').trim();

  if (paymentType === 'contact_topup') {
    return {
      ok: true,
      raw,
      paymentType,
      clientId: Number(parts[1] || 0),
      amountSum: Number(parts[2] || 0),
      serviceId: null,
      ts: Number(parts[3] || 0),
    };
  }

  if (paymentType === 'unlock_contact') {
    return {
      ok: true,
      raw,
      paymentType,
      clientId: Number(parts[1] || 0),
      serviceId: Number(parts[2] || 0),
      amountSum: Number(parts[3] || 0),
      ts: Number(parts[4] || 0),
    };
  }

  if (paymentType === 'support_project') {
    const hasDonationId = parts.length >= 6;
    return {
      ok: true,
      raw,
      paymentType,
      providerId: Number(parts[1] || 0),
      serviceId: Number(parts[2] || 0) || null,
      amountSum: Number(parts[3] || 0),
      donationId: hasDonationId ? Number(parts[4] || 0) || null : null,
      ts: Number(parts[hasDonationId ? 5 : 4] || 0),
    };
  }

  return { ok: false, raw, paymentType, reason: 'unsupported_payload' };
}

function validateTelegramPaymentAmount({ parsed, totalAmountMinor, currency }) {
  const expectedSum = Math.trunc(Number(parsed?.amountSum || 0));
  const actualMinor = Math.trunc(Number(totalAmountMinor || 0));
  const expectedCurrency = String(PAYMENTS_CURRENCY || "UZS").toUpperCase();
  const actualCurrency = String(currency || "").toUpperCase();
  const factor = currencyMinorFactor(expectedCurrency);
  const expectedMinor = expectedSum * factor;

  if (!Number.isFinite(expectedSum) || expectedSum <= 0) {
    return {
      ok: false,
      reason: "bad_payload_amount",
      expectedSum,
      expectedMinor,
      actualMinor,
      actualCurrency,
      expectedCurrency,
    };
  }

  if (actualCurrency !== expectedCurrency) {
    return {
      ok: false,
      reason: "currency_mismatch",
      expectedSum,
      expectedMinor,
      actualMinor,
      actualCurrency,
      expectedCurrency,
    };
  }

  if (!Number.isFinite(actualMinor) || actualMinor !== expectedMinor) {
    return {
      ok: false,
      reason: "amount_mismatch",
      expectedSum,
      expectedMinor,
      actualMinor,
      actualCurrency,
      expectedCurrency,
    };
  }

  return {
    ok: true,
    expectedSum,
    expectedMinor,
    actualMinor,
    actualCurrency,
    expectedCurrency,
  };
}

async function trackTelegramBotEvent(eventName, {
  clientId = null,
  serviceId = null,
  providerId = null,
  chatId = null,
  source = 'telegram_bot',
  meta = {},
} = {}) {
  try {
    if (!pool) return false;

    await pool.query(`
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

    await pool.query(
      `
      INSERT INTO activity_events (
        actor_role, actor_id, event_type, event_name,
        service_id, provider_id, client_id, source, meta
      )
      VALUES ('client', $1, 'telegram_payment', $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        clientId || chatId || null,
        String(eventName || 'telegram_event'),
        serviceId || null,
        providerId || null,
        clientId || null,
        source,
        JSON.stringify({ chat_id: chatId || null, ...meta }),
      ]
    );

    return true;
  } catch (e) {
    console.error('[tg-bot] trackTelegramBotEvent error:', e?.message || e);
    return false;
  }
}

async function validateServiceForTelegramUnlock(poolArg, serviceId) {
  const sid = Number(serviceId);
  if (!poolArg || !Number.isFinite(sid) || sid <= 0) {
    return { ok: false, reason: 'bad_service_id' };
  }

  const { rows } = await poolArg.query(
    `
    SELECT
      s.id,
      s.provider_id,
      s.status,
      s.expiration_at,
      s.deleted_at,
      s.title,
      s.category,
      s.details
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.id = $1
      AND s.deleted_at IS NULL
      AND s.status IN ('published', 'approved', 'active')
      AND (s.expiration_at IS NULL OR s.expiration_at > NOW())
      AND COALESCE(NULLIF(LOWER(s.details->>'isActive'), ''), 'true') <> 'false'
    LIMIT 1
    `,
    [sid]
  );

  const service = rows?.[0] || null;
  if (!service) return { ok: false, reason: 'service_not_available' };
  return { ok: true, service };
}

async function markTelegramPaymentFailed({ parsed, sp = {}, error }) {
  try {
    if (!pool) return false;
    await ensureTelegramPaymentsTables(pool);
    await pool.query(
      `
      INSERT INTO telegram_payments (
        status, payment_type, client_id, service_id, invoice_payload,
        telegram_payment_charge_id, provider_payment_charge_id,
        amount_minor, amount_sum, currency, error, meta
      )
      VALUES ('failed', $1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (telegram_payment_charge_id)
      WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
      DO UPDATE SET status='failed', error=EXCLUDED.error, meta=telegram_payments.meta || EXCLUDED.meta, processed_at=NOW()
      `,
      [
        parsed?.paymentType || 'unknown',
        parsed?.clientId || null,
        parsed?.serviceId || null,
        parsed?.raw || sp?.invoice_payload || null,
        String(sp?.telegram_payment_charge_id || ''),
        String(sp?.provider_payment_charge_id || ''),
        Number(sp?.total_amount || 0),
        parsed?.amountSum || 0,
        String(sp?.currency || PAYMENTS_CURRENCY || 'UZS'),
        String(error?.message || error || 'unknown_error').slice(0, 500),
        JSON.stringify({ error_stack: String(error?.stack || '').slice(0, 2000) }),
      ]
    );
    return true;
  } catch (e) {
    console.error('[tg-bot] markTelegramPaymentFailed error:', e?.message || e);
    return false;
  }
}

async function getUnlockPaymentPreview(ctx, serviceId) {
  const sid = Number(serviceId);
  const out = { title: "Контакты поставщика", photoUrl: null, service: null };

  try {
    const { data } = await axios.get(`/api/telegram/service/${sid}`, {
      params: { role: "client", chatId: ctx.from?.id },
    });

    if (data?.success && data?.service) {
      const svc = data.service;
      const category = String(svc.category || "").toLowerCase();
      const d = parseDetailsAny(svc.details);
      const pickedTitle =
        svc.title ||
        d.title ||
        d.hotelName ||
        d.hotel ||
        d.directionCountry ||
        "Контакты поставщика";

      out.title = String(pickedTitle || out.title).trim() || out.title;
      out.service = svc;

      try {
        const built = buildServiceMessage(svc, category, "client", {
          unlocked: false,
          isInline: false,
          forceRefused: String(category || "").startsWith("refused_") || category === "author_tour",
        });
        if (built?.photoUrl) out.photoUrl = built.photoUrl;
      } catch {}

      return out;
    }
  } catch (e) {
    console.error("[tg-bot] getUnlockPaymentPreview service error:", e?.message || e);
  }

  try {
    const brief = await fetchServiceBrief(sid);
    if (brief?.title) out.title = String(brief.title).trim() || out.title;
  } catch {}

  return out;
}

function buildUnlockPaywallText({ title, balanceSum, priceSum }) {
  const bal = Number(balanceSum || 0).toLocaleString("ru-RU");
  const price = Number(priceSum || 0).toLocaleString("ru-RU");
  const safeTitle = escapeHtml(truncate(title || "Контакты поставщика", 90));

  return (
    `🔓 <b>Открытие контактов поставщика</b>\n\n` +
    `📌 <b>${safeTitle}</b>\n\n` +
    `После оплаты вы сразу получите:\n` +
    `📞 телефон поставщика\n` +
    `💬 Telegram / прямую связь\n` +
    `⚡ возможность быстро забронировать вариант без ожидания\n\n` +
    `🔥 Отказные предложения часто уходят быстро — лучше связаться сразу после открытия контактов.\n\n` +
    `💰 Ваш баланс: <b>${bal}</b> сум\n` +
    `🔐 Стоимость открытия: <b>${price}</b> сум\n\n` +
    `✅ Контакты откроются автоматически сразу после успешной оплаты.`
  );
}

async function sendUnlockPaywallCard(ctx, { serviceId, balanceSum, priceSum }) {
  const preview = await getUnlockPaymentPreview(ctx, serviceId);
  const price = Number(priceSum || 0).toLocaleString("ru-RU");
  const text = buildUnlockPaywallText({
    title: preview.title,
    balanceSum,
    priceSum,
  });

  const replyMarkup = {
    inline_keyboard: [
      [
        PAYMENTS_PROVIDER_TOKEN
          ? { text: `💳 Оплатить и открыть (${price} сум)`, callback_data: `unlock:pay:${serviceId}` }
          : { text: "💳 Пополнить баланс", url: `${SITE_URL}/client/balance` },
      ],
      [{ text: "🔓 Повторить открытие", callback_data: "balance:retry" }],
    ],
  };

  if (preview.photoUrl) {
    await safeReplyWithPhoto(ctx, preview.photoUrl, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return;
  }

  await safeReply(ctx, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function sendUnlockContactInvoice(ctx, { clientId, serviceId, amountSum }) {
  const cid = Number(clientId);
  const sid = Number(serviceId);
  const amount = Math.trunc(Number(amountSum || 0));

  if (!PAYMENTS_PROVIDER_TOKEN) {
    await safeReply(ctx, "⚠️ Telegram Payme не настроен на сервере.");
    return { ok: false, reason: "no_provider_token" };
  }
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(sid) || sid <= 0) {
    await safeReply(ctx, "⚠️ Не удалось подготовить оплату. Откройте карточку услуги заново.");
    return { ok: false, reason: "bad_payload" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await safeReply(ctx, "⚠️ Некорректная сумма открытия контактов.");
    return { ok: false, reason: "bad_amount" };
  }

  const serviceCheck = await validateServiceForTelegramUnlock(pool, sid);
  if (!serviceCheck.ok) {
    await trackTelegramBotEvent('tg_unlock_invoice_blocked', {
      clientId: cid,
      serviceId: sid,
      chatId: ctx.from?.id,
      meta: { reason: serviceCheck.reason },
    });
    await safeReply(ctx, "⚠️ Эта услуга уже недоступна для открытия контактов.");
    return { ok: false, reason: serviceCheck.reason };
  }

  const preview = await getUnlockPaymentPreview(ctx, sid);
  const invoiceTitle = "🔥 Контакты поставщика";
  const invoiceDescription = truncate(
    `${preview.title || "Услуга"} · телефон и Telegram поставщика откроются сразу после оплаты`,
    255
  );

  const payload = `unlock_contact:${cid}:${sid}:${amount}:${Date.now()}`;

  await ctx.telegram.sendInvoice(ctx.chat.id, {
    title: invoiceTitle,
    description: invoiceDescription,
    payload,
    provider_token: PAYMENTS_PROVIDER_TOKEN,
    currency: PAYMENTS_CURRENCY,
    prices: [
      {
        label: "Доступ к телефону и Telegram поставщика",
        amount: amount * currencyMinorFactor(PAYMENTS_CURRENCY),
      },
    ],
    start_parameter: `unlock_${sid}`,
  });

  await trackTelegramBotEvent('tg_unlock_invoice_open', {
    clientId: cid,
    serviceId: sid,
    providerId: serviceCheck.service?.provider_id || null,
    chatId: ctx.from?.id,
    meta: { amount_sum: amount, currency: PAYMENTS_CURRENCY, payload_type: 'unlock_contact' },
  });

  return { ok: true };
}


async function notifyProviderAboutContactUnlock({ serviceId, clientId, paidAmount, source = "telegram_payment" }) {
  try {
    if (!pool) return false;
    const sid = Number(serviceId);
    const cid = Number(clientId);
    if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(cid) || cid <= 0) return false;

    const serviceQ = await pool.query(
      `
      SELECT
        s.id,
        s.title,
        s.category,
        p.id AS provider_id,
        COALESCE(p.telegram_refused_chat_id, p.telegram_web_chat_id, p.telegram_chat_id, p.tg_chat_id) AS provider_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [sid]
    );

    const service = serviceQ.rows?.[0];
    const providerChatId = service?.provider_chat_id ? String(service.provider_chat_id).trim() : "";
    if (!providerChatId) return false;

    const clientQ = await pool.query(`SELECT to_jsonb(c) AS data FROM clients c WHERE c.id=$1 LIMIT 1`, [cid]);
    const c = clientQ.rows?.[0]?.data || {};
    const clientName =
      c.name ||
      c.full_name ||
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
      c.phone ||
      `Client #${cid}`;
    const clientPhone = c.phone || c.phone_number || "";
    const clientTelegram = c.telegram || c.telegram_username || c.username || "";
    const title = service?.title || `Услуга #${sid}`;
    const serviceUrl = `${SITE_URL}/dashboard/finance?from=tg&service_id=${sid}`;

    const lines = [
      `🔥 <b>Клиент открыл контакты</b>`,
      ``,
      `📦 <b>Услуга:</b> #${sid} · ${escapeHtml(title)}`,
      `👤 <b>Клиент:</b> ${escapeHtml(clientName)}`,
    ];

    if (clientPhone) lines.push(`☎️ <b>Телефон:</b> <code>${escapeHtml(clientPhone)}</code>`);
    if (clientTelegram) lines.push(`💬 <b>Telegram:</b> ${escapeHtml(String(clientTelegram).startsWith("@") ? clientTelegram : `@${clientTelegram}`)}`);
    if (paidAmount) lines.push(`💳 <b>Оплачено за открытие:</b> ${Number(paidAmount || 0).toLocaleString("ru-RU")} сум`);

    lines.push(``, `⚡ Ответьте быстрее — клиент уже проявил прямой интерес.`);

    await bot.telegram.sendMessage(providerChatId, lines.join("\n"), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📈 Открыть CRM", url: serviceUrl }],
        ],
      },
    });

    await trackTelegramBotEvent('tg_provider_unlock_notified', {
      clientId: cid,
      serviceId: sid,
      providerId: Number(service?.provider_id || 0) || null,
      chatId: providerChatId,
      meta: { source },
    });
    return true;
  } catch (e) {
    console.error("[tg-bot] notifyProviderAboutContactUnlock error:", e?.message || e);
    return false;
  }
}

// Telegram Payments: acknowledge checkout
bot.on("pre_checkout_query", async (ctx) => {
  try {
    const q = ctx.preCheckoutQuery;
    const parsed = parseTelegramPaymentPayload(q?.invoice_payload || "");

    if (!parsed.ok) {
      await ctx.answerPreCheckoutQuery(false, "Некорректный платеж. Откройте оплату заново.");
      return;
    }

    if (parsed.paymentType === "support_project") {
      const amountCheck = validateTelegramPaymentAmount({
        parsed,
        totalAmountMinor: q?.total_amount,
        currency: q?.currency,
      });

      if (!amountCheck.ok) {
        console.warn("[tg-bot] provider support pre_checkout amount rejected", {
          reason: amountCheck.reason,
          payload: parsed.raw,
          expectedMinor: amountCheck.expectedMinor,
          actualMinor: amountCheck.actualMinor,
          expectedCurrency: amountCheck.expectedCurrency,
          actualCurrency: amountCheck.actualCurrency,
        });
        await ctx.answerPreCheckoutQuery(false, "Сумма платежа изменилась. Выберите сумму заново.");
        return;
      }

      const providerId = await resolveProviderIdByTelegramChatId(ctx.from?.id);
      if (!providerId || Number(providerId) !== Number(parsed.providerId)) {
        await ctx.answerPreCheckoutQuery(false, "Поставщик не найден. Откройте бот через /start.");
        return;
      }
    }

    if (parsed.paymentType === "unlock_contact") {
      const clientRow = await getClientRowByChatId(pool, ctx.from?.id);
      if (!clientRow?.id || Number(clientRow.id) !== Number(parsed.clientId)) {
        await ctx.answerPreCheckoutQuery(false, "Клиент не найден. Откройте бот через /start.");
        return;
      }

      const amountCheck = validateTelegramPaymentAmount({
        parsed,
        totalAmountMinor: q?.total_amount,
        currency: q?.currency,
      });
      if (!amountCheck.ok) {
        console.warn("[tg-bot] pre_checkout amount rejected", {
          reason: amountCheck.reason,
          payload: parsed.raw,
          expectedMinor: amountCheck.expectedMinor,
          actualMinor: amountCheck.actualMinor,
          expectedCurrency: amountCheck.expectedCurrency,
          actualCurrency: amountCheck.actualCurrency,
        });
        await ctx.answerPreCheckoutQuery(false, "Сумма платежа изменилась. Откройте оплату заново.");
        return;
      }

      const serviceCheck = await validateServiceForTelegramUnlock(pool, parsed.serviceId);
      if (!serviceCheck.ok) {
        await ctx.answerPreCheckoutQuery(false, "Эта услуга уже недоступна.");
        return;
      }

      const settings = await getContactUnlockSettings(pool).catch(() => null);
      const currentPrice = Math.trunc(Number(settings?.effective_price ?? CONTACT_UNLOCK_PRICE ?? 0));
      if (currentPrice > 0 && Number(parsed.amountSum) !== currentPrice) {
        console.warn("[tg-bot] pre_checkout stale invoice rejected", {
          payloadAmount: parsed.amountSum,
          currentPrice,
          serviceId: parsed.serviceId,
          clientId: parsed.clientId,
        });
        await ctx.answerPreCheckoutQuery(false, "Цена открытия изменилась. Откройте оплату заново.");
        return;
      }
    }

    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error("[tg-bot] pre_checkout_query error:", e?.message || e);
    try { await ctx.answerPreCheckoutQuery(false, "Ошибка оплаты. Попробуйте позже."); } catch {}
  }
});

// Telegram Payments: credit balance or unlock contacts on successful payment
bot.on("successful_payment", async (ctx) => {
  const sp = ctx.message?.successful_payment;
  let parsed = null;

  try {
    if (!sp) return;

    const chatId = ctx.from?.id;
    if (!chatId) return;

    parsed = parseTelegramPaymentPayload(sp.invoice_payload || "");
    if (!parsed.ok) return;

    if (parsed.paymentType !== "contact_topup" && parsed.paymentType !== "unlock_contact" && parsed.paymentType !== "support_project") return;

    const factor = currencyMinorFactor(sp.currency || PAYMENTS_CURRENCY);
    const paidMinor = Number(sp.total_amount || 0);
    const paidMajor = factor > 0 ? Math.trunc(paidMinor / factor) : Math.trunc(paidMinor);

    await ensureTelegramPaymentsTables(pool);

    if (parsed.paymentType === "support_project") {
      const amountCheck = validateTelegramPaymentAmount({
        parsed,
        totalAmountMinor: sp.total_amount,
        currency: sp.currency,
      });

      const providerId = await resolveProviderIdByTelegramChatId(chatId);
      if (!providerId || Number(providerId) !== Number(parsed.providerId)) {
        await trackTelegramBotEvent("tg_provider_support_payment_failed", {
          providerId: Number(parsed.providerId || 0) || null,
          serviceId: Number(parsed.serviceId || 0) || null,
          chatId,
          meta: { reason: "provider_mismatch", payload: parsed.raw },
        });
        await safeReply(ctx, "⚠️ Оплата получена, но аккаунт поставщика не совпал. Мы видим платеж и проверим его вручную.");
        return;
      }

      if (!amountCheck.ok) {
        await trackTelegramBotEvent("tg_provider_support_payment_failed", {
          providerId,
          serviceId: Number(parsed.serviceId || 0) || null,
          chatId,
          meta: {
            reason: amountCheck.reason,
            expected_amount_sum: amountCheck.expectedSum,
            expected_amount_minor: amountCheck.expectedMinor,
            paid_amount_minor: amountCheck.actualMinor,
            expected_currency: amountCheck.expectedCurrency,
            paid_currency: amountCheck.actualCurrency,
          },
        });
        await safeReply(ctx, "⚠️ Оплата получена, но сумма не совпала с ожидаемой. Мы видим платеж и проверим его вручную.");
        return;
      }

      const amountSum = Math.trunc(Number(parsed.amountSum || paidMajor || 0));
      const serviceId = Number(parsed.serviceId || 0) || null;
      const chargeId = String(sp.telegram_payment_charge_id || "");
      const providerChargeId = String(sp.provider_payment_charge_id || "");
      const lockKey = chargeId || providerChargeId || parsed.raw || `tg_support:${providerId}:${Date.now()}`;

      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`telegram_payment:${lockKey}`]);

        const duplicate = await tx.query(
          `
          SELECT id, status
            FROM telegram_payments
           WHERE ($1 <> '' AND telegram_payment_charge_id = $1)
              OR ($2 <> '' AND provider_payment_charge_id = $2)
           LIMIT 1
          `,
          [chargeId, providerChargeId]
        );

        if (duplicate.rowCount && String(duplicate.rows[0].status || "") === "succeeded") {
          await tx.query("COMMIT");
          await safeReply(ctx, "ℹ️ Этот платеж поддержки уже был обработан. Спасибо!");
          return;
        }

        await tx.query(
          `
          INSERT INTO telegram_payments (
            status, payment_type, service_id, invoice_payload,
            telegram_payment_charge_id, provider_payment_charge_id,
            amount_minor, amount_sum, currency, source, meta
          )
          VALUES ('succeeded', 'provider_support', $1, $2, NULLIF($3,''), NULLIF($4,''), $5, $6, $7, 'telegram_bot', $8::jsonb)
          ON CONFLICT (telegram_payment_charge_id)
          WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
          DO UPDATE SET
            status='succeeded',
            processed_at=NOW(),
            error=NULL,
            meta=telegram_payments.meta || EXCLUDED.meta
          `,
          [
            serviceId,
            parsed.raw,
            chargeId,
            providerChargeId,
            paidMinor,
            amountSum,
            String(sp.currency || PAYMENTS_CURRENCY || "UZS"),
            JSON.stringify({
              provider_id: providerId,
              service_id: serviceId,
              donation_id: Number(parsed.donationId || 0) || null,
              source: "telegram_invoice",
              successful_payment: sp,
            }),
          ]
        );

        await tx.query(
          `
          UPDATE telegram_payments
             SET status='succeeded', processed_at=NOW(), error=NULL
           WHERE invoice_payload = $1
          `,
          [parsed.raw]
        );

        if (Number(parsed.donationId || 0) > 0) {
          await tx.query(
            `
            UPDATE provider_support_donations
               SET status='paid',
                   paid_at=COALESCE(paid_at, NOW()),
                   updated_at=NOW(),
                   payme_id=COALESCE(NULLIF(payme_id,''), NULLIF($2,'')),
                   source='telegram_invoice',
                   note=COALESCE(NULLIF(note,''), 'telegram_invoice')
             WHERE id=$1
            `,
            [Number(parsed.donationId), chargeId || providerChargeId || null]
          );
        } else {
          await tx.query(
            `
            INSERT INTO provider_support_donations (
              provider_id,
              telegram_chat_id,
              service_id,
              amount_tiyin,
              payme_id,
              status,
              source,
              note,
              paid_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,NULLIF($5,''),'paid','telegram_invoice','legacy_telegram_invoice',NOW(),NOW())
            `,
            [
              providerId,
              chatId,
              serviceId,
              paidMinor,
              chargeId || providerChargeId || "",
            ]
          );
        }

        await tx.query("COMMIT");
      } catch (e) {
        try { await tx.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        tx.release();
      }

      await trackTelegramBotEvent("tg_provider_support_paid", {
        providerId,
        serviceId,
        chatId,
        meta: {
          amount_sum: amountSum,
          donation_id: Number(parsed.donationId || 0) || null,
          source: "telegram_invoice",
          currency: sp.currency,
          telegram_payment_charge_id: sp.telegram_payment_charge_id,
          provider_payment_charge_id: sp.provider_payment_charge_id,
        },
      });

      await safeReply(
        ctx,
        `❤️ <b>Спасибо за поддержку проекта.</b>

` +
          `Ваш вклад помогает развивать <b>Bot Otkaznyx Turov</b>.

` +
          `🧾 <b>Мини-чек</b>
` +
          `Сумма: <b>${Number(amountSum || 0).toLocaleString("ru-RU")} сум</b>
` +
          `Статус: <b>оплачено</b>
` +
          `Назначение: развитие Bot Otkaznyx Turov

` +
          `💛 В карточках ваших услуг будет отображаться знак доверия: <b>Поддерживает проект</b>.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Вернуться к моим услугам", callback_data: "prov_services:list" }],
              [
                { text: "➕ Создать новый отказ", callback_data: "prov_services:create" },
                { text: "📈 Спрос и клиенты", url: `${SITE_URL}/dashboard/finance` },
              ],
            ],
          },
        }
      );
      return;
    }

    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) return;

    if (Number(parsed.clientId) !== Number(clientRow.id)) {
      console.warn("[tg-bot] payment payload client mismatch", {
        paymentType: parsed.paymentType,
        payloadClientId: parsed.clientId,
        clientId: clientRow.id,
      });
      return;
    }

    if (parsed.paymentType === "unlock_contact") {
      const serviceId = Number(parsed.serviceId || 0);
      const paidAmount = Number.isFinite(parsed.amountSum) && parsed.amountSum > 0
        ? Math.trunc(parsed.amountSum)
        : paidMajor;

      if (!Number.isFinite(serviceId) || serviceId <= 0) {
        await trackTelegramBotEvent('tg_unlock_payment_failed', {
          clientId: Number(clientRow.id),
          chatId,
          meta: { reason: 'bad_service_id', payload: parsed.raw },
        });
        await safeReply(ctx, "⚠️ Оплата прошла, но ID услуги некорректный. Напишите администратору.");
        return;
      }

      const amountCheck = validateTelegramPaymentAmount({
        parsed,
        totalAmountMinor: sp.total_amount,
        currency: sp.currency,
      });

      if (!amountCheck.ok) {
        await markTelegramPaymentFailed({
          parsed,
          sp,
          error: new Error(`telegram_unlock_${amountCheck.reason}`),
        });

        await trackTelegramBotEvent('tg_unlock_payment_needs_manual_review', {
          clientId: Number(clientRow.id),
          serviceId,
          chatId,
          meta: {
            reason: amountCheck.reason,
            expected_amount_sum: amountCheck.expectedSum,
            expected_amount_minor: amountCheck.expectedMinor,
            paid_amount_minor: amountCheck.actualMinor,
            expected_currency: amountCheck.expectedCurrency,
            paid_currency: amountCheck.actualCurrency,
          },
        });

        await safeReply(
          ctx,
          "⚠️ Оплата получена, но сумма платежа не совпала с ожидаемой. Контакты не открыты автоматически — администратор проверит платеж вручную."
        );
        return;
      }

      await ensureUnlockTables(pool);
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");

        const chargeId = String(sp.telegram_payment_charge_id || "");
        const providerChargeId = String(sp.provider_payment_charge_id || "");
        const lockKey = chargeId || providerChargeId || parsed.raw || `tg_unlock:${clientRow.id}:${serviceId}`;
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`telegram_payment:${lockKey}`]);
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`unlock:${Number(clientRow.id)}:${Number(serviceId)}`]);

        const duplicate = await tx.query(
          `
          SELECT id, status
            FROM telegram_payments
           WHERE ($1 <> '' AND telegram_payment_charge_id = $1)
              OR ($2 <> '' AND provider_payment_charge_id = $2)
           LIMIT 1
          `,
          [chargeId, providerChargeId]
        );

        if (duplicate.rowCount && String(duplicate.rows[0].status || '') === 'succeeded') {
          await tx.query("COMMIT");
          await safeReply(ctx, "ℹ️ Этот платеж уже обработан. Контакты уже открыты.");
          await sendUnlockedServiceCard(ctx, serviceId);
          return;
        }

        const serviceCheck = await validateServiceForTelegramUnlock(tx, serviceId);
        if (!serviceCheck.ok) {
          await tx.query(
            `
            INSERT INTO telegram_payments (
              status, payment_type, client_id, service_id, invoice_payload,
              telegram_payment_charge_id, provider_payment_charge_id,
              amount_minor, amount_sum, currency, error, meta
            )
            VALUES ('needs_manual_review', 'unlock_contact', $1, $2, $3, NULLIF($4,''), NULLIF($5,''), $6, $7, $8, $9, $10::jsonb)
            ON CONFLICT (telegram_payment_charge_id)
            WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
            DO UPDATE SET status='needs_manual_review', error=EXCLUDED.error, meta=telegram_payments.meta || EXCLUDED.meta, processed_at=NOW()
            `,
            [
              Number(clientRow.id),
              Number(serviceId),
              parsed.raw,
              chargeId,
              providerChargeId,
              paidMinor,
              paidAmount,
              String(sp.currency || PAYMENTS_CURRENCY || 'UZS'),
              serviceCheck.reason,
              JSON.stringify({ successful_payment: sp, reason: serviceCheck.reason }),
            ]
          );
          await tx.query("COMMIT");

          await trackTelegramBotEvent('tg_unlock_payment_needs_manual_review', {
            clientId: Number(clientRow.id),
            serviceId,
            chatId,
            meta: { reason: serviceCheck.reason, paid_amount_sum: paidAmount },
          });
          await safeReply(
            ctx,
            "⚠️ Оплата прошла, но услуга уже недоступна. Мы видим платеж и разберём его вручную. Напишите администратору."
          );
          return;
        }

        await tx.query(
          `
          INSERT INTO telegram_payments (
            status, payment_type, client_id, service_id, invoice_payload,
            telegram_payment_charge_id, provider_payment_charge_id,
            amount_minor, amount_sum, currency, source, meta
          )
          VALUES ('processing', 'unlock_contact', $1, $2, $3, NULLIF($4,''), NULLIF($5,''), $6, $7, $8, 'telegram_bot', $9::jsonb)
          ON CONFLICT (telegram_payment_charge_id)
          WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
          DO UPDATE SET
            status = CASE WHEN telegram_payments.status = 'succeeded' THEN telegram_payments.status ELSE 'processing' END,
            meta = telegram_payments.meta || EXCLUDED.meta
          RETURNING id, status
          `,
          [
            Number(clientRow.id),
            Number(serviceId),
            parsed.raw,
            chargeId,
            providerChargeId,
            paidMinor,
            paidAmount,
            String(sp.currency || PAYMENTS_CURRENCY || 'UZS'),
            JSON.stringify({ successful_payment: sp }),
          ]
        );

        await tx.query(
          `
          INSERT INTO client_service_contact_unlocks
            (client_id, service_id, price_charged)
          VALUES ($1,$2,$3)
          ON CONFLICT (client_id, service_id) DO NOTHING
          `,
          [Number(clientRow.id), Number(serviceId), Number(paidAmount || 0)]
        );

        await tx.query(
          `
          INSERT INTO contact_balance_ledger
            (client_id, amount, reason, service_id, source, meta)
          VALUES ($1,0,'unlock_telegram_payment',$2,'telegram_payment',$3::jsonb)
          ON CONFLICT DO NOTHING
          `,
          [
            Number(clientRow.id),
            Number(serviceId),
            JSON.stringify({
              provider_payment_charge_id: sp.provider_payment_charge_id,
              telegram_payment_charge_id: sp.telegram_payment_charge_id,
              currency: sp.currency,
              total_amount: sp.total_amount,
              paid_amount_sum: paidAmount,
              invoice_payload: sp.invoice_payload,
            }),
          ]
        );

        await tx.query(
          `
          UPDATE telegram_payments
             SET status='succeeded', processed_at=NOW(), error=NULL
           WHERE ($1 <> '' AND telegram_payment_charge_id = $1)
              OR ($2 <> '' AND provider_payment_charge_id = $2)
          `,
          [chargeId, providerChargeId]
        );

        await tx.query("COMMIT");

        await trackTelegramBotEvent('tg_unlock_invoice_paid', {
          clientId: Number(clientRow.id),
          serviceId,
          providerId: serviceCheck.service?.provider_id || null,
          chatId,
          meta: {
            paid_amount_sum: paidAmount,
            currency: sp.currency,
            telegram_payment_charge_id: sp.telegram_payment_charge_id,
            provider_payment_charge_id: sp.provider_payment_charge_id,
          },
        });

        await notifyProviderAboutContactUnlock({
          serviceId,
          clientId: Number(clientRow.id),
          paidAmount,
          source: 'telegram_payment',
        });

        await safeReply(
          ctx,
          `✅ <b>Оплата прошла успешно!</b>\n\n` +
            `🔓 Контакты поставщика открыты автоматически.\n` +
            `💸 Оплачено: <b>${Number(paidAmount || 0).toLocaleString("ru-RU")}</b> сум\n\n` +
            `👇 Ниже отправляю карточку уже с открытыми контактами. Напишите поставщику сразу — отказные варианты часто уходят быстро.`,
          { parse_mode: "HTML" }
        );

        await sendUnlockedServiceCard(ctx, serviceId);

        await trackTelegramBotEvent('tg_unlock_success', {
          clientId: Number(clientRow.id),
          serviceId,
          providerId: serviceCheck.service?.provider_id || null,
          chatId,
          meta: { source: 'telegram_payment' },
        });
        return;
      } catch (e) {
        try { await tx.query("ROLLBACK"); } catch {}
        await markTelegramPaymentFailed({ parsed, sp, error: e });
        await trackTelegramBotEvent('tg_unlock_payment_failed', {
          clientId: Number(clientRow.id),
          serviceId,
          chatId,
          meta: { error: e?.message || String(e) },
        });
        throw e;
      } finally {
        tx.release();
      }
    }

    const creditAmount = Number.isFinite(parsed.amountSum) && parsed.amountSum > 0
      ? Math.trunc(parsed.amountSum)
      : paidMajor;

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const chargeId = String(sp.telegram_payment_charge_id || "");
      const providerChargeId = String(sp.provider_payment_charge_id || "");
      const lockKey = chargeId || providerChargeId || parsed.raw || `tg_topup:${clientRow.id}:${Date.now()}`;
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`telegram_payment:${lockKey}`]);

      const ex = await tx.query(
        `
        SELECT 1
          FROM telegram_payments
         WHERE status='succeeded'
           AND (($1 <> '' AND telegram_payment_charge_id = $1)
             OR ($2 <> '' AND provider_payment_charge_id = $2))
         LIMIT 1
        `,
        [chargeId, providerChargeId]
      );

      if (ex.rowCount) {
        await tx.query("ROLLBACK");
        const balNow = await getClientBalanceUnified(pool, clientRow.id);
        await safeReply(
          ctx,
          `ℹ️ Этот платеж уже был зачислен.\n\nВаш баланс: <b>${Number(balNow || 0).toLocaleString("ru-RU")}</b> сум`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "💰 Проверить баланс", callback_data: "balance:check" }]] } }
        );
        return;
      }

      await tx.query(
        `
        INSERT INTO telegram_payments (
          status, payment_type, client_id, invoice_payload,
          telegram_payment_charge_id, provider_payment_charge_id,
          amount_minor, amount_sum, currency, source, meta
        )
        VALUES ('processing', 'contact_topup', $1, $2, NULLIF($3,''), NULLIF($4,''), $5, $6, $7, 'telegram_bot', $8::jsonb)
        ON CONFLICT (telegram_payment_charge_id)
        WHERE telegram_payment_charge_id IS NOT NULL AND telegram_payment_charge_id <> ''
        DO UPDATE SET status='processing', meta=telegram_payments.meta || EXCLUDED.meta
        `,
        [
          Number(clientRow.id),
          parsed.raw,
          chargeId,
          providerChargeId,
          paidMinor,
          creditAmount,
          String(sp.currency || PAYMENTS_CURRENCY || 'UZS'),
          JSON.stringify({ successful_payment: sp }),
        ]
      );

      const res = await addContactBalanceLedgerTx(tx, {
        clientId: clientRow.id,
        amount: creditAmount,
        reason: "topup_telegram",
        serviceId: null,
        source: "telegram_payment",
        meta: {
          provider_payment_charge_id: sp.provider_payment_charge_id,
          telegram_payment_charge_id: sp.telegram_payment_charge_id,
          currency: sp.currency,
          total_amount: sp.total_amount,
          invoice_payload: sp.invoice_payload,
        },
      });

      await tx.query(
        `
        UPDATE telegram_payments
           SET status='succeeded', processed_at=NOW(), error=NULL
         WHERE ($1 <> '' AND telegram_payment_charge_id = $1)
            OR ($2 <> '' AND provider_payment_charge_id = $2)
        `,
        [chargeId, providerChargeId]
      );

      await tx.query("COMMIT");

      const bal = Number(res?.balance || 0).toLocaleString("ru-RU");
      const sid = Number(ctx.session?.lastUnlockServiceId || 0);

      await trackTelegramBotEvent('tg_topup_success', {
        clientId: Number(clientRow.id),
        serviceId: sid || null,
        chatId,
        meta: { amount_sum: creditAmount, currency: sp.currency },
      });
      
      if (sid > 0) {
        try {
          await safeReply(
            ctx,
            `✅ Оплата прошла успешно!\n\nВаш баланс: <b>${bal}</b> сум\n🔓 Пытаюсь автоматически открыть контакты...`,
            { parse_mode: "HTML" }
          );
      
          const retryRes = await doUnlockFlow(ctx, sid);
          if (retryRes?.ok) return;
        } catch (e) {
          console.error("[tg-bot] auto-retry after payment error:", e?.message || e);
        }
      }
      
      await safeReply(
        ctx,
        `✅ Оплата прошла успешно!\n\nВаш баланс: <b>${bal}</b> сум`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Проверить баланс", callback_data: "balance:check" }],
              ...(sid > 0 ? [[{ text: "🔓 Повторить открытие", callback_data: "balance:retry" }]] : []),
            ],
          },
        }
      );
    } catch (e) {
      try { await tx.query("ROLLBACK"); } catch {}
      await markTelegramPaymentFailed({ parsed, sp, error: e });
      throw e;
    } finally {
      tx.release();
    }
  } catch (e) {
    console.error("[tg-bot] successful_payment handler error:", e?.message || e);
    try {
      await safeReply(
        ctx,
        "⚠️ Платеж получен, но произошла ошибка при обработке. Нажмите кнопку ниже — мы повторим открытие контактов.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Повторить открытие контактов", callback_data: "balance:retry" }],
              [{ text: "🆘 Написать администратору", url: `${SITE_URL}/support/project` }],
            ],
          },
        }
      );
    } catch {}
  }
});

bot.action(/^unlock:pay:(\d+)$/, async (ctx) => {
  try {
    await safeCb(ctx);

    if (ctx.chat?.type !== "private") {
      await safeReply(ctx, "🔒 Оплата и показ контактов доступны только в личном чате с ботом.");
      return;
    }

    const serviceId = Number(ctx.match?.[1] || 0);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await safeReply(ctx, "⚠️ Некорректный ID услуги. Откройте карточку заново.");
      return;
    }

    const chatId = ctx.from?.id;
    const clientRow = await getClientRowByChatId(pool, chatId);
    if (!clientRow?.id) {
      await safeReply(ctx, "👋 Сначала привяжите аккаунт через /start");
      return;
    }

    const already = await isContactsUnlocked(pool, { clientId: clientRow.id, serviceId });
    if (already) {
      await safeReply(ctx, "✅ Контакты уже открыты.");
      await sendUnlockedServiceCard(ctx, serviceId);
      return;
    }

    const offerCheck = await pool.query(
      `SELECT 1
         FROM user_offer_accepts
        WHERE user_role = 'client'
          AND user_id = $1
          AND offer_version = $2
        LIMIT 1`,
      [clientRow.id, OFFER_VERSION || "v1.0"]
    );

    if (!offerCheck.rowCount) {
      await showOfferGate(ctx, serviceId);
      return;
    }

    const unlockSettings = await getContactUnlockSettings(pool);
    const priceSum = tiyinToSum(unlockSettings.effective_price || 0) || CONTACT_UNLOCK_PRICE || 10000;

    ctx.session = ctx.session || {};
    ctx.session.lastUnlockServiceId = serviceId;

    await sendUnlockContactInvoice(ctx, {
      clientId: clientRow.id,
      serviceId,
      amountSum: priceSum,
    });
  } catch (e) {
    console.error("[tg-bot] unlock:pay error:", e?.message || e);
    try { await safeReply(ctx, "⚠️ Не удалось создать Telegram Payme оплату. Попробуйте позже."); } catch {}
  }
});

bot.action("balance:retry", async (ctx) => {
  try {
    await safeCb(ctx);

    const sid = Number(ctx.session?.lastUnlockServiceId || 0);
    if (!sid) {
      await safeReply(ctx, "⚠️ Нет сохранённой попытки открытия. Откройте карточку услуги заново.");
      return;
    }

    // ✅ повторяем тот же flow (оферта/антифрод/locks/списание)
    await doUnlockFlow(ctx, sid);
  } catch (e) {
    console.error("[tg-bot] balance:retry error:", e?.message || e);
    try {
      await safeReply(ctx, "⚠️ Не удалось повторить открытие. Попробуйте позже.");
    } catch {}
  }
});

/* ===================== UNLOCK FLOW (BANK-GRADE) ===================== */

async function doUnlockFlow(ctx, serviceId) {
  const chatId = ctx.from?.id;

  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    try {
      await ctx.answerCbQuery("⚠️ Некорректный ID услуги", { show_alert: true });
    } catch {}
    return { ok: false };
  }

const clientRow = await getClientRowByChatId(pool, chatId);

if (!clientRow?.id) {
  try {
    await ctx.answerCbQuery("👋 Сначала привяжите аккаунт через /start", { show_alert: true });
  } catch {}
  return { ok: false };
}

// 🔥 FAST-PATH: уже открыт? (снимает лишнюю нагрузку с advisory lock)
try {
  const already = await pool.query(
    `SELECT 1
       FROM client_service_contact_unlocks
      WHERE client_id = $1
        AND service_id = $2
      LIMIT 1`,
    [clientRow.id, serviceId]
  );

  if (already.rowCount) {
    try {
      await ctx.answerCbQuery("✅ Контакты уже открыты", { show_alert: false });
    } catch {}

    // 🔒 bank-grade: обновлять unlocked-карточку только в личке
    if (ctx.chat?.type === "private") {
      try {
        await refreshUnlockedCard(ctx, serviceId);
      } catch {}
    } else {
      // если нажали в группе — уводим в личку
      try {
        await safeReply(
          ctx,
          "✅ Контакты уже открыты. Откройте карточку в личке с ботом, чтобы увидеть контакты.",
          { disable_web_page_preview: true }
        );
      } catch {}
    }

    return { ok: true, already: true };
  }
} catch (e) {
  console.error("[tg-bot] fast unlock check failed:", e?.message || e);
}

  // 🔐 ПРОВЕРКА ОФЕРТЫ (BANK PROTECTION)
  const offerCheck = await pool.query(
    `SELECT 1
       FROM user_offer_accepts
      WHERE user_role = 'client'
        AND user_id = $1
        AND offer_version = $2
      LIMIT 1`,
    [clientRow.id, OFFER_VERSION || "v1.0"]
  );

if (!offerCheck.rowCount) {
  return await showOfferGate(ctx, serviceId);
}
  // 🔒 BANK-GRADE: контакты/обновление unlocked карточки — только в личке
if (ctx.chat?.type !== "private") {
  try {
    await ctx.answerCbQuery("🔒 Откройте в личке с ботом", { show_alert: true });
  } catch {}

  try {
    await safeReply(
      ctx,
      "🔒 <b>Безопасность</b>\n\nОткрытие/показ контактов доступно только в личном чате с ботом.\nОткройте карточку в личке и нажмите «Открыть контакты» ещё раз.",
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch {}

  return { ok: false, reason: "not_private" };
}

  // === BLACK-HOLE++ / anti-fraud gates (BANK-GRADE) ===
  const key = `unlock:${chatId}:${serviceId}`;
  
  if (isHardBlocked(chatId)) {
    try { await ctx.answerCbQuery("⛔️ Доступ временно ограничен", { show_alert: true }); } catch {}
    return { ok: false, reason: "blocked" };
  }
  
  if (hasInFlight(key) || isRecent(key, 2000)) {
    try { await ctx.answerCbQuery("⏳ Обрабатываю…", { show_alert: false }); } catch {}
    return { ok: false, reason: "in_flight" };
  }
  
  if (!checkVelocity(chatId)) {
    const score = markSuspicious(chatId);
    try {
      await ctx.answerCbQuery(
        score >= 6 ? "⛔️ Слишком много попыток" : "⚠️ Слишком часто. Подождите",
        { show_alert: true }
      );
    } catch {}
    return { ok: false, reason: "velocity" };
  }
  
  setInFlight(key, 20000);
  
let result;
try {
  // 🔥 BANK-GRADE advisory lock: в той же транзакции, что и списание/insert
result = await withServiceLock(pool, clientRow.id, serviceId, async (db) => {
  const unlockSettings = await getContactUnlockSettings(db);

  return unlockContactsForService(db, {
    clientId: clientRow.id,
    serviceId,
    price: tiyinToSum(unlockSettings.effective_price || 0),
  });
});
} catch (e) {
  console.error("[tg-bot] doUnlockFlow locked unlock error:", e?.message || e);
  result = { ok: false, reason: "server_error" };
} finally {
  unlockInFlight.delete(key);
  markRecent(key);
}

if (!result.ok) {
  if (result.reason === "no_balance") {
    const balNum = Number(result.balance || 0);
    const needNum = Number(result.need || CONTACT_UNLOCK_PRICE || 10000);

    const bal = balNum.toLocaleString("ru-RU");
    const need = needNum.toLocaleString("ru-RU");

    // ✅ запомним последнюю попытку, чтобы дать кнопку "Повторить"
    try {
      ctx.session = ctx.session || {};
      ctx.session.lastUnlockServiceId = serviceId;
    } catch {}

        try {
      await pool.query(
        `
        INSERT INTO client_pending_unlocks (client_id, service_id)
        VALUES ($1, $2)
        `,
        [clientRow.id, serviceId]
      );
    } catch (e) {
      console.error("[tg-bot] pending unlock insert error:", e?.message || e);
    }

    // 1) как и раньше: alert
    try {
      await ctx.answerCbQuery(
        `💳 Недостаточно средств.\nБаланс: ${bal} сум\nНужно: ${need} сум`,
        { show_alert: true }
      );
    } catch {}

    // 1) как и раньше: alert
    try {
      await ctx.answerCbQuery(
        `💳 Недостаточно средств.\nБаланс: ${bal} сум\nНужно: ${need} сум`,
        { show_alert: true }
      );
    } catch {}

    // 2) "окно" в чат с кнопками
    try {
      const topupUrl = `${SITE_URL}/client/balance`;

      await sendUnlockPaywallCard(ctx, {
        serviceId,
        balanceSum: balNum,
        priceSum: needNum,
      });
    } catch (e) {
      console.error("[tg-bot] no_balance UI error:", e?.message || e);
    }

    return { ok: false, reason: "no_balance" };
  }

  try {
    await ctx.answerCbQuery("⚠️ Не удалось открыть контакты", { show_alert: true });
  } catch {}

  return { ok: false, reason: result.reason || "failed" };
}

try {
  await ctx.answerCbQuery("⏳ Открываем контакты...", { show_alert: false });
} catch {}

if (ctx.chat?.type === "private") {
  try {
    await refreshUnlockedCard(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] refreshUnlockedCard failed:", e?.message || e);
  }
} else {
  try {
    await safeReply(
      ctx,
      "✅ Готово. Откройте карточку в личке с ботом.",
      { disable_web_page_preview: true }
    );
  } catch {}
}

if (result.already) {
  try {
    await bot.telegram.sendMessage(
      ctx.from.id,
      "✅ Контакты уже были открыты",
      { disable_web_page_preview: true }
    );
  } catch {}
} else {
  const charged = Number(result.charged || 0);

  try {
    await bot.telegram.sendMessage(
      ctx.from.id,
      `✅ Контакты открыты\n💸 Списано: ${charged.toLocaleString("ru-RU")} сум`,
      { disable_web_page_preview: true }
    );
  } catch {}
}

return { ok: true };
}

/* ===================== TEXT HANDLER (wizard + quick request) ===================== */

// Делегат для обработки текста в wizard-режиме редактирования услуги.
// Возвращает true, если сообщение было обработано и дальше по роутеру идти не нужно.
async function handleSvcEditWizardText(ctx) {
  try {
    const textRaw = (ctx.message?.text || "").trim();
    const text = textRaw;

    const legacy = String(ctx.session?.state || "");
    const editStep = String(ctx.session?.editWiz?.step || "");

    const state =
      legacy.startsWith("svc_create_") || legacy.startsWith("svc_hotel_")
        ? legacy
        : editStep || legacy;

    if (!state.startsWith("svc_edit_")) return false;

    const draft = ctx.session?.serviceDraft || {};
    ctx.session.serviceDraft = draft;

    const keep = () => {
      const v = String(text || "").toLowerCase().trim();
      return v === "пропустить" || v === "skip" || v === "-" || v === "—";
    };

    const isNo = () => {
      const v = String(text || "").toLowerCase().trim();
      return v === "нет" || v === "no" || v === "none" || v === "null";
    };

    const parseYesNoLocal = () => {
      const raw = String(text || "").toLowerCase().trim();
      const v = raw
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim()
        .split(/\s+/)[0];

      if (["да", "y", "yes", "true", "1"].includes(v)) return true;
      if (["нет", "n", "no", "false", "0"].includes(v)) return false;
      return null;
    };

    const parseNum = () => {
      const v = String(text || "").replace(",", ".").trim();
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const parsePax = () => {
      const v = String(text || "").trim();
      const m = v.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
      if (!m) return null;
      return { adt: Number(m[1]), chd: Number(m[2]), inf: Number(m[3]) };
    };

    const go = async (nextState, message) => {
      ctx.session.wizardStack = Array.isArray(ctx.session.wizardStack)
        ? ctx.session.wizardStack
        : [];
      ctx.session.wizardStack.push(state);

      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = nextState;

      ctx.session.state = nextState;
      await safeReply(ctx, message, editWizKeyboardForPrompt(message));
    };

    switch (state) {
      case "svc_edit_title": {
        if (!keep()) draft.title = text;

        if (
          draft.category === "refused_ticket" ||
          draft.category === "refused_event_ticket"
        ) {
          await go(
            "svc_edit_ticket_country",
            `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

        if (draft.category === "refused_hotel") {
          await go(
            "svc_edit_hotel_country",
            `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

        if (draft.category === "refused_flight") {
          await go(
            "svc_edit_flight_country",
            `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

        await go(
          "svc_edit_tour_country",
          `🌍 Страна направления (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_ticket_country": {
        if (!keep()) draft.country = text;
        await go(
          "svc_edit_ticket_city",
          `🏙 Город события (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_ticket_city": {
        if (!keep()) draft.toCity = text;
        await go(
          "svc_edit_ticket_date",
          `📅 Дата события (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_ticket_date": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(
              ctx,
              "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.startDate = norm;
          draft.endDate = "";
        }

        await go(
          "svc_edit_price",
          `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_country": {
        if (!keep()) draft.country = text;
        await go(
          "svc_edit_flight_from",
          `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_from": {
        if (!keep()) draft.fromCity = text;
        await go(
          "svc_edit_flight_to",
          `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_to": {
        if (!keep()) draft.toCity = text;
        await go(
          "svc_edit_flight_departure",
          `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_country": {
        if (!keep()) draft.country = text;
        await go(
          "svc_edit_tour_from",
          `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_from": {
        if (!keep()) draft.fromCity = text;
        await go(
          "svc_edit_tour_to",
          `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_to": {
        if (!keep()) draft.toCity = text;
        await go(
          "svc_edit_tour_start",
          `📅 Дата начала (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_start": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(
              ctx,
              "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.startDate = norm;
        }

        await go(
          "svc_edit_tour_end",
          `📅 Дата окончания (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_end": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(
              ctx,
              "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.endDate = norm;
        }

        await go(
          "svc_edit_flight_departure",
          `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_departure": {
        if (!keep()) {
          if (isNo()) {
            draft.departureFlightDate = "";
          } else {
            const norm = normalizeDateInput(text);
            if (!norm) {
              await safeReply(
                ctx,
                "⚠️ Нужна дата (YYYY-MM-DD или YYYY.MM.DD) или «нет» / «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }
            draft.departureFlightDate = norm;
          }
        }

        await go(
          "svc_edit_flight_return",
          `🛬 Дата рейса обратно (текущее: ${draft.returnFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_return": {
        if (!keep()) {
          if (isNo()) {
            draft.returnFlightDate = "";
          } else {
            const norm = normalizeDateInput(text);
            if (!norm) {
              await safeReply(
                ctx,
                "⚠️ Нужна дата (YYYY-MM-DD или YYYY.MM.DD) или «нет» / «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }
            draft.returnFlightDate = norm;
          }
        }

        await go(
          "svc_edit_flight_details",
          `✈️ Детали рейса (текущее: ${draft.flightDetails || "(нет)"}).\nВведите текст, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_details": {
        if (!keep()) draft.flightDetails = isNo() ? "" : text;

        if (draft.category === "refused_flight") {
          await go(
            "svc_edit_price",
            `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

        await go(
          "svc_edit_tour_hotel",
          `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_hotel": {
        if (!keep()) draft.hotel = text;
        await go(
          "svc_edit_tour_accommodation",
          `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите новое или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_accommodation": {
        if (!keep()) draft.accommodation = text;
        await go(
          "svc_edit_tour_roomcat",
          `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_roomcat": {
        if (!keep()) draft.roomCategory = text;
        await go(
          "svc_edit_tour_food",
          `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите (BB/HB/FB/AI/UAI) или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_food": {
        if (!keep()) draft.food = text;
        await go(
          "svc_edit_tour_insurance",
          `🛡 Страховка включена? (текущее: ${draft.insuranceIncluded ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_tour_insurance": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.insuranceIncluded = b;
        }
      
        await go(
          "svc_edit_tour_early_checkin",
          `🏨 Раннее заселение? (текущее: ${draft.earlyCheckIn ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }
      
      case "svc_edit_tour_early_checkin": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.earlyCheckIn = b;
        }
      
        await go(
          "svc_edit_tour_fast_track",
          `🛬 Arrival Fast Track? (текущее: ${draft.arrivalFastTrack ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }
      
      case "svc_edit_tour_fast_track": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.arrivalFastTrack = b;
        }
      
        await go(
          "svc_edit_price",
          `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`
        );
        return true;
      }
        
      case "svc_edit_hotel_country": {
        if (!keep()) draft.country = text;
        await go(
          "svc_edit_hotel_city",
          `🏙 Город (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_city": {
        if (!keep()) draft.toCity = text;
        await go(
          "svc_edit_hotel_name",
          `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_name": {
        if (!keep()) draft.hotel = text;
        await go(
          "svc_edit_hotel_checkin",
          `📅 Дата заезда (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_checkin": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(
              ctx,
              "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.startDate = norm;
        }

        await go(
          "svc_edit_hotel_checkout",
          `📅 Дата выезда (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_checkout": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(
              ctx,
              "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.endDate = norm;
        }

        await go(
          "svc_edit_hotel_roomcat",
          `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_roomcat": {
        if (!keep()) draft.roomCategory = text;
        await go(
          "svc_edit_hotel_accommodation",
          `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_accommodation": {
        if (!keep()) draft.accommodation = text;
        await go(
          "svc_edit_hotel_food",
          `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_food": {
        if (!keep()) draft.food = text;
        await go(
          "svc_edit_hotel_halal",
          `🥗 Halal? (текущее: ${draft.halal ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_halal": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.halal = b;
        }

        await go(
          "svc_edit_hotel_transfer",
          `🚗 Трансфер (текущее: ${draft.transfer || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_transfer": {
        if (!keep()) draft.transfer = text;
        await go(
          "svc_edit_hotel_changeable",
          `🔁 Можно изменения? (текущее: ${draft.changeable ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_changeable": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.changeable = b;
        }

        await go(
          "svc_edit_hotel_pax",
          `👥 ADT/CHD/INF (текущее: ${draft.adt ?? 0}/${draft.chd ?? 0}/${draft.inf ?? 0}).\nВведите 2/1/0 или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_hotel_pax": {
        if (!keep()) {
          const p = parsePax();
          if (!p) {
            await safeReply(
              ctx,
              '⚠️ Введите в формате "2/1/0" или «пропустить».',
              editWizNavKeyboard()
            );
            return true;
          }
          draft.adt = p.adt;
          draft.chd = p.chd;
          draft.inf = p.inf;
        }

          await go(
            "svc_edit_hotel_insurance",
            `🛡 Страховка включена? (текущее: ${draft.insuranceIncluded ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
          );
        return true;
      }

        case "svc_edit_hotel_insurance": {
          if (!keep()) {
            const b = parseYesNoLocal();
            if (b === null) {
              await safeReply(
                ctx,
                "⚠️ Ответьте да/нет или «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }
            draft.insuranceIncluded = b;
          }
        
          await go(
            "svc_edit_hotel_early_checkin",
            `🏨 Раннее заселение? (текущее: ${draft.earlyCheckIn ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
          );
          return true;
        }
        
        case "svc_edit_hotel_early_checkin": {
          if (!keep()) {
            const b = parseYesNoLocal();
            if (b === null) {
              await safeReply(
                ctx,
                "⚠️ Ответьте да/нет или «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }
            draft.earlyCheckIn = b;
          }
        
          await go(
            "svc_edit_hotel_fast_track",
            `🛬 Arrival Fast Track? (текущее: ${draft.arrivalFastTrack ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`
          );
          return true;
        }
        
        case "svc_edit_hotel_fast_track": {
          if (!keep()) {
            const b = parseYesNoLocal();
            if (b === null) {
              await safeReply(
                ctx,
                "⚠️ Ответьте да/нет или «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }
            draft.arrivalFastTrack = b;
          }
        
          await go(
            "svc_edit_price",
            `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`
          );
          return true;
        }
      case "svc_edit_price": {
        if (!keep()) {
          const n = parseNum();
          if (n === null || n < 0) {
            await safeReply(
              ctx,
              "⚠️ Введите корректное число или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.price = n;
        }

        await go(
          "svc_edit_grossPrice",
          `💳 Цена БРУТТО (текущее: ${draft.grossPrice || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_grossPrice": {
        if (!keep()) {
          const n = parseNum();
          if (n === null || n < 0) {
            await safeReply(
              ctx,
              "⚠️ Введите корректное число или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.grossPrice = n;
        }

        await go(
          "svc_edit_expiration",
          `⏳ Актуально до (YYYY-MM-DD, YYYY-MM-DD HH:mm) или "нет"\nТекущее: ${draft.expiration || "(нет)"}\nВведите или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_expiration": {
        if (!keep()) {
          if (isNo()) {
            draft.expiration = null;
          } else {
            const norm = normalizeDateTimeInputStrict(text);

            if (!norm) {
              await safeReply(
                ctx,
                "⚠️ Нужна дата: YYYY-MM-DD, YYYY-MM-DD HH:mm или YYYY.MM.DD HH:mm. Или «нет» / «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }

            if (isPastDateTime(norm)) {
              await safeReply(
                ctx,
                "⚠️ Дата актуальности уже в прошлом. Укажите будущую дату/время или «нет» / «пропустить».",
                editWizNavKeyboard()
              );
              return true;
            }

            draft.expiration = norm;
          }
        }

        await go(
          "svc_edit_isActive",
          `✅ Активна? (текущее: ${draft.isActive ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_isActive": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(
              ctx,
              "⚠️ Ответьте да/нет или «пропустить».",
              editWizNavKeyboard()
            );
            return true;
          }
          draft.isActive = b;

          if (b === true) {
            const now = new Date();
            const expRaw = draft.expiration || null;
            const exp = expRaw ? parseDateFlexible(expRaw) : null;

            if (!exp || exp.getTime() < now.getTime()) {
              const next = new Date(now);
              next.setDate(next.getDate() + 7);

              const yyyy = next.getFullYear();
              const mm = String(next.getMonth() + 1).padStart(2, "0");
              const dd = String(next.getDate()).padStart(2, "0");

              draft.expiration = `${yyyy}-${mm}-${dd}`;
            }
          }
        }

        ctx.session.editWiz = ctx.session.editWiz || {};
        ctx.session.editWiz.step = "svc_edit_images";
        ctx.session.state = "svc_edit_images";

        await promptEditState(ctx, "svc_edit_images");
        return true;
      }

      case "svc_edit_images": {
        const raw = (text || "").trim().toLowerCase();

        if (raw === "пропустить" || raw === "skip" || raw === "оставить") {
          await finishEditWizard(ctx);
          return true;
        }

        if (raw === "удалить" || raw === "delete" || raw === "remove") {
          draft.images = [];
          await finishEditWizard(ctx);
          return true;
        }

        await safeReply(
          ctx,
          "📷 Пришлите фото сообщением (не как файл).\nИли «пропустить» / «удалить».",
          editWizNavKeyboard()
        );
        return true;
      }

      default:
        await safeReply(
          ctx,
          "🤔 Не понял шаг редактирования. Нажмите ⬅️ Назад или ❌ Отмена.",
          editWizNavKeyboard()
        );
        return true;
    }
  } catch (e) {
    console.error("handleSvcEditWizardText error:", e);
    try {
      await safeReply(
        ctx,
        "⚠️ Ошибка при обработке редактирования. Попробуйте ещё раз."
      );
    } catch (_) {}
    return true;
  }
}

bot.on("text", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;
    // ⏱ TTL: если состояние протухло — сбрасываем ожидания
    if (ctx.session?.state && isSessionStateExpired(ctx)) {
      resetPendingClientInput(ctx);
      await ctx.reply("⏱ Время ожидания истекло. Начните действие заново.");
      return;
    }

    // ===================== PROOF FINISH =====================
    // Важно: bot.on("text") стоит раньше bot.hears(/готово/), поэтому
    // сообщение «ГОТОВО» нужно обработать здесь, иначе оно уходит в wizard.
    const rawText = String(ctx.message?.text || "").trim();
    if (/^(✅\s*)?(готово|done)$/i.test(rawText) && ctx.session?.awaitingProofForServiceId) {
      await finishProofSubmissionFromBot(ctx);
      return;
    }

    // ===================== EDIT WIZARD (svc_edit_*) =====================
    // Важно: чтобы редактирование услуг работало как раньше
    if (await handleSvcEditWizardText(ctx)) return;

    // ✅ 0) Менеджер может ответить без кнопок: "#<id> текст"
    if (MANAGER_CHAT_ID && isManagerChat(ctx)) {
      const parsed = parseManagerDirectReply(ctx.message?.text);
      if (parsed?.requestId && parsed?.message) {
        const requestId = Number(parsed.requestId);
        const replyText = String(parsed.message || "").trim();

        if (!replyText) {
          await ctx.reply("⚠️ Пустой ответ. Напишите текст сообщением.");
          return;
        }

        const req = await getReqById(requestId);
        if (!req) {
          await ctx.reply("⚠️ Заявка не найдена (или БД недоступна).");
          return;
        }

        // ✅ лог менеджера
        await logReqMessage({
          requestId,
          senderRole: "manager",
          senderTgId: ctx.from?.id,
          text: replyText,
        });

        // ✅ подтягиваем услугу для клиента (чтобы цена была БРУТТО)
        const svcForClient = await fetchTelegramService(req.service_id, "client");

        let titleLine = "";
        let priceLine = "";

        if (svcForClient) {
          const d = parseDetailsAny(svcForClient.details);
          const title = getServiceDisplayTitle(svcForClient);

          const priceRaw = pickPrice(d, svcForClient, "client"); // ✅ БРУТТО
          const priceWithCur = formatPriceWithCurrency(priceRaw);

          if (title) titleLine = `🏷 ${escapeMarkdown(title)}\n`;
          if (priceWithCur) priceLine = `💳 Цена (брутто): *${escapeMarkdown(priceWithCur)}*\n`;
        }

        const serviceUrl = SERVICE_URL_TEMPLATE
          .replace("{SITE_URL}", SITE_URL)
          .replace("{id}", String(req.service_id));

        const toClientText =
          `💬 Ответ по вашему запросу #${requestId}\n\n` +
          `Услуга ID: ${req.service_id}\n` +
          titleLine +
          priceLine +
          `Ссылка: ${serviceUrl}\n\n` +
          `Сообщение менеджера:\n${escapeMarkdown(replyText)}`;

        try {
          await bot.telegram.sendMessage(Number(req.client_tg_id), toClientText, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[
                { text: "💬 Дописать", callback_data: `reqadd:${requestId}` }
              ]]
            }
          });

          await ctx.reply(`✅ Отправлено клиенту (заявка #${requestId}).`);
        } catch (e) {
          console.error("[tg-bot] direct #reply send error:", e?.message || e);
          await ctx.reply("⚠️ Не удалось отправить клиенту. Возможно, клиент не писал боту / запретил сообщения.");
        }

        return; // важно: чтобы это сообщение не обработалось дальше
      }
    }

         // ✅ 1) Ответ оператора (владельца услуги / менеджера) клиенту (после нажатия "✍️ Ответить")
      if (
        ctx.session?.state === "awaiting_operator_reply" &&
        ctx.session?.operatorReplyRequestId
      ) {
        const requestId = Number(ctx.session.operatorReplyRequestId);
        const replyText = (ctx.message?.text || "").trim();
      
        if (!replyText) {
          await ctx.reply("⚠️ Пустой ответ. Напишите текст сообщением.");
          return;
        }
      
        // ✅ доступ: владелец своей услуги (или менеджер, если оставили доступ в isRequestOperatorChat)
        if (!(await isRequestOperatorChat(ctx, requestId))) {
          await ctx.reply("⛔ Недостаточно прав для ответа по этой заявке.");
          ctx.session.state = null;
          ctx.session.operatorReplyRequestId = null;
          return;
        }
      
        const req = await getReqById(requestId);
        if (!req) {
          await ctx.reply("⚠️ Не найдена заявка в БД (или БД недоступна).");
          ctx.session.state = null;
          ctx.session.operatorReplyRequestId = null;
          return;
        }
      
        // ✅ лог оператора
        await logReqMessage({
          requestId,
          senderRole: "operator",        // было "manager"
          senderTgId: ctx.from?.id,
          text: replyText,
        });
      
        // ✅ подтягиваем услугу для клиента (чтобы цена была БРУТТО)
        const svcForClient = await fetchTelegramService(req.service_id, "client");
      
        let titleLine = "";
        let priceLine = "";
      
        if (svcForClient) {
          const d = parseDetailsAny(svcForClient.details);
          const title = getServiceDisplayTitle(svcForClient);
      
          const priceRaw = pickPrice(d, svcForClient, "client"); // ✅ БРУТТО
          const priceWithCur = formatPriceWithCurrency(priceRaw);
      
          if (title) titleLine = `🏷 ${escapeMarkdown(title)}\n`;
          if (priceWithCur) priceLine = `💳 Цена (брутто): *${escapeMarkdown(priceWithCur)}*\n`;
        }
      
        const serviceUrl = SERVICE_URL_TEMPLATE
          .replace("{SITE_URL}", SITE_URL)
          .replace("{id}", String(req.service_id));
      
        const toClientText =
          `💬 Ответ по вашему запросу #${requestId}\n\n` +
          `Услуга ID: ${req.service_id}\n` +
          titleLine +
          priceLine +
          `Ссылка: ${serviceUrl}\n\n` +
          `Сообщение:\n${escapeMarkdown(replyText)}`;
      
        try {
          await bot.telegram.sendMessage(Number(req.client_tg_id), toClientText, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[
                { text: "💬 Дописать", callback_data: `reqadd:${requestId}` }
              ]]
            }
          });
      
          await ctx.reply(`✅ Отправлено клиенту (заявка #${requestId}).`);
        } catch (e) {
          console.error("[tg-bot] send to client error:", e?.message || e);
          await ctx.reply("⚠️ Не удалось отправить клиенту. Возможно, клиент не писал боту / запретил сообщения.");
        }
      
        // ✅ сброс состояния
        ctx.session.state = null;
        ctx.session.operatorReplyRequestId = null;
        return;
      }

      // ✅ 2) Клиент дописывает по существующей заявке (после кнопки "💬 Дописать")
      if (
        ctx.session?.state === "awaiting_request_add" &&
        ctx.session?.activeRequestId
      ) {
        const requestId = Number(ctx.session.activeRequestId);
        const dk = makeDedupKey(ctx, "ra", requestId);
          if (isDuplicateAndMark(ctx, dk)) {
            await ctx.reply("⚠️ Дополнение уже отправлено. Подождите немного.");
            ctx.session.state = null;
            ctx.session.activeRequestId = null;
            return;
          }
        const msg = (ctx.message?.text || "").trim();
        const from = ctx.from || {};
      
        if (!msg) {
          await ctx.reply("⚠️ Пустое сообщение. Напишите текст сообщением.");
          return;
        }
      
        const req = await getReqById(requestId);
        if (!req) {
          await ctx.reply("⚠️ Заявка не найдена (или БД недоступна).");
          ctx.session.state = null;
          ctx.session.activeRequestId = null;
          return;
        }
      
        // ✅ Логируем дописку клиента
        await logReqMessage({
          requestId,
          senderRole: "client",
          senderTgId: from?.id,
          text: msg,
        });
      
        // ✅ Находим владельца услуги
        const ownerChatId = await getOwnerChatIdByServiceId(req.service_id);
        if (!ownerChatId) {
          await ctx.reply(
            "⚠️ Владелец этой услуги ещё не подключил Telegram для получения заявок.\n" +
            "Попробуйте позже или выберите другую услугу."
          );
          ctx.session.state = null;
          ctx.session.activeRequestId = null;
          return;
        }
      
        const safeMsg = escapeMarkdown(msg);
        const safeUser = escapeMarkdown(from.username || "нет username");
        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");
      
        const serviceUrl = SERVICE_URL_TEMPLATE
          .replace("{SITE_URL}", SITE_URL)
          .replace("{id}", String(req.service_id));
      
        const textForOwner =
          `➕ *Дополнение по заявке #${escapeMarkdown(String(requestId))}*\n` +
          `Услуга ID: *${escapeMarkdown(String(req.service_id))}*\n` +
          `Ссылка: ${escapeMarkdown(serviceUrl)}\n\n` +
          `От: ${safeFirst} ${safeLast} (@${safeUser})\n\n` +
          `*Сообщение:*\n${safeMsg}`;
      
        // ✅ Кнопки владельцу (удобно)
        const reply_markup = {
          inline_keyboard: [
            [{ text: "✍️ Ответить", callback_data: `reqreply:${requestId}` }],
            [{ text: "📜 История", callback_data: `reqhist:${requestId}` }],
          ],
        };
      
        await bot.telegram.sendMessage(Number(ownerChatId), textForOwner, {
          parse_mode: "Markdown",
          reply_markup,
        });

        await ctx.reply("✅ Дополнение отправлено владельцу услуги.");
      
        // сброс состояния (activeRequestId можно чистить, чтобы не зависало)
        ctx.session.state = null;
        ctx.session.activeRequestId = null;
        return;
      }

    // ✅ 3) Быстрый запрос (ТОЛЬКО владельцу услуги)
    if (state === "awaiting_request_message" && ctx.session?.pendingRequestServiceId) {
      const serviceId = ctx.session.pendingRequestServiceId;
      const dk = makeDedupKey(ctx, "rq", serviceId);
        if (isDuplicateAndMark(ctx, dk)) {
          await ctx.reply("⚠️ Сообщение уже отправлено. Подождите немного.");
          ctx.session.state = null;
          ctx.session.pendingRequestServiceId = null;
          ctx.session.pendingRequestSource = null;
          return;
        }

      const source = ctx.session.pendingRequestSource || null;
      const msg = String(ctx.message?.text || "").trim();
      if (!msg) {
        await ctx.reply("⚠️ Пустое сообщение. Напишите текст.");
        return;
      }
      const from = ctx.from || {};
      const chatId = ctx.chat.id;
    
      // 1) создаём заявку
      const requestId = await createReqRow({ serviceId, from, source });
    
      // 2) логируем сообщение клиента (если БД доступна)
      if (requestId) {
        await logReqMessage({
          requestId,
          senderRole: "client",
          senderTgId: from?.id,
          text: msg,
        });
      }
    
      // 3) находим владельца услуги
      let ownerChatId = null;
      try {
        ownerChatId = await getOwnerChatIdByServiceId(serviceId);
      } catch (e) {
        console.error("[tg-bot] getOwnerChatIdByServiceId error:", e?.message || e);
      }
    
      if (!ownerChatId) {
        await ctx.reply(
          "⚠️ Владелец этой услуги ещё не подключил Telegram для получения заявок.\n" +
          "Попробуйте позже."
        );
      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      ctx.session.pendingRequestSource = null;
      return;
      }
    
      const safeFirst = escapeMarkdown(from.first_name || "");
      const safeLast = escapeMarkdown(from.last_name || "");
      const safeUsername = escapeMarkdown(from.username || "нет username");
      const safeMsg = escapeMarkdown(msg);
    
      const serviceUrl = SERVICE_URL_TEMPLATE
        .replace("{SITE_URL}", SITE_URL)
        .replace("{id}", String(serviceId));
    
      const textForOwner =
        "🆕 *Новый быстрый запрос из Bot Otkaznyx Turov*\n\n" +
        (requestId ? `Заявка ID: *${escapeMarkdown(requestId)}*\n` : "") +
        `Услуга ID: *${escapeMarkdown(serviceId)}*\n` +
        `Ссылка: ${escapeMarkdown(serviceUrl)}\n` +
        `От: ${safeFirst} ${safeLast} (@${safeUsername})\n` +
        `Telegram chatId клиента: \`${chatId}\`\n\n` +
        "*Сообщение:*\n" +
        safeMsg;
    
      const inline_keyboard = [];
    
      if (requestId) {
        inline_keyboard.push([
          { text: "✅ Принято", callback_data: `reqst:${requestId}:accepted` },
          { text: "⏳ Забронировано", callback_data: `reqst:${requestId}:booked` },
          { text: "❌ Отклонено", callback_data: `reqst:${requestId}:rejected` },
        ]);
    
        inline_keyboard.push([{ text: "✍️ Ответить", callback_data: `reqreply:${requestId}` }]);
        inline_keyboard.push([{ text: "📜 История", callback_data: `reqhist:${requestId}` }]);
      }
    
      if (from.username) {
        inline_keyboard.push([
          { text: "💬 Написать пользователю", url: `https://t.me/${String(from.username).replace(/^@/, "")}` },
        ]);
      }
    
      const replyMarkup = inline_keyboard.length ? { inline_keyboard } : undefined;
    
      // ✅ отправляем ТОЛЬКО владельцу услуги
      await bot.telegram.sendMessage(ownerChatId, textForOwner, {
        parse_mode: "Markdown",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    
      await ctx.reply("✅ Спасибо!\n\nЗапрос отправлен владельцу услуги.");
    
      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      ctx.session.pendingRequestSource = null;
      return;
    }

    // 2) мастер создания отказных (tour + hotel)
    if (
      state &&
      (
        state.startsWith("svc_create_") ||
        state.startsWith("svc_hotel_") ||
        state.startsWith("svc_author_") ||
        state.startsWith("author_stay_") ||
        state.startsWith("author_day_") ||
        state.startsWith("author_included_") ||
        state.startsWith("author_excluded_") ||
        state.startsWith("author_language_")
      )
    ) {
      const text = ctx.message.text.trim();

      if (text.toLowerCase() === "отмена") {
        await clearProviderServiceDraft(ctx);
        resetServiceWizard(ctx);
        await ctx.reply("❌ Создание услуги отменено.");
        await ctx.reply("🧳 Выберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        });
        return;
      }

      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      const draft = ctx.session.serviceDraft;

      try {
        switch (state) {
        case "svc_author_title": {
          const v = normReq(text);
          if (v) draft.title = v;

          pushWizardState(ctx, "svc_author_title");
          ctx.session.state = "svc_author_country";
          await promptWizardState(ctx, "svc_author_country");
          return;
        }

        case "svc_author_country": {
          const v = await requireTextField(ctx, text, "Страна / направление", { min: 2 });
          if (!v) return;
          draft.country = v;

          pushWizardState(ctx, "svc_author_country");
          ctx.session.state = "svc_author_from";
          await promptWizardState(ctx, "svc_author_from");
          return;
        }

        case "svc_author_from": {
          const v = await requireTextField(ctx, text, "Город отправления / старт", { min: 2 });
          if (!v) return;
          draft.fromCity = v;

          pushWizardState(ctx, "svc_author_from");
          ctx.session.state = "svc_author_to";
          await promptWizardState(ctx, "svc_author_to");
          return;
        }

        case "svc_author_to": {
          const v = await requireTextField(ctx, text, "Маршрут / город прибытия", { min: 2 });
          if (!v) return;
          draft.toCity = v;

          pushWizardState(ctx, "svc_author_to");
          ctx.session.state = "svc_author_start";
          await promptWizardState(ctx, "svc_author_start");
          return;
        }

        case "svc_author_start": {
          const norm = normalizeAuthorDateInput(text);
          if (!norm) {
            await ctx.reply("😕 Не понял дату начала.\nВведите в формате *29.05.2026*.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          draft.flexibleDates = false;
          draft.startDate = norm;

          pushWizardState(ctx, "svc_author_start");
          ctx.session.state = "svc_author_end";
          await promptWizardState(ctx, "svc_author_end");
          return;
        }

        case "svc_author_end": {
          const norm = normalizeAuthorDateInput(text);
          if (!norm) {
            await ctx.reply("😕 Не понял дату окончания.\nВведите в формате *05.06.2026*.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату окончания.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          if (draft.startDate && isBeforeYMD(norm, draft.startDate)) {
            await ctx.reply("⚠️ Дата окончания раньше даты начала. Укажите корректную дату.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          draft.endDate = norm;
          Object.assign(draft, calcAuthorDuration(draft.startDate, draft.endDate));

          pushWizardState(ctx, "svc_author_end");
          ctx.session.state = "svc_author_format";
          await promptWizardState(ctx, "svc_author_format");
          return;
        }

        case "svc_author_format": {
          const raw = String(text || "").trim().toLowerCase();
          const map = {
            group: "group",
            private: "private",
            custom: "custom",
            "групповой": "group",
            "индивидуальный": "private",
            "приватный": "private",
            "под запрос": "custom",
            "индивидуально": "private",
          };
          draft.tourFormat = map[raw] || raw || "group";

          pushWizardState(ctx, "svc_author_format");
          ctx.session.state = "svc_author_stays";
          await promptWizardState(ctx, "svc_author_stays");
          return;
        }

          case "svc_author_stays": {
            await ctx.reply(
              "🏨 Используйте кнопки ниже: добавьте проживание или продолжите дальше.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "➕ Добавить проживание", callback_data: "author_stay:add" }],
                    [{ text: "✅ Продолжить", callback_data: "author_stay:done" }],
                    [
                      { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                      { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
                    ],
                  ],
                },
              }
            );
            return;
          }

            case "author_stay_city": {
              draft._stayCity = text;
            
              ctx.session.state = "author_stay_hotel";

              await persistProviderCreateWizard(ctx);
            
              await ctx.reply(
                "🏨 Укажите отель\n\nНапример:\nKar Hotel"
              );
              return;
            }
            
            case "author_stay_hotel": {
              draft._stayHotel = text;
            
              ctx.session.state = "author_stay_nights";

              await persistProviderCreateWizard(ctx);
            
              await ctx.reply(
                "🌙 Количество ночей\n\nНапример:\n2"
              );
              return;
            }
            
            case "author_stay_nights": {
              const nights =
                Number(String(text).replace(/[^\d]/g, "")) || 1;
            
              if (!draft.stays)
                draft.stays = [];
            
              draft.stays.push({
                city: draft._stayCity,
                hotel: draft._stayHotel,
                nights,
              });
            
              delete draft._stayCity;
              delete draft._stayHotel;
              
              ctx.session.state = "svc_author_stays";
              
              await persistProviderCreateWizard(ctx);
              
              const rows = draft.stays.map(
                (x, i) =>
                  `${i + 1}. ${x.city} — ${x.hotel} — ${x.nights} ноч.`
              );
            
              await ctx.reply(
                `🏨 Проживание\n\n${rows.join("\n")}`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "➕ Добавить ещё",
                          callback_data: "author_stay:add",
                        },
                      ],
                      [
                        {
                          text: "✅ Продолжить",
                          callback_data: "author_stay:done",
                        },
                      ],
                    ],
                  },
                }
              );
            
              return;
            }
          
          case "author_day_date": {
            const norm = normalizeAuthorDateInput(text);
            if (!norm) {
              await ctx.reply("😕 Не понял дату. Введите в формате *29.05.2026*.", {
                parse_mode: "Markdown",
                ...authorDayNavKeyboard({ skip: true }),
              });
              return;
            }

            draft._programDayDate = formatAuthorDateDMY(norm);
            ctx.session.state = "author_day_route";

            await persistProviderCreateWizard(ctx);

            await promptWizardState(ctx, "author_day_route");
            return;
          }

          case "author_day_route": {
            const v = await requireTextField(ctx, text, "Маршрут / локация дня", { min: 2 });
            if (!v) return;

            draft._programDayRoute = v;
            ctx.session.state = "author_day_title";

            await persistProviderCreateWizard(ctx);

            await promptWizardState(ctx, "author_day_title");
            return;
          }

          case "author_day_title": {
            const v = await requireTextField(ctx, text, "Заголовок дня", { min: 2 });
            if (!v) return;

            draft._programDayTitle = v;
            ctx.session.state = "author_day_items";

            await persistProviderCreateWizard(ctx);

            await promptWizardState(ctx, "author_day_items");
            return;
          }

          case "author_day_items": {
            const items = parseAuthorDayItemsInput(text);

            if (!items.length) {
              await ctx.reply(
                "😕 Добавьте хотя бы один пункт программы.\n\nПример:\nВстреча в аэропорту; Трансфер; Размещение в отеле",
                authorDayNavKeyboard({ skip: false })
              );
              return;
            }

            if (!draft.programDays) draft.programDays = [];

            const dayNumber = draft.programDays.length + 1;

            draft.programDays.push({
              day: dayNumber,
              date: draft._programDayDate,
              route: draft._programDayRoute,
              title: draft._programDayTitle,
              items,
              text: items.join("\n"),
            });

            draft.programDaysText = draft.programDays
              .map((d) => `${d.day} | ${d.date || ""} | ${d.route || ""} | ${d.title || ""} | ${(d.items || []).join("; ")}`)
              .join("\n");
            draft.program = draft.programDaysText;

            delete draft._programDayDate;
            delete draft._programDayRoute;
            delete draft._programDayTitle;

            ctx.session.state = "svc_author_program_days";

            await persistProviderCreateWizard(ctx);

            const rows = draft.programDays.map((d) => {
              const title = d.title ? ` — ${d.title}` : "";
              const route = d.route ? `\n   🛫 ${d.route}` : "";
              return `${d.day}. ${d.date || "без даты"}${title}${route}`;
            });

            await ctx.reply(
              `🗓 Программа тура\n\n${rows.join("\n\n")}`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "➕ Добавить ещё день", callback_data: "author_day:add" }],
                    [{ text: "✅ Продолжить", callback_data: "author_day:done" }],
                    [
                      { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                      { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
                    ],
                  ],
                },
              }
            );

            return;
          }

          case "svc_author_program_days": {
            await ctx.reply(
              "🗓 Используйте кнопки ниже: добавьте день программы или продолжите дальше.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "➕ Добавить день программы", callback_data: "author_day:add" }],
                    [{ text: "✅ Продолжить", callback_data: "author_day:done" }],
                    [
                      { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                      { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
                    ],
                  ],
                },
              }
            );
            return;
          }

        case "svc_author_included": {
          await ctx.reply(
            "✅ Используйте кнопки ниже: выберите пункты, добавьте свой пункт или нажмите «Продолжить».",
            {
              reply_markup: {
                inline_keyboard: buildAuthorIncludedKeyboard(draft.included),
              },
            }
          );
          return;
        }

        case "author_included_custom": {
          const custom = normReq(text);
          if (!custom) {
            await ctx.reply("⚠️ Введите пункт, который включён в стоимость.", { ...wizNavKeyboard() });
            return;
          }

          draft.included = toggleAuthorListItem(draft.included, custom);
          ctx.session.state = "svc_author_included";
          await replyAuthorIncludedBuilder(ctx);
          return;
        }

        case "svc_author_not_included": {
          await ctx.reply(
            "➖ Используйте кнопки ниже: выберите пункты, добавьте свой пункт или продолжите дальше.",
            {
              reply_markup: {
                inline_keyboard: buildAuthorExcludedKeyboard(draft.notIncluded),
              },
            }
          );
          return;
        }

        case "author_excluded_custom": {
          const custom = normReq(text);
          if (!custom) {
            await ctx.reply("⚠️ Введите пункт, который не включён в стоимость.", { ...wizNavKeyboard() });
            return;
          }

          draft.notIncluded = toggleAuthorListItem(draft.notIncluded, custom);
          ctx.session.state = "svc_author_not_included";
          await replyAuthorExcludedBuilder(ctx);
          return;
        }

        case "svc_author_pax": {
          const raw = String(text || "").trim();
          const m = raw.match(/(\d+)\D+(\d+)/);
          if (!m) {
            await ctx.reply("⚠️ Укажите минимум/максимум человек в формате `2/10`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          const minPax = Number(m[1]);
          const maxPax = Number(m[2]);
          if (!Number.isFinite(minPax) || !Number.isFinite(maxPax) || minPax <= 0 || maxPax < minPax) {
            await ctx.reply("⚠️ Некорректное количество человек. Пример: `2/16`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          draft.minPax = minPax;
          draft.maxPax = maxPax;

          pushWizardState(ctx, "svc_author_pax");
          ctx.session.state = "svc_author_language";
          await promptWizardState(ctx, "svc_author_language");
          return;
        }

        case "svc_author_language": {
          const v = await requireTextField(ctx, text, "Язык гида", { min: 2 });
          if (!v) return;

          draft.languages = Array.isArray(draft.languages) ? draft.languages : [];
          if (!draft.languages.includes(v)) draft.languages.push(v);
          draft.guideLanguage = draft.languages.join(", ");
          draft.language = draft.guideLanguage;

          pushWizardState(ctx, "svc_author_language");
          ctx.session.state = "svc_author_meeting";
          await promptWizardState(ctx, "svc_author_meeting");
          return;
        }

        case "author_language_custom": {
          const v = await requireTextField(ctx, text, "Язык гида", { min: 2 });
          if (!v) return;

          draft.languages = Array.isArray(draft.languages) ? draft.languages : [];
          if (!draft.languages.includes(v)) draft.languages.push(v);
          draft.guideLanguage = draft.languages.join(", ");
          draft.language = draft.guideLanguage;

          ctx.session.state = "svc_author_language";
          await promptWizardState(ctx, "svc_author_language");
          await persistProviderCreateWizard(ctx);
          return;
        }

                case "svc_author_meeting": {
          const v = await requireTextField(ctx, text, "Место встречи", { min: 2 });
          if (!v) return;
          draft.meetingPoint = v;

          pushWizardState(ctx, "svc_author_meeting");
          ctx.session.state = "svc_author_cancel";
          await promptWizardState(ctx, "svc_author_cancel");
          return;
        }

        case "svc_author_cancel": {
          const low = String(text || "").trim().toLowerCase();
          draft.cancellationPolicy = ["пропустить", "skip", "-", "нет"].includes(low) ? "" : normReq(text);
          draft.cancelPolicy = draft.cancellationPolicy;

          pushWizardState(ctx, "svc_author_cancel");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;
        }

    case "svc_create_title": {
          const v = await requireTextField(ctx, text, "Название", { min: 2 });
          if (!v) return;
          draft.title = v;
        
          pushWizardState(ctx, "svc_create_title");
          ctx.session.state = "svc_create_tour_country";
          await promptWizardState(ctx, "svc_create_tour_country");
          return;
        }

        case "svc_create_tour_country": {
          const v = await requireTextField(ctx, text, "Страна", { min: 2 });
          if (!v) return;
          draft.country = v;
        
          pushWizardState(ctx, "svc_create_tour_country");
          ctx.session.state = "svc_create_tour_from";
          await promptWizardState(ctx, "svc_create_tour_from");
          return;
        }

        case "svc_create_tour_from": {
          const v = await requireTextField(ctx, text, "Город вылета", { min: 2 });
          if (!v) return;
          draft.fromCity = v;
        
          pushWizardState(ctx, "svc_create_tour_from");
          ctx.session.state = "svc_create_tour_to";
          await promptWizardState(ctx, "svc_create_tour_to");
          return;
        }
          
        case "svc_create_tour_to": {
          const v = await requireTextField(ctx, text, "Город прибытия", { min: 2 });
          if (!v) return;
          draft.toCity = v;
        
          pushWizardState(ctx, "svc_create_tour_to");
        
          const cat = String(draft.category || "");
          if (cat === "refused_flight") {
            ctx.session.state = "svc_create_flight_departure";
            await promptWizardState(ctx, "svc_create_flight_departure");
            return;
          }
        
          ctx.session.state = "svc_create_tour_start";
          await promptWizardState(ctx, "svc_create_tour_start");
          return;
        }

        case "svc_create_tour_start": {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату начала.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD*, например *2025-12-09*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.startDate = norm;
          pushWizardState(ctx, "svc_create_tour_start");
          ctx.session.state = "svc_create_tour_end";
          await promptWizardState(ctx, "svc_create_tour_end");
          return;
        }

        case "svc_create_tour_end": {
          const normEnd = normalizeDateInput(text);
          if (!normEnd) {
            await ctx.reply("😕 Не понял дату окончания. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.startDate && isBeforeYMD(normEnd, draft.startDate)) {
            await ctx.reply(
              "⚠️ Дата окончания раньше даты начала.\n" +
                `Начало: ${draft.startDate}\nУкажите корректную дату окончания.`,
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(normEnd)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату окончания.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.endDate = normEnd;
          pushWizardState(ctx, "svc_create_tour_end");
          ctx.session.state = "svc_create_flight_departure";
          await promptWizardState(ctx, "svc_create_flight_departure");
          return;
        }

        case "svc_create_flight_departure": {
          const low = text.toLowerCase();
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.departureFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_departure");
            ctx.session.state = "svc_create_flight_return";
            await promptWizardState(ctx, "svc_create_flight_return");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса вылета.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или нажмите «⏭ Пропустить».",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или нажмите «⏭ Пропустить».", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.departureFlightDate = norm;
          pushWizardState(ctx, "svc_create_flight_departure");
          ctx.session.state = "svc_create_flight_return";
          await promptWizardState(ctx, "svc_create_flight_return");
          return;
        }

        case "svc_create_flight_return": {
          const low = text.toLowerCase();
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.returnFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_return");
            ctx.session.state = "svc_create_flight_details";
            await promptWizardState(ctx, "svc_create_flight_details");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса обратно.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или нажмите «⏭ Пропустить».",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или нажмите «⏭ Пропустить».", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.departureFlightDate && isBeforeYMD(norm, draft.departureFlightDate)) {
            await ctx.reply(
              "⚠️ Дата рейса обратно раньше даты вылета.\n" +
                `Вылет: ${draft.departureFlightDate}\nУкажите корректную дату обратно или нажмите «⏭ Пропустить».`,
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          draft.returnFlightDate = norm;
          pushWizardState(ctx, "svc_create_flight_return");
          ctx.session.state = "svc_create_flight_details";
          await promptWizardState(ctx, "svc_create_flight_details");
          return;
        }

        case "svc_create_flight_details": {
          const low = text.toLowerCase();
          draft.flightDetails = ["пропустить", "skip", "-", "нет"].includes(low) ? null : text;
          pushWizardState(ctx, "svc_create_flight_details");
        
          const cat = String(ctx.session?.serviceDraft?.category || "");
          if (cat === "refused_flight") {
            ctx.session.state = "svc_create_price";
            await promptWizardState(ctx, "svc_create_price");
          } else {
            ctx.session.state = "svc_create_tour_hotel";
            await promptWizardState(ctx, "svc_create_tour_hotel");
          }
          return;
        }

        case "svc_ticket_event_date": {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply("😕 Не понял дату мероприятия. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.eventDate = norm;
          draft.startDate = norm;
          pushWizardState(ctx, "svc_ticket_event_date");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;
        }

        case "svc_create_tour_hotel":
          draft.hotel = text;
          pushWizardState(ctx, "svc_create_tour_hotel");
          ctx.session.state = "svc_create_tour_accommodation";
          await promptWizardState(ctx, "svc_create_tour_accommodation");
          return;

        case "svc_create_tour_accommodation": {
          const v = await requireTextField(ctx, text, "Размещение", { min: 1 });
          if (!v) return;
          draft.accommodation = v;
        
          pushWizardState(ctx, "svc_create_tour_accommodation");
          ctx.session.state = "svc_create_tour_roomcat";
          await promptWizardState(ctx, "svc_create_tour_roomcat");
          return;
        }

        case "svc_create_tour_roomcat": {
          const low = text.toLowerCase();
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.roomCategory = "";
            pushWizardState(ctx, "svc_create_tour_roomcat");
            ctx.session.state = "svc_create_tour_food";
            await promptWizardState(ctx, "svc_create_tour_food");
            return;
          }
        
          const v = await requireTextField(ctx, text, "Категория номера", { min: 1 });
          if (!v) return;
          draft.roomCategory = v;
        
          pushWizardState(ctx, "svc_create_tour_roomcat");
          ctx.session.state = "svc_create_tour_food";
          await promptWizardState(ctx, "svc_create_tour_food");
          return;
        }
        
        case "svc_create_tour_food": {
          const low = text.toLowerCase();
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.food = "";
            pushWizardState(ctx, "svc_create_tour_food");
            ctx.session.state = "svc_create_price";
            await promptWizardState(ctx, "svc_create_price");
            return;
          }
        
          const v = await requireTextField(ctx, text, "Питание", { min: 1 });
          if (!v) return;
          draft.food = v;
        
          pushWizardState(ctx, "svc_create_tour_food");
          ctx.session.state = "svc_create_tour_insurance";
          await promptWizardState(ctx, "svc_create_tour_insurance");
          return;
        }
          
        case "svc_create_tour_insurance": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.insuranceIncluded = yn;
          pushWizardState(ctx, "svc_create_tour_insurance");
          ctx.session.state = "svc_create_tour_early_checkin";
          await promptWizardState(ctx, "svc_create_tour_early_checkin");
          return;
        }
        
        case "svc_create_tour_early_checkin": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.earlyCheckIn = yn;
          pushWizardState(ctx, "svc_create_tour_early_checkin");
          ctx.session.state = "svc_create_tour_fast_track";
          await promptWizardState(ctx, "svc_create_tour_fast_track");
          return;
        }
        
        case "svc_create_tour_fast_track": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.arrivalFastTrack = yn;
          pushWizardState(ctx, "svc_create_tour_fast_track");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;
        }
        // ===== HOTEL FLOW =====
        case "svc_hotel_country": {
          const v = await requireTextField(ctx, text, "Страна", { min: 2 });
          if (!v) return;
          draft.country = v;
        
          pushWizardState(ctx, "svc_hotel_country");
          ctx.session.state = "svc_hotel_city";
          await promptWizardState(ctx, "svc_hotel_city");
          return;
        }
        
        case "svc_hotel_city": {
          const v = await requireTextField(ctx, text, "Город", { min: 2 });
          if (!v) return;
          draft.toCity = v;
        
          pushWizardState(ctx, "svc_hotel_city");
          ctx.session.state = "svc_hotel_name";
          await promptWizardState(ctx, "svc_hotel_name");
          return;
        }

        case "svc_hotel_name":
          draft.hotel = text;
          pushWizardState(ctx, "svc_hotel_name");
          ctx.session.state = "svc_hotel_checkin";
          await promptWizardState(ctx, "svc_hotel_checkin");
          return;

        case "svc_hotel_checkin": {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply("😕 Не понял дату заезда. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата в прошлом. Укажите будущую дату заезда.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.startDate = norm;
          pushWizardState(ctx, "svc_hotel_checkin");
          ctx.session.state = "svc_hotel_checkout";
          await promptWizardState(ctx, "svc_hotel_checkout");
          return;
        }

        case "svc_hotel_checkout": {
          const normEnd = normalizeDateInput(text);
          if (!normEnd) {
            await ctx.reply("😕 Не понял дату выезда. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.startDate && isBeforeYMD(normEnd, draft.startDate)) {
            await ctx.reply(
              "⚠️ Дата выезда раньше даты заезда.\n" +
                `Заезд: ${draft.startDate}\nУкажите корректную дату выезда.`,
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(normEnd)) {
            await ctx.reply("⚠️ Эта дата в прошлом. Укажите будущую дату выезда.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.endDate = normEnd;
          pushWizardState(ctx, "svc_hotel_checkout");
          ctx.session.state = "svc_hotel_roomcat";
          await promptWizardState(ctx, "svc_hotel_roomcat");
          return;
        }

        case "svc_hotel_roomcat":
          draft.roomCategory = text;
          pushWizardState(ctx, "svc_hotel_roomcat");
          ctx.session.state = "svc_hotel_accommodation";
          await promptWizardState(ctx, "svc_hotel_accommodation");
          return;

        case "svc_hotel_accommodation":
          draft.accommodation = text;
          pushWizardState(ctx, "svc_hotel_accommodation");
          ctx.session.state = "svc_hotel_food";
          await promptWizardState(ctx, "svc_hotel_food");
          return;

        case "svc_hotel_food":
          draft.food = text;
          pushWizardState(ctx, "svc_hotel_food");
          ctx.session.state = "svc_hotel_halal";
          await promptWizardState(ctx, "svc_hotel_halal");
          return;

        case "svc_hotel_halal": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.halal = yn;
          pushWizardState(ctx, "svc_hotel_halal");
          ctx.session.state = "svc_hotel_transfer";
          await promptWizardState(ctx, "svc_hotel_transfer");
          return;
        }

        case "svc_hotel_transfer":
          draft.transfer = text;
          pushWizardState(ctx, "svc_hotel_transfer");
          ctx.session.state = "svc_hotel_changeable";
          await promptWizardState(ctx, "svc_hotel_changeable");
          return;

        case "svc_hotel_changeable": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.changeable = yn;
          pushWizardState(ctx, "svc_hotel_changeable");
          ctx.session.state = "svc_hotel_pax";
          await promptWizardState(ctx, "svc_hotel_pax");
          return;
        }

        case "svc_hotel_pax": {
          const pax = parsePaxTriple(text);
          if (!pax) {
            await ctx.reply(
              "😕 Не понял формат. Введите строго *ADT/CHD/INF*, например *2/1/0*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          draft.adt = pax.adt;
          draft.chd = pax.chd;
          draft.inf = pax.inf;
          pushWizardState(ctx, "svc_hotel_pax");
          ctx.session.state = "svc_hotel_insurance";
          await promptWizardState(ctx, "svc_hotel_insurance");
          return;
        }

        case "svc_hotel_insurance": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.insuranceIncluded = yn;
          pushWizardState(ctx, "svc_hotel_insurance");
          ctx.session.state = "svc_hotel_early_checkin";
          await promptWizardState(ctx, "svc_hotel_early_checkin");
          return;
        }
        
        case "svc_hotel_early_checkin": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.earlyCheckIn = yn;
          pushWizardState(ctx, "svc_hotel_early_checkin");
          ctx.session.state = "svc_hotel_fast_track";
          await promptWizardState(ctx, "svc_hotel_fast_track");
          return;
        }
        
        case "svc_hotel_fast_track": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.arrivalFastTrack = yn;
          pushWizardState(ctx, "svc_hotel_fast_track");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;
        }
        case "svc_create_price":
          draft.price = text;
          pushWizardState(ctx, "svc_create_price");
          ctx.session.state = "svc_create_grossPrice";
          await promptWizardState(ctx, "svc_create_grossPrice");
          return;

        case "svc_create_grossPrice": {
          const lower = text.trim().toLowerCase();
          draft.grossPrice = lower === "пропустить" || lower === "нет" ? null : text;
          pushWizardState(ctx, "svc_create_grossPrice");
          ctx.session.state = "svc_create_urgency";
          await promptWizardState(ctx, "svc_create_urgency");
          return;
        }

        case "svc_create_urgency": {
          const lower = text.trim().toLowerCase();
          if (/сроч|urgent|сегодня|крас/i.test(lower)) draft.urgency = "urgent";
          else if (/1|3|дн|soon|скоро|оранж/i.test(lower)) draft.urgency = "soon";
          else if (/нет|обыч|normal|не сроч|зел/i.test(lower)) draft.urgency = "normal";
          else {
            await ctx.reply("Выберите срочность кнопкой ниже 👇", { parse_mode: "HTML", ...buildUrgencyKeyboard() });
            return;
          }
          pushWizardState(ctx, "svc_create_urgency");
          ctx.session.state = "svc_create_expiration";
          await promptWizardState(ctx, "svc_create_expiration");
          return;
        }

        case "svc_create_expiration": {
          const lower = text.trim().toLowerCase();
          // строгая проверка, чтобы не пропускать "2026.29.01" и похожие
          const normExp = normalizeDateTimeInputStrict(text);

          if (normExp === null && lower !== "нет") {
            await ctx.reply(
              "😕 Не понял дату актуальности.\nВведите *YYYY-MM-DD HH:mm* или *YYYY.MM.DD HH:mm* или `нет`.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }

          if (normExp && isPastDateTime(normExp)) {
            await ctx.reply("⚠️ Дата актуальности уже в прошлом. Укажите будущую или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          if (normExp && isExpirationAfterTripStart(draft, normExp)) {
            await ctx.reply(
              "⚠️ Срок актуальности не может быть позже даты начала тура / вылета.\n" +
                "Укажите дату и время до начала услуги или напишите `нет`.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }

          draft.expiration = normExp;
          pushWizardState(ctx, "svc_create_expiration");
          ctx.session.state = "svc_create_photo";
          await promptWizardState(ctx, "svc_create_photo");
          return;
        }

        case "svc_create_photo":
          if (text.trim().toLowerCase() === "пропустить") {
            draft.images = [];
            await finishCreateServiceFromWizard(ctx);
            return;
          }
          await ctx.reply("🖼 Отправьте фото сообщением (как картинку) или нажмите «⏭ Пропустить».", {
            parse_mode: "Markdown",
            ...wizNavKeyboard(),
          });
          return;

        default:
          break;
        }
      } finally {
        await persistProviderCreateWizard(ctx);
      }
    }
  } catch (e) {
    console.error("[tg-bot] error handling text:", e);
    try {
      await ctx.reply(
        "⚠️ Произошла ошибка.\nПопробуйте ещё раз или начните заново через «🧳 Мои услуги» → «➕ Создать услугу»."
      );
    } catch (_) {}
  }

  return next();
});

/* ===================== PHOTO HANDLER (wizard create) ===================== */

bot.on("photo", async (ctx, next) => {
  try {
    // 0) Фото-подтверждения для уже созданной refused-услуги
    const proofServiceId = ctx.session?.awaitingProofForServiceId;
    if (proofServiceId) {
      const photos = ctx.message?.photo;
      const best = Array.isArray(photos) && photos.length
        ? photos[photos.length - 1]
        : null;
      const fileId = best?.file_id;

      if (!fileId) {
        await safeReply(ctx, "⚠️ Не удалось получить file_id. Отправьте скриншот ещё раз.");
        return;
      }

      // 🔥 конвертация Telegram file_id → data:image
      let proofDataUrl = null;
      try {
        const link = await bot.telegram.getFileLink(fileId);
        const url = String(link || "").trim();

        const r = await axiosBase.get(url, {
          responseType: "arraybuffer",
          timeout: 15000,
        });

        const buf = Buffer.from(r.data);
        if (!buf.length || buf.length > 6 * 1024 * 1024) {
          throw new Error("file too large or empty");
        }

        let mime = "image/jpeg";
        try {
          const pathname = new URL(url).pathname || "";
          if (pathname.endsWith(".png")) mime = "image/png";
          else if (pathname.endsWith(".webp")) mime = "image/webp";
          else if (pathname.endsWith(".gif")) mime = "image/gif";
        } catch {}

        proofDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      } catch (e) {
        console.error("[tg] proof convert error:", e);
        await safeReply(
          ctx,
          "⚠️ Не удалось обработать скриншот. Попробуйте отправить другое изображение."
        );
        return;
      }

      const svcRes = await pool.query(
        `
          SELECT id, details
            FROM services
           WHERE id = $1
           LIMIT 1
        `,
        [proofServiceId]
      );

      if (!svcRes.rows.length) {
        await safeReply(ctx, "⚠️ Услуга для привязки скриншотов не найдена.");
        return;
      }

      const currentDetails =
        svcRes.rows[0].details && typeof svcRes.rows[0].details === "object"
          ? svcRes.rows[0].details
          : {};

      const proofImages = Array.isArray(currentDetails.proofImages)
        ? currentDetails.proofImages.filter(Boolean)
        : [];

      proofImages.push(proofDataUrl);

      const nextDetails = {
        ...currentDetails,
        proofImages,
      };

      await pool.query(
        `
          UPDATE services
             SET details = $1::jsonb,
                 updated_at = NOW()
           WHERE id = $2
        `,
        [JSON.stringify(nextDetails), proofServiceId]
      );

      await trackProviderFunnelFromBot(ctx, "proof_uploaded", {
        serviceId: proofServiceId,
        status: "proof_uploaded",
        meta: { proof_count: proofImages.length },
      });

      await safeReply(
        ctx,
        `📎 Доказательство загружено.\nСейчас загружено: ${proofImages.length} шт.\n\nПроверьте материалы и отправьте услугу на модерацию.`,
        buildProofKeyboard(proofServiceId, proofImages.length)
      );
      return;
    }

    // 1) Фото в режиме редактирования изображений услуги
    if (await handleSvcEditWizardPhoto(ctx)) return;

    // 1b) Старый режим редактирования
    const legacyState = ctx.session?.state;
    const legacyDraft = ctx.session?.serviceDraft;

    if (legacyState === "svc_edit_images" && legacyDraft) {
      const photos = ctx.message?.photo;
      const best = Array.isArray(photos) && photos.length
        ? photos[photos.length - 1]
        : null;
      const fileId = best?.file_id;

      if (!fileId) {
        await safeReply(ctx, "⚠️ Не удалось получить file_id. Отправьте фото ещё раз.");
        return;
      }

      const tgRef = `tg:${fileId}`;
      if (!Array.isArray(legacyDraft.images)) legacyDraft.images = [];
      legacyDraft.images.push(tgRef);

      await safeReply(
        ctx,
        `✅ Фото добавлено. Сейчас в услуге: ${legacyDraft.images.length} шт.\n\nОтправьте ещё фото или нажмите «✅ Готово».`,
        buildEditImagesKeyboard(legacyDraft)
      );
      return;
    }

    // 2) Фото в мастере создания услуги
    const state = ctx.session?.state;
    const draft = ctx.session?.serviceDraft;

    const wizStep = ctx.session?.wiz?.step;
    const isCreatePhotoStep =
      state === "svc_create_photo" || wizStep === "create_images";

    if (!isCreatePhotoStep || !draft) return next();

    const photos = ctx.message?.photo;
    const best = Array.isArray(photos) && photos.length
      ? photos[photos.length - 1]
      : null;
    const fileId = best?.file_id;

    if (!fileId) {
      await safeReply(ctx, "⚠️ Не удалось получить file_id. Отправьте фото ещё раз.");
      return;
    }

    const tgRef = `tg:${fileId}`;
    if (!Array.isArray(draft.images)) draft.images = [];
    draft.images.push(tgRef);
    draft.telegramPhotoFileId = fileId;

    if (state === "svc_create_photo") {
      await persistProviderCreateWizard(ctx);
      await safeReply(
        ctx,
        `✅ Фото добавлено. Сейчас выбрано: ${draft.images.length} шт.\n\nОтправьте ещё фото или нажмите «✅ Готово».`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧹 Очистить фото", callback_data: "svc_photo:clear" }],
              [{ text: "✅ Завершить фото", callback_data: "svc_photo:done" }],
              [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
              [
                { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
                { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
              ],
            ],
          },
        }
      );
      return;
    }

    await persistProviderCreateWizard(ctx);

    await safeReply(
      ctx,
      `✅ Фото добавлено. Сейчас выбрано: ${draft.images.length} шт.`
    );
  } catch (e) {
    console.error("photo handler error:", e);
    await safeReply(
      ctx,
      "⚠️ Ошибка при обработке фото. Попробуйте ещё раз."
    );
  }
});

async function finishProofSubmissionFromBot(ctx) {
  try {
    const serviceId = Number(ctx.session?.awaitingProofForServiceId || 0);
    if (!serviceId) return;

    const svcRes = await pool.query(
      `
        SELECT id, details
          FROM services
         WHERE id = $1
         LIMIT 1
      `,
      [serviceId]
    );

    if (!svcRes.rows.length) {
      ctx.session.awaitingProofForServiceId = null;
      ctx.session.awaitingProofForCategory = null;

      await safeReply(
        ctx,
        "⚠️ Услуга для подтверждения не найдена. Создайте услугу заново."
      );
      return;
    }

    const details =
      svcRes.rows[0].details && typeof svcRes.rows[0].details === "object"
        ? svcRes.rows[0].details
        : {};

    const proofImages = Array.isArray(details.proofImages)
      ? details.proofImages.filter(Boolean)
      : [];

    if (proofImages.length === 0) {
      await safeReply(
        ctx,
        "⚠️ Сначала отправьте хотя бы один скриншот, подтверждающий подлинность брони."
      );
      return;
    }

    const chatId = getActorId(ctx);
    if (!chatId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя. Попробуйте ещё раз.");
      return;
    }

    const { data } = await axios.post(
      `/api/telegram/provider/${chatId}/services/${serviceId}/submit`
    );

    if (!data || data.success === false) {
      await safeReply(
        ctx,
        "⚠️ Не удалось отправить услугу на модерацию. Попробуйте позже."
      );
      return;
    }

    await trackProviderFunnelFromBot(ctx, "submitted_to_moderation", {
      serviceId,
      status: "pending",
      meta: { proof_required: true },
    });

    ctx.session.awaitingProofForServiceId = null;
    ctx.session.awaitingProofForCategory = null;

    await safeReply(
      ctx,
      `📨 Услуга #${serviceId} отправлена на модерацию.\n\n` +
        `Статус: ⏳ На модерации\n` +
        `Доказательства подлинности прикреплены.\n\n` +
        `После одобрения объявление появится в Travella, маркетплейсе и Telegram-поиске.`
    );

    await safeReply(ctx, "Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });

    await replyProviderSupportPrompt(ctx, serviceId);
  } catch (e) {
    console.error("[tg-bot] proof done error:", e?.response?.data || e);
    await safeReply(
      ctx,
      "⚠️ Ошибка при завершении отправки на модерацию. Попробуйте ещё раз."
    );
  }
}

bot.action("proof:submit", async (ctx) => {
  await safeCb(ctx, "Отправляем на модерацию…");
  await finishProofSubmissionFromBot(ctx);
});

bot.action("proof:add_more", async (ctx) => {
  const serviceId = Number(ctx.session?.awaitingProofForServiceId || 0);
  const count = serviceId ? (await getProofImagesForService(serviceId)).length : 0;
  await safeCb(ctx, "Отправьте следующий скриншот сюда в чат");
  await safeReply(
    ctx,
    `📎 Отправьте ещё скриншот / ваучер / билет сюда в чат.\n\nСейчас загружено: ${count}.`,
    buildProofKeyboard(serviceId, count)
  );
});


bot.action(/^proof:card:(\d+)$/, async (ctx) => {
  await safeCb(ctx);
  await sendProofCardPreview(ctx, Number(ctx.match[1]));
});

bot.action(/^proof:view:(\d+)$/, async (ctx) => {
  await safeCb(ctx, "Показываю доказательства");
  await sendProofPreview(ctx, Number(ctx.match[1]));
});

bot.action("proof:delete_last", async (ctx) => {
  await safeCb(ctx, "Удаляю последнее доказательство…");
  await deleteLastProofImage(ctx);
});

bot.action("proof:cancel", async (ctx) => {
  await safeCb(ctx, "Отправка отменена");
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingProofForServiceId = null;
  ctx.session.awaitingProofForCategory = null;
  await safeReply(ctx, "❌ Отправка на модерацию отменена. Услуга сохранена как черновик/ожидающая подтверждения.");
});

bot.hears(/^(готово|done)$/i, async (ctx) => {
  await finishProofSubmissionFromBot(ctx);
});

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const qRaw = ctx.inlineQuery?.query || "";
    const q = String(qRaw).trim().toLowerCase();

    // ✅ "#tour refused_tour" или "#my refused_tour"
    const parts = q.split(/\s+/).filter(Boolean);
    const tag = parts[0] || "";
    const tokenCat = parts[1] || "";
    const isMy = tag === "#my";

    let category = "refused_tour";
    if (REFUSED_CATEGORIES.includes(tokenCat)) {
      category = tokenCat;
    } else {
      if (q.startsWith("#hotel")) category = "refused_hotel";
      else if (q.startsWith("#flight")) category = "refused_flight";
      else if (q.startsWith("#ticket")) category = "refused_ticket";
      else if (q.startsWith("#author") || q.startsWith("#custom")) category = "author_tour";
      else if (q.startsWith("#tour")) category = "refused_tour";
      else {
        if (q.includes("отель") || q.includes("hotel")) category = "refused_hotel";
        else if (q.includes("авиа") || q.includes("flight") || q.includes("avia")) category = "refused_flight";
        else if (q.includes("билет") || q.includes("ticket")) category = "refused_ticket";
        else if (q.includes("автор") || q.includes("author") || q.includes("custom") || q.includes("маршрут")) category = "author_tour";
        else category = "refused_tour";
      }
    }

    const userId = ctx.from.id;

    // роль для inline
    const roleForInline = await resolveRoleByUserId(userId, ctx);

    // Требуем привязку аккаунта
    if (!roleForInline) {
      await ctx.answerInlineQuery([], {
        cache_time: 0,
        is_personal: true,
        switch_pm_text: "🔐 Сначала привяжите аккаунт (номер телефона)",
        switch_pm_parameter: "start",
      });
      return;
    }

    // "Мои услуги" только провайдеру
    if (isMy && roleForInline !== "provider") {
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "🧳 Мои услуги доступны поставщикам. Открыть бота",
        switch_pm_parameter: "start",
      });
      return;
    }

    // === PAGINATION (Telegram offset) ===
    const offset = Number(String(ctx.inlineQuery?.offset || "0").trim() || 0) || 0;
    const pageSize = 10;
    const maxBuild = 50;

    // === UNLOCK STAMP (чтобы results-кэш не залипал после оплаты) ===
    let clientRowInline = null;
    let unlockStamp = 0;

    // ВАЖНО: считаем только для client-search (не #my)
    if (!isMy && roleForInline === "client") {
      clientRowInline = await getClientRowByChatId(pool, userId);
      if (clientRowInline?.id) {
        // ensureUnlockTables уже есть у тебя в проекте
        try {
          await ensureUnlockTables(pool);
          const r = await pool.query(
            `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM created_at))::bigint, 0) AS mx
               FROM client_service_contact_unlocks
              WHERE client_id = $1`,
            [clientRowInline.id]
          );
          unlockStamp = Number(r.rows?.[0]?.mx || 0) || 0;
        } catch (e) {
          console.error("[tg-bot] unlockStamp query error:", e?.message || e);
          unlockStamp = 0;
        }
      }
    }

    // === INLINE CACHE KEYS ===
    const baseKey =
      `inline:${isMy ? "my" : "search"}:` +
      `${roleForInline}:` +
      `${userId}:` +
      `${category || "all"}:` +
      `v5`;

    // отдельно кэшируем:
    // 1) сырой ответ API (короткий TTL)
    // 2) уже собранные inline-results (дороже)
    const apiKey = `${baseKey}:api`;

    // ✅ resKey теперь зависит от unlockStamp, иначе после оплаты липнет старый текст/markup
    const resKey = `${baseKey}:res:v5:u${unlockStamp}:o${offset}`;

    // ✅ Для client-search results-cache можно использовать только если stamp учтён (мы учли)
const cachedRes = cacheGet(resKey);
if (cachedRes && Array.isArray(cachedRes.page)) {
  await ctx.answerInlineQuery(cachedRes.page, {
    cache_time: roleForInline === "client" && !isMy ? 1 : 11,
    is_personal: true,
    next_offset: cachedRes.nextOffset || "",
  });
  return;
}

    // 2) иначе — берём API-данные через inflight-dedup
const data = await getOrFetchCached(
  apiKey,
  12000,
  async (signal) => {
    if (isMy) {
      const resp = await axios.get(`/api/telegram/provider/${userId}/services`, {
        signal,
        timeout: 8500,
      });
      return resp.data;
    } else {
      const resp = await axios.get(`/api/telegram/client/${userId}/search`, {
        params: { category },
        signal,
        timeout: 8500,
      });
      return resp.data;
    }
  },
  9000
);

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] inline search resp malformed:", data);
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "⚠️ Ошибка загрузки. Открыть бота",
        switch_pm_parameter: "start",
      });
      return;
    }

    // DEBUG
    const DEBUG_INLINE = String(process.env.DEBUG_INLINE || "").trim() === "1";
    if (DEBUG_INLINE) {
      console.log("\n[tg-bot][inline] qRaw =", qRaw);
      console.log("[tg-bot][inline] isMy =", isMy, "category =", category, "role =", roleForInline);
      console.log("[tg-bot][inline] items from API =", data.items.length);
      console.log("[tg-bot][inline] unlockStamp =", unlockStamp);
    }

    let itemsForInline = Array.isArray(data.items) ? data.items : [];

    // если категория указана токеном — фильтруем
    if (category && REFUSED_CATEGORIES.includes(category)) {
      itemsForInline = itemsForInline.filter(
        (svc) => String(svc.category || svc.type || "").trim() === category
      );
    }

    if (isMy) {
      // ✅ МОИ УСЛУГИ — только актуальные и не archived
      itemsForInline = itemsForInline.filter((svc) => {
        try {
          if (String(svc.status || "").toLowerCase() === "archived") return false;
          const det = parseDetailsAny(svc.details);
          return isServiceActual(det, svc);
        } catch (_) {
          return false;
        }
      });
    } else {
      // ✅ КАРТОЧКАМИ — ВСЕ услуги (без фильтра актуальности)
      itemsForInline = itemsForInline.filter((svc) => !!svc);
    }

    if (!itemsForInline.length) {
      if (isMy) {
        await ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "🧳 У вас пока нет услуг. Открыть бота",
          switch_pm_parameter: "my_empty",
        });
      } else {
        await ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "😕 Нет актуальных предложений. Открыть бота",
          switch_pm_parameter: "search_empty",
        });
      }
      return;
    }

    const itemsSorted = [...itemsForInline].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });

    // === UNLOCK GATING (client) ===
    let unlockedSet = new Set();

    if (!isMy && roleForInline === "client") {
      // ✅ используем clientRowInline (уже получили выше)
      const topIds = itemsSorted.slice(0, maxBuild).map((x) => x?.id).filter(Boolean);
      if (clientRowInline?.id && topIds.length) {
        unlockedSet = await getUnlockedServiceIdSet(pool, {
          clientId: clientRowInline.id,
          serviceIds: topIds,
        });
      }
    }

    function placeholderKindByCategory(category) {
      const c = String(category || "").toLowerCase();
      if (c === "refused_tour") return "tour";
      if (c === "refused_hotel") return "hotel";
      if (c === "refused_flight") return "flight";
      if (c === "refused_ticket" || c === "refused_event_ticket") return "ticket";
      return "default";
    }

    const TG_PLACEHOLDER = (kind = "default") =>
      `${TG_IMAGE_BASE}/api/telegram/placeholder/${encodeURIComponent(kind)}.png`;

    const results = [];

    for (const svc of itemsSorted.slice(0, maxBuild)) {
      const svcCategory = svc.category || category || "refused_tour";

      const isUnlocked =
        roleForInline === "client" ? unlockedSet.has(Number(svc.id)) : false;

      const canSeeContacts =
        roleForInline === "admin" || roleForInline === "provider"
          ? true
          : roleForInline === "client"
          ? isUnlocked
          : false;

      // ✅ КЛЮЧЕВОЕ: telegramServiceCard должен получить client_unlocked, иначе в тексте будет "🔒 скрыт"
      const cardRole = roleForInline === "client" ? "client" : roleForInline;
      
      const cardOptions =
        roleForInline === "provider" && !isMy
          ? { forceRefused: true }
          : {};
      
      const unlockSettings = await getContactUnlockSettings(pool);
      const unlockPrice = tiyinToSum(unlockSettings.effective_price || 0);
      const isFreeMode = unlockPrice <= 0;

      const built = buildServiceMessage(
        svc,
        svcCategory,
        cardRole,
        // 🔒 В INLINE контакты в сам текст не вшиваем.
        // Но unlockPrice передаём, чтобы текст/заметки/логика были согласованы с режимом.
        { ...cardOptions, unlocked: false, unlockPrice }
      );
      
      // ✅ НИКОГДА не используем голые переменные text/serviceUrl/photoUrl/kbExtra
      const builtText = String(built?.text || "");
      const photoUrl = built?.photoUrl || null;
      const serviceUrl = built?.serviceUrl || `${SITE_URL}/service/${svc.id}`;
      const kbExtra = built?.kbExtra || null;
      const isAuthorTour =
        String(svcCategory || svc?.category || "").toLowerCase() === "author_tour";
      
      let textFinal = builtText;
      if (roleForInline === "client" && !canSeeContacts) {
        textFinal = stripLockedLinks(builtText, { unlockPrice });
      }

      const description = buildInlineDescription(svc, svcCategory, cardRole);

      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

      // 🔒 INLINE-безопасность: в чатах нельзя делать unlock callback'ом
      // вместо этого отправляем человека в ЛС боту по deep-link, где уже можно unlock'нуть безопасно
      const deepLink =
        BOT_USERNAME
          ? `https://t.me/${BOT_USERNAME}?start=refused_${svc.id}`
          : `${SITE_URL}/?service=${svc.id}`;
      
      let keyboardForClient =
        canSeeContacts || isFreeMode
          ? {
              inline_keyboard: [
                [
                  { text: "👤 Контакты в боте", url: deepLink },
                  { text: "Подробнее на сайте", url: serviceUrl },
                ],
                [
                  { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
                ],
              ],
            }
          : {
              inline_keyboard: [
                [
                  { text: "🔓 Открыть в боте", url: deepLink },
                  { text: "Подробнее на сайте", url: serviceUrl },
                ],
              ],
            };
      
      // ➜ добавляем дополнительные кнопки карточки.
      // Для author_tour brochure карточки telegramServiceCard.js возвращает replaceDefault,
      // чтобы не было дублей и порядок кнопок был ровно как в travel brochure.
      if (kbExtra?.inline_keyboard?.length) {
        if (isAuthorTour) {
          keyboardForClient.inline_keyboard = kbExtra.inline_keyboard;
        } else {
          keyboardForClient.inline_keyboard = kbExtra.replaceDefault
            ? kbExtra.inline_keyboard
            : [
                ...kbExtra.inline_keyboard,
                ...keyboardForClient.inline_keyboard,
              ];
        }
      }

      const keyboardForMy = {
        inline_keyboard: [[{ text: "🌐 Открыть в кабинете", url: manageUrl }]],
      };

      // ✅ thumb_url: только реальный публичный https (и НЕ placeholder)
      let thumbUrl = null;

      if (photoUrl && photoUrl.startsWith("tgfile:")) {
        const fileId = photoUrl.replace(/^tgfile:/, "").trim();
        try {
          thumbUrl = await getPublicThumbUrlFromTgFile(bot, fileId);
        } catch {
          thumbUrl = null;
        }
      } else if (photoUrl && (photoUrl.startsWith("http://") || photoUrl.startsWith("https://"))) {
        let u = photoUrl;

        // ✅ если ссылка пришла через SITE_URL (/api/...), переписываем на прямой TG_IMAGE_BASE
        if (u.startsWith(SITE_URL + "/api/")) {
          u = TG_IMAGE_BASE + u.slice(SITE_URL.length);
        }

        // если это наш сервисный эндпоинт - просим миниатюру
        if (u.includes("/api/telegram/service-image/")) {
          u = u.includes("?") ? `${u}&thumb=1` : `${u}?thumb=1`;
        }

        // Telegram thumb_url: лучше строго https
        if (u.startsWith("http://")) {
          thumbUrl = null;
        } else {
          thumbUrl = u;
        }
      }

      const phKind = placeholderKindByCategory(svcCategory);
      const finalThumbUrl =
        typeof thumbUrl === "string" && thumbUrl.startsWith("https://")
          ? thumbUrl
          : TG_PLACEHOLDER(phKind);

      // ✅ Точечный фикс: заголовок
      const det = parseDetailsAny(svc.details);
      const hotelForTitle = (det.hotel || det.hotelName || "").trim();

      const titleSource =
        hotelForTitle ||
        (typeof svc.title === "string" ? svc.title.trim() : "") ||
        "Услуга";

      const title = truncate(normalizeTitleSoft(titleSource), 60);

      console.log("[inline]", {
        svcId: svc.id,
        photoUrl,
        thumbUrl,
        finalThumbUrl,
        canSeeContacts,
        cardRole,
      });

      results.push({
        id: `${svcCategory}:${svc.id}`,
        type: "article",
        title,
        description,
        input_message_content: {
          message_text: textFinal,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        thumb_url: finalThumbUrl,
        reply_markup: isMy ? keyboardForMy : keyboardForClient,
      });
    }

// ✅ Pagination: Telegram offset
const page = results.slice(offset, offset + pageSize);
const nextOffset = offset + pageSize < results.length ? String(offset + pageSize) : "";

// ✅ Кэшируем только страницу (не весь resultsAll) — экономия памяти
cacheSet(resKey, { page, nextOffset }, 30000);

    try {
      await ctx.answerInlineQuery(page, {
        cache_time: roleForInline === "client" && !isMy ? 1 : 11,
        is_personal: true,
        next_offset: nextOffset,
      });
    } catch (e) {
      console.error("[tg-bot] answerInlineQuery FAILED:", e?.response?.data || e?.message || e);
      try {
        await ctx.answerInlineQuery([], {
          cache_time: 1,
          is_personal: true,
          switch_pm_text: "⚠️ Ошибка inline (открыть бота)",
          switch_pm_parameter: "start",
        });
      } catch {}
    }
  } catch (e) {
    console.error("[tg-bot] inline_query error:", e?.response?.data || e?.message || e);
    try {
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "⚠️ Ошибка. Открыть бота",
        switch_pm_parameter: "start",
      });
    } catch (_) {}
  }
});

/* ===================== EDIT IMAGES (ADD/REMOVE/CLEAR) ===================== */

bot.action(/^svc_edit_img_(?:remove|del):(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const idx = Number(ctx.match[1]);
    const draft =
      ctx.session?.editDraft ||
      ctx.session?.serviceDraft ||
      null;

    if (!draft || !Array.isArray(draft.images)) {
      await safeReply(ctx, "⚠️ Изображения не найдены.");
      return;
    }
    if (Number.isNaN(idx) || idx < 0 || idx >= draft.images.length) {
      await safeReply(ctx, "⚠️ Некорректный номер изображения.");
      return;
    }

    draft.images.splice(idx, 1);

    await safeReply(
      ctx,
      `✅ Удалено. Сейчас в услуге: ${draft.images.length} шт.\\n\\nОтправьте новое фото или нажмите «✅ ».`,
      buildEditImagesKeyboard(draft)
    );
  } catch (e) {
    console.error("svc_edit_img_remove error:", e);
    await safeReply(ctx, "⚠️ Не удалось удалить изображение.");
  }
});

bot.action("svc_edit_img_clear", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const draft =
      ctx.session?.editDraft ||
      ctx.session?.serviceDraft ||
      null;

    if (!draft) {
      await safeReply(ctx, "⚠️ Черновик услуги не найден.");
      return;
    }

    draft.images = [];

    await safeReply(
      ctx,
      "🧹 Все изображения очищены. Пришлите новое фото или нажмите «✅ Готово».",
      buildEditImagesKeyboard(draft)
    );
  } catch (e) {
    console.error("svc_edit_img_clear error:", e);
    await safeReply(ctx, "⚠️ Не удалось очистить изображения.");
  }
});

bot.action("svc_edit_img_done", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    const draft =
      ctx.session?.serviceDraft ||
      ctx.session?.editDraft ||
      null;

    if (!draft) {
      await safeReply(ctx, "⚠️ Черновик услуги не найден.");
      return;
    }

    const currentState = String(
      ctx.session?.editWiz?.step || ctx.session?.state || ""
    );

    if (!Array.isArray(ctx.session.wizardStack)) {
      ctx.session.wizardStack = [];
    }

    // Важно: чтобы с confirm кнопка «Назад» возвращала именно к фото
    if (currentState === "svc_edit_images") {
      ctx.session.wizardStack.push("svc_edit_images");
    }

    ctx.session.state = "svc_edit_confirm";
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = "svc_edit_confirm";

    await promptEditState(ctx, "svc_edit_confirm");
  } catch (e) {
    console.error("svc_edit_img_done error:", e);
    await safeReply(ctx, "⚠️ Не удалось завершить редактирование изображений.");
  }
});

// bot.launch() — запуск делаем из index.js

bot.action(/^svc_edit_bool:(yes|no)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const value = ctx.match?.[1] === "yes" ? "да" : "нет";

    if (!ctx.session) ctx.session = {};
    ctx.message = ctx.message || {};
    ctx.message.text = value;

    const handled = await handleSvcEditWizardText(ctx);
    if (!handled) {
      await safeReply(ctx, "⚠️ Сейчас нет активного шага редактирования.");
    }
  } catch (e) {
    console.error("svc_edit_bool error:", e);
    await safeReply(ctx, "⚠️ Не удалось обработать ответ.");
  }
});

bot.action("svc_edit_save", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    const draft =
      ctx.session?.serviceDraft ||
      ctx.session?.editDraft ||
      null;

    if (!draft?.id) {
      await safeReply(ctx, "⚠️ Черновик редактирования не найден.");
      return;
    }

    await finishEditWizard(ctx);
  } catch (e) {
    console.error("svc_edit_save error:", e);
    await safeReply(ctx, "⚠️ Ошибка при сохранении изменений.");
  }
});

bot.action("svc_edit_continue", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    const draft =
      ctx.session?.serviceDraft ||
      ctx.session?.editDraft ||
      null;

    if (!draft) {
      await safeReply(ctx, "⚠️ Черновик услуги не найден.");
      return;
    }

    // Важно: начинаем новый проход редактирования с чистым стеком
    ctx.session.wizardStack = [];
    ctx.session.editWiz = ctx.session.editWiz || {};

    ctx.session.state = "svc_edit_title";
    ctx.session.editWiz.step = "svc_edit_title";

    await promptEditState(ctx, "svc_edit_title");
  } catch (e) {
    console.error("svc_edit_continue error:", e);
    await safeReply(ctx, "⚠️ Не удалось продолжить редактирование.");
  }
});


module.exports = { bot };
