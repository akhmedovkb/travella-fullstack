const pool = require("../db");
const { tgSend } = require("../utils/telegram");
const {
  ensureEnrollment,
  formatLesson,
  lessonKeyboard,
  completeCurrentLesson,
} = require("../services/telegramLearningService");
const { isNotificationEnabled } = require("../services/telegramOperationsService");

const CLIENT_TOKEN = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();

function tashkentHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
}

async function enrollLinkedUsers(db = pool) {
  const providers = await db.query(
    `SELECT id, telegram_refused_chat_id::text AS chat_id
       FROM providers
      WHERE telegram_refused_chat_id IS NOT NULL
        AND TRIM(telegram_refused_chat_id::text) <> ''`
  );
  const clients = await db.query(
    `SELECT id, telegram_chat_id::text AS chat_id
       FROM clients
      WHERE telegram_chat_id IS NOT NULL
        AND TRIM(telegram_chat_id::text) <> ''`
  );
  for (const row of providers.rows) {
    await ensureEnrollment({ role: "provider", userId: row.id, chatId: row.chat_id, db });
  }
  for (const row of clients.rows) {
    await ensureEnrollment({ role: "client", userId: row.id, chatId: row.chat_id, db });
  }
  return providers.rowCount + clients.rowCount;
}

async function claimDueLessons(limit = 30, db = pool) {
  const candidates = await db.query(
    `SELECT e.id AS enrollment_id, e.chat_id, e.next_lesson_position,
            l.id AS lesson_id, l.position, l.title AS lesson_title, l.message_html,
            l.action_kind, l.action_label,
            (SELECT COUNT(*)::int FROM telegram_learning_lessons x WHERE x.campaign_id = e.campaign_id) AS lesson_count
       FROM telegram_learning_enrollments e
       JOIN telegram_learning_campaigns c ON c.id = e.campaign_id AND c.status = 'active'
       JOIN telegram_learning_lessons l
         ON l.campaign_id = e.campaign_id AND l.position = e.next_lesson_position
      WHERE e.status = 'active'
        AND e.next_send_at <= NOW()
        AND (e.snoozed_until IS NULL OR e.snoozed_until <= NOW())
        AND (e.last_sent_at IS NULL OR e.last_sent_at <= NOW() - INTERVAL '20 hours')
      ORDER BY e.next_send_at ASC
      LIMIT $1`,
    [limit]
  );
  const claimed = [];
  for (const row of candidates.rows) {
    const claim = await db.query(
      `INSERT INTO telegram_learning_deliveries
         (enrollment_id, lesson_id, status, source, error, updated_at)
       VALUES ($1, $2, 'pending', 'scheduled', NULL, NOW())
       ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
         SET status = 'pending', error = NULL, source = 'scheduled', updated_at = NOW()
       WHERE telegram_learning_deliveries.status = 'failed'
          OR (telegram_learning_deliveries.status = 'pending'
              AND telegram_learning_deliveries.updated_at <= NOW() - INTERVAL '30 minutes')
       RETURNING id`,
      [row.enrollment_id, row.lesson_id]
    );
    if (claim.rowCount) claimed.push(row);
  }
  return claimed;
}

async function runTelegramLearningJob({ force = false, db = pool } = {}) {
  if (!CLIENT_TOKEN) return { skipped: true, reason: "NO_CLIENT_BOT_TOKEN" };
  const hour = tashkentHour();
  if (!force && (hour < 9 || hour >= 21)) {
    return { skipped: true, reason: "QUIET_HOURS", hour };
  }

  const enrolled = await enrollLinkedUsers(db);
  const lessons = await claimDueLessons(30, db);
  let sent = 0;
  let failed = 0;

  for (const lesson of lessons) {
    try {
      if (!(await isNotificationEnabled(lesson.chat_id, "learning_updates", db))) {
        await completeCurrentLesson(lesson.enrollment_id, lesson.lesson_id, "preference_skipped", db);
        continue;
      }
      const ok = await tgSend(
        lesson.chat_id,
        formatLesson(lesson),
        { reply_markup: lessonKeyboard(lesson) },
        CLIENT_TOKEN,
        true
      );
      if (!ok) throw new Error("Telegram send returned false");
      await completeCurrentLesson(lesson.enrollment_id, lesson.lesson_id, "scheduled", db);
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.query(
        `INSERT INTO telegram_learning_deliveries (enrollment_id, lesson_id, status, source, error)
         VALUES ($1, $2, 'failed', 'scheduled', $3)
         ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
           SET status = 'failed', error = EXCLUDED.error, updated_at = NOW()`,
        [lesson.enrollment_id, lesson.lesson_id, String(error?.message || error).slice(0, 1000)]
      ).catch(() => {});
      await db.query(
        `UPDATE telegram_learning_enrollments
            SET next_send_at = NOW() + INTERVAL '6 hours', updated_at = NOW()
          WHERE id = $1`,
        [lesson.enrollment_id]
      ).catch(() => {});
    }
  }
  return { enrolled, due: lessons.length, sent, failed };
}

module.exports = { runTelegramLearningJob, enrollLinkedUsers, claimDueLessons, tashkentHour };

