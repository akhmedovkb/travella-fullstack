// backend/jobs/abandonedPaymeReminderJob.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const SITE_PUBLIC_URL = String(
  process.env.SITE_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_URL ||
    "https://travella.uz"
).replace(/\/+$/, "");

const ORDER_EXPIRE_HOURS = 12;
const MAX_REMINDERS = 3;

function minutes(n) {
  return `${Number(n)} minutes`;
}

function hours(n) {
  return `${Number(n)} hours`;
}

function cleanText(value, max = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSumFromTiyin(amountTiyin) {
  const sum = Math.round(Number(amountTiyin || 0) / 100);
  return `${sum.toLocaleString("ru-RU")} сум`;
}

function isAbsoluteUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function buildPaymeGuideUrl(row) {
  const payUrl = cleanText(row?.pay_url, 4000);
  if (!isAbsoluteUrl(payUrl)) return "";

  const params = new URLSearchParams();
  params.set("pay_url", payUrl);
  params.set("purpose", row.order_type || row.purpose || "payme");
  params.set("amount", String(Math.round(Number(row.amount_tiyin || 0) / 100)));
  params.set("order_id", String(row.order_id));
  if (row.service_id) params.set("service_id", String(row.service_id));

  return `${SITE_PUBLIC_URL}/payme/guide?${params.toString()}`;
}

function reminderDelayFor(row) {
  const type = String(row?.order_type || row?.purpose || "").trim();
  const count = Number(row?.reminder_count || 0);

  // Payme technical order life is 12h in Travella, so all three reminders must fit before expiry.
  if (type === "provider_support") {
    if (count <= 0) return hours(1);
    if (count === 1) return hours(6);
    return hours(10);
  }

  // unlock_contact is a stronger intent; first touch should be faster.
  if (count <= 0) return minutes(15);
  if (count === 1) return hours(3);
  return hours(10);
}

function buildReminderText(row) {
  const type = String(row?.order_type || row?.purpose || "").trim();
  const count = Number(row?.reminder_count || 0);
  const amount = formatSumFromTiyin(row?.amount_tiyin);
  const serviceTitle = escapeHtml(row?.service_title || "");
  const orderLine = `<code>#${escapeHtml(row?.order_id || "")}</code>`;

  if (type === "provider_support") {
    if (count <= 0) {
      return [
        "❤️ <b>Вы начали поддержку проекта Travella, но платёж не завершён.</b>",
        "",
        `Сумма: <b>${escapeHtml(amount)}</b>`,
        `Заказ: ${orderLine}`,
        "",
        "Если желание поддержать проект осталось, оплату можно продолжить.",
        "",
        "⚠️ На странице Payme вводите только номер карты и срок карты. Телефон для авторизации Payme вводить не нужно.",
      ].join("\n");
    }

    if (count === 1) {
      return [
        "❤️ <b>Напоминаем про поддержку Travella.</b>",
        "",
        `Платёж на <b>${escapeHtml(amount)}</b> пока не завершён.`,
        "Ваш вклад помогает развивать базу отказных туров и инструменты для поставщиков.",
        "",
        "💳 Для оплаты Payme достаточно карты и срока действия карты. Блок телефона — это вход в Payme, его можно не использовать.",
      ].join("\n");
    }

    return [
      "❤️ <b>Последнее напоминание по поддержке проекта.</b>",
      "",
      `Оплата на <b>${escapeHtml(amount)}</b> ещё не завершена.`,
      "Если актуально — можно продолжить по кнопке ниже.",
    ].join("\n");
  }

  if (count <= 0) {
    return [
      "🔓 <b>Вы начали открывать контакты, но не завершили оплату.</b>",
      "",
      serviceTitle ? `Услуга: <b>${serviceTitle}</b>` : "Услуга: <b>карточка Travella</b>",
      `Сумма: <b>${escapeHtml(amount)}</b>`,
      `Заказ: ${orderLine}`,
      "",
      "Контакты поставщика всё ещё можно открыть.",
      "",
      "⚠️ На странице Payme вводите только номер карты и срок карты. Телефон для авторизации Payme вводить не нужно.",
    ].join("\n");
  }

  if (count === 1) {
    return [
      "🔓 <b>Контакты поставщика пока не открыты.</b>",
      "",
      serviceTitle ? `Услуга: <b>${serviceTitle}</b>` : "",
      `Стоимость открытия: <b>${escapeHtml(amount)}</b>`,
      "",
      "💳 Если Payme показывает поле телефона — это вход в Payme-аккаунт. Для оплаты Travella достаточно ввести карту и срок карты.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "🔓 <b>Последнее напоминание по открытию контактов.</b>",
    "",
    serviceTitle ? `Услуга: <b>${serviceTitle}</b>` : "",
    `Сумма: <b>${escapeHtml(amount)}</b>`,
    "",
    "Если контакты ещё нужны — можно завершить оплату по кнопке ниже.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function relationKind(client, name) {
  const q = await client.query(
    `
      SELECT c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = $1
       LIMIT 1
    `,
    [String(name)]
  );
  return q.rows?.[0]?.relkind || "";
}

async function relationExists(client, name) {
  return Boolean(await relationKind(client, name));
}

async function resolveTopupTarget(client) {
  const topupKind = await relationKind(client, "topup_orders");
  if (topupKind === "r" || topupKind === "p") return "topup_orders";
  const paymeKind = await relationKind(client, "payme_topup_orders");
  if (paymeKind === "r" || paymeKind === "p") return "payme_topup_orders";
  return "";
}

async function ensureAbandonedPaymeShape(client) {
  const topupTarget = await resolveTopupTarget(client);

  if (topupTarget) {
    await client.query(`
      ALTER TABLE ${topupTarget}
        ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS pay_url TEXT,
        ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
        ADD COLUMN IF NOT EXISTS support_donation_id BIGINT,
        ADD COLUMN IF NOT EXISTS provider_id BIGINT,
        ADD COLUMN IF NOT EXISTS service_id BIGINT,
        ADD COLUMN IF NOT EXISTS purpose TEXT,
        ADD COLUMN IF NOT EXISTS order_type TEXT,
        ADD COLUMN IF NOT EXISTS meta JSONB
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${topupTarget}_abandoned_payme
        ON ${topupTarget}(status, order_type, created_at, reminder_count)
    `);
  }

  if (await relationExists(client, "provider_support_donations")) {
    await client.query(`
      ALTER TABLE provider_support_donations
        ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ
    `);
  }

  return { topupTarget };
}

async function expireCreatedPaymeOrders(options = {}) {
  const client = options.client || (await pool.connect());
  const shouldRelease = !options.client;

  try {
    const { topupTarget } = await ensureAbandonedPaymeShape(client);
    if (!topupTarget) return { expired_orders: 0, expired_support_donations: 0 };

    const expiredOrdersQ = await client.query(`
      UPDATE ${topupTarget}
         SET status = 'expired',
             expired_at = COALESCE(expired_at, NOW()),
             failed_at = COALESCE(failed_at, NOW())
       WHERE LOWER(COALESCE(status, 'created')) IN ('created', 'pending', 'new')
         AND COALESCE(provider, 'payme') = 'payme'
         AND COALESCE(order_type, purpose, '') IN ('unlock_contact', 'provider_support')
         AND (
           (expires_at IS NOT NULL AND expires_at < NOW())
           OR created_at < NOW() - INTERVAL '${ORDER_EXPIRE_HOURS} hours'
         )
      RETURNING id, support_donation_id
    `);

    let expiredSupportDonations = 0;
    if ((expiredOrdersQ.rows || []).length && (await relationExists(client, "provider_support_donations"))) {
      const ids = expiredOrdersQ.rows
        .map((r) => Number(r.support_donation_id || 0))
        .filter((n) => Number.isFinite(n) && n > 0);

      if (ids.length) {
        const dQ = await client.query(
          `
            UPDATE provider_support_donations
               SET status = 'expired',
                   expired_at = COALESCE(expired_at, NOW())
             WHERE id = ANY($1::bigint[])
               AND LOWER(COALESCE(status, 'created')) IN ('created', 'pending', 'new')
            RETURNING id
          `,
          [ids]
        );
        expiredSupportDonations = dQ.rowCount || 0;
      }
    }

    return {
      expired_orders: expiredOrdersQ.rowCount || 0,
      expired_support_donations: expiredSupportDonations,
    };
  } finally {
    if (shouldRelease) client.release();
  }
}

async function listDueReminderCandidates(client, limit = 50) {
  const { topupTarget } = await ensureAbandonedPaymeShape(client);
  if (!topupTarget) return [];

  const hasSupportDonations = await relationExists(client, "provider_support_donations");

  const supportJoin = hasSupportDonations
    ? `LEFT JOIN provider_support_donations d ON d.id = o.support_donation_id`
    : `LEFT JOIN LATERAL (SELECT NULL::bigint AS id, NULL::bigint AS telegram_chat_id) d ON TRUE`;

  const q = await client.query(
    `
      WITH base AS (
        SELECT
          o.id AS order_id,
          COALESCE(o.order_type, o.purpose, '') AS order_type,
          o.purpose,
          o.client_id,
          o.provider_id,
          o.service_id,
          o.support_donation_id,
          o.telegram_chat_id AS order_telegram_chat_id,
          d.telegram_chat_id AS donation_telegram_chat_id,
          COALESCE(c.telegram_chat_id, NULL) AS client_telegram_chat_id,
          COALESCE(p.telegram_refused_chat_id, p.telegram_web_chat_id, p.telegram_chat_id, p.tg_chat_id) AS provider_telegram_chat_id,
          COALESCE(c.name, p.name, 'Travella user') AS actor_name,
          s.title AS service_title,
          o.amount_tiyin,
          o.pay_url,
          o.created_at,
          o.expires_at,
          COALESCE(o.reminder_count, 0) AS reminder_count,
          o.last_reminder_sent_at,
          CASE
            WHEN COALESCE(o.order_type, o.purpose, '') = 'provider_support' AND COALESCE(o.reminder_count, 0) <= 0 THEN NOW() - INTERVAL '1 hour'
            WHEN COALESCE(o.order_type, o.purpose, '') = 'provider_support' AND COALESCE(o.reminder_count, 0) = 1 THEN NOW() - INTERVAL '6 hours'
            WHEN COALESCE(o.order_type, o.purpose, '') = 'provider_support' AND COALESCE(o.reminder_count, 0) = 2 THEN NOW() - INTERVAL '10 hours'
            WHEN COALESCE(o.reminder_count, 0) <= 0 THEN NOW() - INTERVAL '15 minutes'
            WHEN COALESCE(o.reminder_count, 0) = 1 THEN NOW() - INTERVAL '3 hours'
            ELSE NOW() - INTERVAL '10 hours'
          END AS due_cutoff
        FROM ${topupTarget} o
        LEFT JOIN clients c ON c.id = o.client_id
        LEFT JOIN providers p ON p.id = o.provider_id
        LEFT JOIN services s ON s.id = o.service_id
        ${supportJoin}
        WHERE LOWER(COALESCE(o.status, 'created')) IN ('created', 'pending', 'new')
          AND COALESCE(o.provider, 'payme') = 'payme'
          AND COALESCE(o.order_type, o.purpose, '') IN ('unlock_contact', 'provider_support')
          AND COALESCE(o.reminder_count, 0) < ${MAX_REMINDERS}
          AND COALESCE(o.pay_url, '') <> ''
          AND (
            o.expires_at IS NULL
            OR o.expires_at > NOW() + INTERVAL '15 minutes'
          )
      )
      SELECT *,
             COALESCE(
               order_telegram_chat_id,
               donation_telegram_chat_id,
               CASE WHEN order_type = 'provider_support' THEN provider_telegram_chat_id ELSE client_telegram_chat_id END,
               provider_telegram_chat_id,
               client_telegram_chat_id
             ) AS chat_id
        FROM base
       WHERE created_at <= due_cutoff
         AND (last_reminder_sent_at IS NULL OR last_reminder_sent_at <= due_cutoff)
         AND COALESCE(
               order_telegram_chat_id,
               donation_telegram_chat_id,
               CASE WHEN order_type = 'provider_support' THEN provider_telegram_chat_id ELSE client_telegram_chat_id END,
               provider_telegram_chat_id,
               client_telegram_chat_id
             ) IS NOT NULL
       ORDER BY created_at ASC
       LIMIT $1
    `,
    [Math.max(1, Math.min(Number(limit) || 50, 200))]
  );

  return q.rows || [];
}

async function sendOneReminder(client, row, options = {}) {
  const chatId = String(row?.chat_id || "").trim();
  const guideUrl = buildPaymeGuideUrl(row);
  if (!chatId || !guideUrl) return { ok: false, reason: "missing_chat_or_url" };

  const text = buildReminderText(row);
  const buttonText =
    String(row?.order_type || row?.purpose || "") === "provider_support"
      ? "❤️ Продолжить поддержку"
      : "🔓 Продолжить оплату";

  let sent = false;
  let error = "";

  if (!options.dryRun) {
    try {
      sent = await tgSend(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: buttonText, url: guideUrl }]],
        },
      });
    } catch (e) {
      sent = false;
      error = e?.response?.data?.description || e?.message || String(e);
    }
  } else {
    sent = true;
  }

  if (sent) {
    const nextCount = Number(row.reminder_count || 0) + 1;
    await client.query(
      `
        UPDATE topup_orders
           SET reminder_count = $2,
               last_reminder_sent_at = NOW(),
               meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                 'abandoned_payme_last_reminder_at', NOW(),
                 'abandoned_payme_reminder_count', $2
               )
         WHERE id = $1
      `,
      [row.order_id, nextCount]
    );

    if (row.support_donation_id && (await relationExists(client, "provider_support_donations"))) {
      await client.query(
        `
          UPDATE provider_support_donations
             SET reminder_count = $2,
                 last_reminder_sent_at = NOW()
           WHERE id = $1
        `,
        [row.support_donation_id, nextCount]
      );
    }

    return { ok: true, order_id: row.order_id, reminder_count: nextCount };
  }

  return { ok: false, order_id: row.order_id, reason: error || "telegram_send_failed" };
}

async function runAbandonedPaymeReminderJob(options = {}) {
  const client = await pool.connect();
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const dryRun = Boolean(options.dryRun);

  try {
    await ensureAbandonedPaymeShape(client);
    const expired = await expireCreatedPaymeOrders({ client });
    const candidates = await listDueReminderCandidates(client, limit);

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const row of candidates) {
      try {
        const result = await sendOneReminder(client, row, { dryRun });
        if (result.ok) sent += 1;
        else {
          failed += 1;
          errors.push({ order_id: row.order_id, reason: result.reason });
        }
      } catch (e) {
        failed += 1;
        errors.push({ order_id: row.order_id, reason: e?.message || String(e) });
      }
    }

    return {
      ok: true,
      dryRun,
      expired,
      checked: candidates.length,
      sent,
      failed,
      errors: errors.slice(0, 20),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  ensureAbandonedPaymeShape,
  expireCreatedPaymeOrders,
  runAbandonedPaymeReminderJob,
};
