// backend/utils/serviceApprovalBroadcast.js
// Broadcast approved refused/author services to the Travella client/refused bot audience.
// Hardened against two common production failures:
// 1) provider old-bot chat ids were mixed into client-bot broadcasts;
// 2) Telegram sendPhoto failures stopped/invalidated delivery instead of falling back to text.

const pool = require("../db");
const { tgSend, tgSendPhoto } = require("./telegram");
const { buildServiceMessage } = require("./telegramServiceCard");

const BROADCAST_CATEGORIES = new Set([
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
  "refused_event_ticket",
]);

function normalizeCategory(v) {
  return String(v || "").trim().toLowerCase();
}

function parseJsonMaybe(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return {};
  }
}

function uniqueNumericChatIds(rows) {
  return Array.from(
    new Set(
      (rows || [])
        .map((r) => String(r?.chat_id || "").trim())
        .filter((s) => /^-?\d+$/.test(s))
        .map((s) => Number(s))
    )
  );
}

function buildOpenBotUrl(serviceId) {
  const botUsername = String(
    process.env.TELEGRAM_CLIENT_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || ""
  )
    .replace(/^@/, "")
    .trim();

  const startPayload = encodeURIComponent(`refused_${serviceId}`);
  return botUsername
    ? `https://t.me/${botUsername}?start=${startPayload}`
    : process.env.SITE_PUBLIC_URL || "";
}

async function getClientBotAudience(db = pool) {
  // ВАЖНО: рассылаем через TELEGRAM_CLIENT_BOT_TOKEN, значит берём только chat_id,
  // которые точно относятся к этому боту.
  // Нельзя подмешивать telegram_web_chat_id / telegram_chat_id провайдера старого бота:
  // Telegram вернёт "chat not found"/403, и фактической рассылки не будет.
  const recProv = await db.query(
    `SELECT telegram_refused_chat_id AS chat_id
       FROM providers
      WHERE telegram_refused_chat_id IS NOT NULL
        AND TRIM(telegram_refused_chat_id::text) <> ''`
  );

  const recCli = await db.query(
    `SELECT telegram_chat_id AS chat_id
       FROM clients
      WHERE telegram_chat_id IS NOT NULL
        AND TRIM(telegram_chat_id::text) <> ''`
  );

  return {
    providerCount: recProv.rows.length,
    clientCount: recCli.rows.length,
    chatIds: uniqueNumericChatIds([...recProv.rows, ...recCli.rows]),
  };
}

async function sendCardToChat(chatId, { text, photoUrl, replyMarkup, token }) {
  if (photoUrl) {
    try {
      const data = await tgSendPhoto(
        chatId,
        photoUrl,
        text,
        { parse_mode: "HTML", reply_markup: replyMarkup },
        token,
        true
      );
      if (data?.ok) return { ok: true, method: "photo" };
    } catch (e) {
      const desc = e?.response?.data?.description || e?.message || String(e);
      console.warn("[service approval broadcast] sendPhoto failed; fallback to text:", {
        chatId,
        error: desc,
      });
    }
  }

  try {
    const ok = await tgSend(
      chatId,
      text,
      { parse_mode: "HTML", reply_markup: replyMarkup },
      token,
      true
    );
    return ok ? { ok: true, method: "text" } : { ok: false, error: "sendMessage returned false" };
  } catch (e) {
    const desc = e?.response?.data?.description || e?.message || String(e);
    return { ok: false, error: desc };
  }
}

async function broadcastApprovedService(serviceId, options = {}) {
  const db = options.db || pool;
  const logPrefix = options.logPrefix || "[service approval broadcast]";

  const token = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
  if (!token) {
    console.warn(`${logPrefix} skipped: TELEGRAM_CLIENT_BOT_TOKEN is missing`);
    return { ok: false, reason: "CLIENT_BOT_TOKEN_MISSING" };
  }

  const q = await db.query(
    `SELECT s.*,
            COALESCE(p.name, '') AS provider_name,
            p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1`,
    [serviceId]
  );

  const svc = q.rows[0] || null;
  if (!svc) return { ok: false, reason: "SERVICE_NOT_FOUND" };

  const cat = normalizeCategory(svc.category);
  if (!BROADCAST_CATEGORIES.has(cat)) {
    console.log(`${logPrefix} skipped: unsupported category`, { serviceId: svc.id, category: cat });
    return { ok: false, reason: "UNSUPPORTED_CATEGORY", category: cat };
  }

  const status = normalizeCategory(svc.status);
  const moderationStatus = normalizeCategory(svc.moderation_status);
  if (svc.deleted_at || !["published", "approved", "active"].includes(status) || !["approved", "published", "active"].includes(moderationStatus)) {
    console.warn(`${logPrefix} skipped: service is not public`, {
      serviceId: svc.id,
      status: svc.status,
      moderation_status: svc.moderation_status,
      deleted_at: svc.deleted_at,
    });
    return { ok: false, reason: "SERVICE_NOT_PUBLIC" };
  }

  const detailsObj = parseJsonMaybe(svc.details);
  const needNewBadgeOnce = !Boolean(detailsObj?.meta?.new_badge_sent_at);

  const card = buildServiceMessage(svc, cat, "client", { newBadge: needNewBadgeOnce });
  const text = String(card?.text || "").trim();
  if (!text) return { ok: false, reason: "EMPTY_CARD_TEXT" };

  const openBotUrl = buildOpenBotUrl(svc.id);
  const replyMarkup = {
    inline_keyboard: [[{ text: "Открыть в боте", url: openBotUrl }]],
  };

  const audience = await getClientBotAudience(db);
  if (!audience.chatIds.length) {
    console.warn(`${logPrefix} skipped: no recipients`, audience);
    return { ok: false, reason: "NO_RECIPIENTS", ...audience };
  }

  console.log(`${logPrefix} audience`, {
    serviceId: svc.id,
    category: cat,
    providers: audience.providerCount,
    clients: audience.clientCount,
    totalUnique: audience.chatIds.length,
    hasPhoto: Boolean(card.photoUrl),
  });

  const batchSize = Number(options.batchSize || 20);
  let delivered = 0;
  let failed = 0;
  let photoDelivered = 0;
  let textDelivered = 0;
  const failedSample = [];

  for (let i = 0; i < audience.chatIds.length; i += batchSize) {
    const batch = audience.chatIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (chatId) => {
        const r = await sendCardToChat(chatId, {
          text,
          photoUrl: card.photoUrl || null,
          replyMarkup,
          token,
        });
        return { chatId, ...r };
      })
    );

    for (const r of results) {
      if (r.ok) {
        delivered += 1;
        if (r.method === "photo") photoDelivered += 1;
        else textDelivered += 1;
      } else {
        failed += 1;
        if (failedSample.length < 10) failedSample.push({ chatId: r.chatId, error: r.error || "unknown" });
      }
    }

    if (results.some((r) => !r.ok)) {
      console.warn(`${logPrefix} batch finished with errors`, {
        serviceId: svc.id,
        batchFrom: i,
        batchSize: results.length,
        delivered,
        failed,
        failedSample,
      });
    } else {
      console.log(`${logPrefix} batch ok`, { serviceId: svc.id, batchFrom: i, batchSize: results.length });
    }
  }

  if (needNewBadgeOnce && delivered > 0) {
    try {
      await db.query(
        `UPDATE services
            SET details = jsonb_set(
                COALESCE(details, '{}'::jsonb),
                '{meta,new_badge_sent_at}',
                to_jsonb(NOW()),
                true
            )
          WHERE id = $1
            AND (details->'meta'->>'new_badge_sent_at') IS NULL`,
        [svc.id]
      );
    } catch (e) {
      console.error(`${logPrefix} failed to mark new_badge_sent_at:`, e?.message || e);
    }
  }

  const report = {
    ok: delivered > 0,
    serviceId: svc.id,
    category: cat,
    recipients: audience.chatIds.length,
    delivered,
    failed,
    photoDelivered,
    textDelivered,
    failedSample,
  };

  console.log(`${logPrefix} done`, report);
  return report;
}

module.exports = {
  broadcastApprovedService,
  getClientBotAudience,
};
