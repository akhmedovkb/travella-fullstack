// backend/jobs/abandonedPaymeReminderJob.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const SITE = String(
  process.env.SITE_PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    "https://travella.uz"
).replace(/\/+$/, "");

const TOPUP_ORDER_ACTIVE_STATUSES = ["created", "pending"];
const SUPPORT_ACTIVE_STATUSES = ["created", "new"];

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPaymeGuideUrl(payUrl, options = {}) {
  const url = String(payUrl || "").trim();
  if (!url) return "";

  const params = new URLSearchParams();
  params.set("pay_url", url);
  if (options.kind) params.set("kind", String(options.kind));
  if (options.orderId) params.set("order_id", String(options.orderId));
  if (options.serviceId) params.set("service_id", String(options.serviceId));
  if (options.donationId) params.set("donation_id", String(options.donationId));

  return `${SITE}/payme/guide?${params.toString()}`;
}

async function ensureRecoveryColumns(db = pool) {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN DEFAULT FALSE`);

  await db.query(`
    ALTER TABLE topup_orders
      ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_1_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_2_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_3_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS meta JSONB
  `);

  await db.query(`
    ALTER TABLE provider_support_donations
      ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_1_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_2_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_3_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS meta JSONB
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_topup_orders_recovery ON topup_orders(status, created_at, reminder_count)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_support_recovery ON provider_support_donations(status, created_at, reminder_count)`);
}

async function expireOldPaymeOrders({ dryRun = false } = {}) {
  await ensureRecoveryColumns();

  const result = {
    dryRun: !!dryRun,
    topup_active_expired: 0,
    topup_old_new_expired: 0,
    support_expired: 0,
  };

  const topupActiveSql = `
    WITH candidates AS (
      SELECT o.id
        FROM topup_orders o
        LEFT JOIN clients c ON c.id = o.client_id
        LEFT JOIN providers p ON p.id = o.provider_id
       WHERE LOWER(COALESCE(o.status, '')) = ANY($1::text[])
         AND COALESCE(c.is_test_account, false) = false
         AND COALESCE(p.is_test_account, false) = false
         AND (
           (o.expires_at IS NOT NULL AND o.expires_at < NOW())
           OR o.created_at < NOW() - interval '12 hours'
         )
    )
    ${dryRun ? "SELECT COUNT(*)::int AS count FROM candidates" : `
      UPDATE topup_orders o
         SET status = 'expired',
             failed_at = COALESCE(o.failed_at, NOW()),
             expired_at = COALESCE(o.expired_at, NOW()),
             meta = jsonb_set(
               COALESCE(o.meta, '{}'::jsonb),
               '{recovery_expired}',
               jsonb_build_object('at', NOW(), 'reason', 'active_order_timeout', 'previous_status', o.status),
               true
             )
        FROM candidates c
       WHERE o.id = c.id
       RETURNING o.id
    `}
  `;

  const topupActive = await pool.query(topupActiveSql, [TOPUP_ORDER_ACTIVE_STATUSES]);
  result.topup_active_expired = dryRun ? Number(topupActive.rows[0]?.count || 0) : topupActive.rowCount;

  const topupOldNewSql = `
    WITH candidates AS (
      SELECT o.id
        FROM topup_orders o
        LEFT JOIN clients c ON c.id = o.client_id
        LEFT JOIN providers p ON p.id = o.provider_id
       WHERE LOWER(COALESCE(o.status, '')) = 'new'
         AND COALESCE(c.is_test_account, false) = false
         AND COALESCE(p.is_test_account, false) = false
         AND o.created_at < NOW() - interval '30 days'
    )
    ${dryRun ? "SELECT COUNT(*)::int AS count FROM candidates" : `
      UPDATE topup_orders o
         SET status = 'expired',
             failed_at = COALESCE(o.failed_at, NOW()),
             expired_at = COALESCE(o.expired_at, NOW()),
             meta = jsonb_set(
               COALESCE(o.meta, '{}'::jsonb),
               '{recovery_expired}',
               jsonb_build_object('at', NOW(), 'reason', 'old_new_cleanup', 'previous_status', o.status),
               true
             )
        FROM candidates c
       WHERE o.id = c.id
       RETURNING o.id
    `}
  `;

  const topupOldNew = await pool.query(topupOldNewSql);
  result.topup_old_new_expired = dryRun ? Number(topupOldNew.rows[0]?.count || 0) : topupOldNew.rowCount;

  const supportSql = `
    WITH candidates AS (
      SELECT d.id
        FROM provider_support_donations d
        LEFT JOIN providers p ON p.id = d.provider_id
       WHERE LOWER(COALESCE(d.status, '')) = ANY($1::text[])
         AND COALESCE(p.is_test_account, false) = false
         AND (
           (d.expires_at IS NOT NULL AND d.expires_at < NOW())
           OR d.created_at < NOW() - interval '12 hours'
         )
    )
    ${dryRun ? "SELECT COUNT(*)::int AS count FROM candidates" : `
      UPDATE provider_support_donations d
         SET status = 'expired',
             failed_at = COALESCE(d.failed_at, NOW()),
             expired_at = COALESCE(d.expired_at, NOW()),
             meta = jsonb_set(
               COALESCE(d.meta, '{}'::jsonb),
               '{recovery_expired}',
               jsonb_build_object('at', NOW(), 'reason', 'support_timeout', 'previous_status', d.status),
               true
             )
        FROM candidates c
       WHERE d.id = c.id
       RETURNING d.id
    `}
  `;

  const support = await pool.query(supportSql, [SUPPORT_ACTIVE_STATUSES]);
  result.support_expired = dryRun ? Number(support.rows[0]?.count || 0) : support.rowCount;

  return result;
}

function dueConditionSql(kind, alias = "o") {
  if (kind === "support") {
    return `
      (
        (COALESCE(${alias}.reminder_count, 0) = 0 AND ${alias}.created_at <= NOW() - interval '1 hour')
        OR (COALESCE(${alias}.reminder_count, 0) = 1 AND ${alias}.last_reminder_sent_at <= NOW() - interval '6 hours')
        OR (COALESCE(${alias}.reminder_count, 0) = 2 AND ${alias}.last_reminder_sent_at <= NOW() - interval '10 hours')
      )
    `;
  }

  return `
    (
      (COALESCE(${alias}.reminder_count, 0) = 0 AND ${alias}.created_at <= NOW() - interval '15 minutes')
      OR (COALESCE(${alias}.reminder_count, 0) = 1 AND ${alias}.last_reminder_sent_at <= NOW() - interval '3 hours')
      OR (COALESCE(${alias}.reminder_count, 0) = 2 AND ${alias}.last_reminder_sent_at <= NOW() - interval '10 hours')
    )
  `;
}

function buildTopupReminderText(row, step) {
  const amountSum = Math.round(Number(row.amount_tiyin || row.amount || 0) / 100).toLocaleString("ru-RU");
  const serviceTitle = String(row.service_title || "").trim();
  const isUnlock = String(row.order_type || row.purpose || "").includes("unlock");

  if (step === 1) {
    return isUnlock
      ? `🔓 Вы начали открытие контактов, но не завершили оплату.\n\n${serviceTitle ? `Услуга:\n<b>${escapeHtml(serviceTitle)}</b>\n\n` : ""}Сумма: <b>${amountSum} сум</b>\n\nНа странице Payme вводите только номер карты и срок карты. Телефон для входа в Payme вводить не обязательно.`
      : `💳 Вы начали оплату в Travella, но не завершили её.\n\nСумма: <b>${amountSum} сум</b>\n\nНа странице Payme вводите только номер карты и срок карты. Телефон для входа в Payme вводить не обязательно.`;
  }

  if (step === 2) {
    return isUnlock
      ? `⏳ Контакты всё ещё можно открыть.\n\n${serviceTitle ? `<b>${escapeHtml(serviceTitle)}</b>\n\n` : ""}Если Payme показывает поле телефона — это вход в Payme-аккаунт. Для оплаты картой достаточно номера карты и срока действия.`
      : `⏳ Ваш платёж Travella ещё не завершён.\n\nЕсли Payme показывает поле телефона — это вход в Payme-аккаунт. Для оплаты картой достаточно номера карты и срока действия.`;
  }

  return isUnlock
    ? `⚠️ Последнее напоминание по незавершённой оплате.\n\n${serviceTitle ? `<b>${escapeHtml(serviceTitle)}</b>\n\n` : ""}Ссылка на оплату ещё доступна. После оплаты контакты будут открыты автоматически.`
    : `⚠️ Последнее напоминание по незавершённой оплате Travella.\n\nСсылка на оплату ещё доступна. После оплаты статус обновится автоматически.`;
}

function buildSupportReminderText(row, step) {
  const amountSum = Math.round(Number(row.amount_tiyin || 0) / 100).toLocaleString("ru-RU");
  const serviceTitle = String(row.service_title || "").trim();

  if (step === 1) {
    return `❤️ Спасибо, что решили поддержать проект Travella.\n\nПлатёж не был завершён.\n\n${serviceTitle ? `Услуга:\n<b>${escapeHtml(serviceTitle)}</b>\n\n` : ""}Сумма поддержки: <b>${amountSum} сум</b>\n\nНа странице Payme вводите только номер карты и срок карты. Телефон для входа в Payme вводить не обязательно.`;
  }

  if (step === 2) {
    return `🙏 Ваша поддержка помогает усиливать доверие к поставщикам и развивать базу отказных туров.\n\nЕсли желание поддержать проект осталось, можно завершить оплату. В Payme телефон для авторизации можно не вводить.`;
  }

  return `⚠️ Последнее напоминание по поддержке проекта.\n\nПлатёж ещё можно завершить по ссылке ниже. Спасибо за участие в развитии Travella.`;
}

async function sendDuePaymeReminders({ dryRun = false, limit = 100 } = {}) {
  await ensureRecoveryColumns();
  await expireOldPaymeOrders({ dryRun: false });

  const maxLimit = Math.max(1, Math.min(toInt(limit, 100), 300));
  const result = {
    dryRun: !!dryRun,
    topup_candidates: 0,
    topup_sent: 0,
    support_candidates: 0,
    support_sent: 0,
    errors: [],
  };

  const topupQ = await pool.query(
    `
    SELECT
      o.id,
      o.client_id,
      o.service_id,
      o.order_type,
      o.purpose,
      o.amount,
      o.amount_tiyin,
      o.pay_url,
      o.created_at,
      COALESCE(o.reminder_count, 0) AS reminder_count,
      COALESCE(o.telegram_chat_id, c.telegram_chat_id, c.tg_chat_id) AS telegram_chat_id,
      c.name AS client_name,
      s.title AS service_title
    FROM topup_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN services s ON s.id = o.service_id
    WHERE LOWER(COALESCE(o.status, '')) = ANY($1::text[])
      AND COALESCE(c.is_test_account, false) = false
      AND COALESCE(o.reminder_count, 0) < 3
      AND o.pay_url IS NOT NULL
      AND TRIM(o.pay_url) <> ''
      AND COALESCE(o.telegram_chat_id, c.telegram_chat_id, c.tg_chat_id) IS NOT NULL
      AND o.created_at >= NOW() - interval '7 days'
      AND ${dueConditionSql("topup", "o")}
    ORDER BY o.created_at ASC
    LIMIT $2
    `,
    [TOPUP_ORDER_ACTIVE_STATUSES, maxLimit]
  );

  result.topup_candidates = topupQ.rowCount;

  for (const row of topupQ.rows) {
    const step = Math.min(Number(row.reminder_count || 0) + 1, 3);
    const guideUrl = buildPaymeGuideUrl(row.pay_url, {
      kind: "topup",
      orderId: row.id,
      serviceId: row.service_id,
    });

    if (!guideUrl) continue;

    if (!dryRun) {
      try {
        const ok = await tgSend(row.telegram_chat_id, buildTopupReminderText(row, step), {
          reply_markup: {
            inline_keyboard: [[{ text: "💳 Продолжить оплату", url: guideUrl }]],
          },
        });

        if (!ok) continue;

        await pool.query(
          `
          UPDATE topup_orders
             SET reminder_count = COALESCE(reminder_count, 0) + 1,
                 last_reminder_sent_at = NOW(),
                 reminder_1_sent_at = CASE WHEN $2 = 1 AND reminder_1_sent_at IS NULL THEN NOW() ELSE reminder_1_sent_at END,
                 reminder_2_sent_at = CASE WHEN $2 = 2 AND reminder_2_sent_at IS NULL THEN NOW() ELSE reminder_2_sent_at END,
                 reminder_3_sent_at = CASE WHEN $2 = 3 AND reminder_3_sent_at IS NULL THEN NOW() ELSE reminder_3_sent_at END,
                 meta = jsonb_set(
                   COALESCE(meta, '{}'::jsonb),
                   '{last_abandoned_reminder}',
                   jsonb_build_object('at', NOW(), 'step', $2),
                   true
                 )
           WHERE id = $1
          `,
          [row.id, step]
        );
      } catch (e) {
        result.errors.push({ table: "topup_orders", id: row.id, error: e?.message || String(e) });
        continue;
      }
    }

    result.topup_sent += 1;
  }

  const supportQ = await pool.query(
    `
    SELECT
      d.id,
      d.provider_id,
      d.service_id,
      d.amount_tiyin,
      d.payme_order_id,
      COALESCE(d.reminder_count, 0) AS reminder_count,
      COALESCE(d.telegram_chat_id, p.telegram_chat_id, p.tg_chat_id, o.telegram_chat_id) AS telegram_chat_id,
      COALESCE(o.pay_url, '') AS pay_url,
      p.name AS provider_name,
      s.title AS service_title
    FROM provider_support_donations d
    LEFT JOIN providers p ON p.id = d.provider_id
    LEFT JOIN topup_orders o ON o.id = d.payme_order_id
    LEFT JOIN services s ON s.id = d.service_id
    WHERE LOWER(COALESCE(d.status, '')) = ANY($1::text[])
      AND COALESCE(p.is_test_account, false) = false
      AND COALESCE(d.reminder_count, 0) < 3
      AND COALESCE(o.pay_url, '') <> ''
      AND COALESCE(d.telegram_chat_id, p.telegram_chat_id, p.tg_chat_id, o.telegram_chat_id) IS NOT NULL
      AND d.created_at >= NOW() - interval '7 days'
      AND ${dueConditionSql("support", "d")}
    ORDER BY d.created_at ASC
    LIMIT $2
    `,
    [SUPPORT_ACTIVE_STATUSES, maxLimit]
  );

  result.support_candidates = supportQ.rowCount;

  for (const row of supportQ.rows) {
    const step = Math.min(Number(row.reminder_count || 0) + 1, 3);
    const guideUrl = buildPaymeGuideUrl(row.pay_url, {
      kind: "support",
      orderId: row.payme_order_id,
      donationId: row.id,
      serviceId: row.service_id,
    });

    if (!guideUrl) continue;

    if (!dryRun) {
      try {
        const ok = await tgSend(row.telegram_chat_id, buildSupportReminderText(row, step), {
          reply_markup: {
            inline_keyboard: [[{ text: "❤️ Завершить поддержку", url: guideUrl }]],
          },
        });

        if (!ok) continue;

        await pool.query(
          `
          UPDATE provider_support_donations
             SET reminder_count = COALESCE(reminder_count, 0) + 1,
                 last_reminder_sent_at = NOW(),
                 reminder_1_sent_at = CASE WHEN $2 = 1 AND reminder_1_sent_at IS NULL THEN NOW() ELSE reminder_1_sent_at END,
                 reminder_2_sent_at = CASE WHEN $2 = 2 AND reminder_2_sent_at IS NULL THEN NOW() ELSE reminder_2_sent_at END,
                 reminder_3_sent_at = CASE WHEN $2 = 3 AND reminder_3_sent_at IS NULL THEN NOW() ELSE reminder_3_sent_at END,
                 meta = jsonb_set(
                   COALESCE(meta, '{}'::jsonb),
                   '{last_abandoned_reminder}',
                   jsonb_build_object('at', NOW(), 'step', $2),
                   true
                 )
           WHERE id = $1
          `,
          [row.id, step]
        );
      } catch (e) {
        result.errors.push({ table: "provider_support_donations", id: row.id, error: e?.message || String(e) });
        continue;
      }
    }

    result.support_sent += 1;
  }

  return result;
}

async function runAbandonedPaymeReminderJob() {
  try {
    const result = await sendDuePaymeReminders({ dryRun: false, limit: 100 });
    console.log("[payme-recovery] finished", result);
    return result;
  } catch (e) {
    console.error("[payme-recovery] failed", e);
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  ensureRecoveryColumns,
  expireOldPaymeOrders,
  sendDuePaymeReminders,
  runAbandonedPaymeReminderJob,
};
