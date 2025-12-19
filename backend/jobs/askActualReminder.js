//backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");

function safeJsonParseMaybe(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function askActualReminder() {
  const now = new Date();

  // не чаще одного раза в 24 часа на одну услугу
  const cooldownHours = 24;

  const res = await db.query(`
    SELECT
      s.id,
      s.title,
      s.details,
      s.tg_last_actual_check_at,
      p.telegram_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category LIKE 'refused_%'
      AND s.status IN ('approved','published')
      AND p.telegram_chat_id IS NOT NULL
  `);

  for (const row of res.rows) {
    const { id, title, details, tg_last_actual_check_at, telegram_chat_id } = row;

    // cooldown
    if (tg_last_actual_check_at) {
      const diffH = (now - new Date(tg_last_actual_check_at)) / 36e5;
      if (diffH < cooldownHours) continue;
    }

    const parsedDetails = safeJsonParseMaybe(details);
    
    // актуальность (проверяем только распарсенный объект)
    if (!isServiceActual(parsedDetails, row)) continue;

    /**
     * 🔒 Антидубль:
     * атомарно "бронируем" право на отправку
     * (если другой инстанс уже обновил tg_last_actual_check_at — rowCount = 0)
     */
    const lockRes = await db.query(
      `
      UPDATE services
      SET tg_last_actual_check_at = NOW()
      WHERE id = $1
        AND (
          tg_last_actual_check_at IS NULL
          OR tg_last_actual_check_at < NOW() - INTERVAL '24 hours'
        )
      RETURNING id
      `,
      [id]
    );

    if (lockRes.rowCount === 0) {
      // другой процесс уже отправил
      continue;
    }

    const text =
      `⏳ *Отказ ещё актуален?*\n\n` +
      `🧳 ${title}\n\n` +
      `Пожалуйста, подтвердите, чтобы услуга не осталась с устаревшим статусом.`;
    
    // посчитать статус актуальности один раз
    const isActualNow = isServiceActual(parsedDetails, row);

    try {
      await tgSend(telegram_chat_id, text, {
        parse_mode: "Markdown",
        reply_markup: buildSvcActualKeyboard(id, { isActual: isActualNow }),
      });

    } catch (e) {
      console.error("[askActualReminder] tgSend failed:", {
        serviceId: id,
        chatId: telegram_chat_id,
        error: e?.message || e,
      });

      // ❗ если отправка не удалась — откатываем lock,
      // чтобы можно было попробовать снова позже
      await db.query(
        `UPDATE services SET tg_last_actual_check_at = NULL WHERE id = $1`,
        [id]
      );
    }
  }
}

module.exports = { askActualReminder };
