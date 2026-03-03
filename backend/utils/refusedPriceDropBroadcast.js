// backend/utils/refusedPriceDropBroadcast.js
const pool = require("../db");
const { tgSend, tgSendPhoto } = require("./telegram");
const { buildServiceMessage } = require("./telegramServiceCard");

const REFUSED_CATEGORIES = new Set([
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
  "refused_event_ticket",
]);

function toNum(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = String(x).trim();
  if (!s) return null;
  // вычищаем валюту/пробелы: "2 640 USD" -> "2640"
  const cleaned = s.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractPrices(svcRow) {
  let d = svcRow?.details || {};
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch { d = {}; }
  }

  const net = toNum(d?.netPrice ?? null);

  // gross: сначала grossPrice, потом price в details, потом price колонка
  const gross = toNum(
    d?.grossPrice ?? d?.price ?? svcRow?.price ?? null
  );

  return { net, gross };
}

function isPriceDrop(prev, next) {
  const netDrop =
    prev.net !== null && next.net !== null && next.net < prev.net;

  const grossDrop =
    prev.gross !== null && next.gross !== null && next.gross < prev.gross;

  return { netDrop, grossDrop, any: netDrop || grossDrop };
}

async function broadcastPriceDropCard(serviceId, prefixHtml = "🔥 <b>ЦЕНА СНИЖЕНА!</b>") {
  // грузим услугу + провайдера (как в approve)
  const info = await pool.query(
    `SELECT s.*,
            COALESCE(p.name,'') AS provider_name,
            p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1`,
    [serviceId]
  );

  const svc = info.rows[0] || null;
  if (!svc) return { ok: false, reason: "SERVICE_NOT_FOUND" };

  const cat = String(svc.category || "").trim().toLowerCase();
  if (!REFUSED_CATEGORIES.has(cat)) return { ok: false, reason: "NOT_REFUSED" };

  // собираем ссылку "Открыть в боте"
  const botUsername = String(
    process.env.TELEGRAM_CLIENT_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || ""
  ).trim();

  const startPayload = encodeURIComponent(`refused_${svc.id}`);
  const openBotUrl = botUsername
    ? `https://t.me/${botUsername}?start=${startPayload}`
    : (process.env.SITE_PUBLIC_URL || "");

  // единый шаблон карточки (как в approve): viewerRole="client"
  const card = buildServiceMessage(svc, cat, "client");
  const msg = `${prefixHtml}\n\n${card.text}`;
  const photoUrl = card.photoUrl || null;

  const kb = {
    inline_keyboard: [[{ text: "Открыть в боте", url: openBotUrl }]],
  };

  const tokenOverrideAll = (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim() || null;
  if (!tokenOverrideAll) return { ok: false, reason: "CLIENT_BOT_TOKEN_MISSING" };

  // recipients: providers + clients (как в approve)
  const recProv = await pool.query(
    `SELECT COALESCE(telegram_refused_chat_id, telegram_web_chat_id, telegram_chat_id) AS chat_id
       FROM providers
      WHERE COALESCE(telegram_refused_chat_id, telegram_web_chat_id, telegram_chat_id) IS NOT NULL
        AND TRIM(COALESCE(telegram_refused_chat_id, telegram_web_chat_id, telegram_chat_id)::text) <> ''`
  );

  const recCli = await pool.query(
    `SELECT telegram_chat_id AS chat_id
       FROM clients
      WHERE telegram_chat_id IS NOT NULL
        AND TRIM(telegram_chat_id::text) <> ''`
  );

  const normalized = [...recProv.rows, ...recCli.rows]
    .map((r) => String(r.chat_id || "").trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map((s) => Number(s));

  const unique = Array.from(new Set(normalized));
  if (!unique.length) return { ok: false, reason: "NO_RECIPIENTS" };

  const BATCH = 25;
  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map((cid) => {
        if (photoUrl) {
          return tgSendPhoto(cid, photoUrl, msg, { reply_markup: kb }, tokenOverrideAll);
        }
        return tgSend(cid, msg, { parse_mode: "HTML", reply_markup: kb }, tokenOverrideAll);
      })
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    delivered += ok;
    failed += (results.length - ok);
  }

  return { ok: true, delivered, failed, recipients: unique.length, serviceId: svc.id, category: cat };
}

module.exports = {
  extractPrices,
  isPriceDrop,
  broadcastPriceDropCard,
};
