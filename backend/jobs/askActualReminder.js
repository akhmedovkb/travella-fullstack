//backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

const CLIENT_BOT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

// Слоты опроса (по Ташкенту)
const SLOTS = new Set([10, 14, 18]);
const TZ = "Asia/Tashkent";

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

function getTashkentNowParts() {
  // Надёжно получаем hour + дату YYYY-MM-DD в TZ
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour") || 0);

  const dayKey = `${year}-${month}-${day}`; // YYYY-MM-DD
  return { hour, dayKey };
}

function getCurrentSlotHour() {
  // Можно принудительно тестировать без ожидания 10/14/18:
  // ASK_ACTUAL_FORCE_SLOT=10 (или 14/18) + запускаешь job вручную
  const forced = Number(process.env.ASK_ACTUAL_FORCE_SLOT);
  if (Number.isFinite(forced) && SLOTS.has(forced)) return forced;

  const { hour } = getTashkentNowParts();
  return SLOTS.has(hour) ? hour : null;
}

function getDayKey() {
  // Можно принудительно тестировать “как будто сегодня другая дата”:
  // ASK_ACTUAL_FORCE_DAY=2025-12-19
  const forcedDay = String(process.env.ASK_ACTUAL_FORCE_DAY || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(forcedDay)) return forcedDay;

  const { dayKey } = getTashkentNowParts();
  return dayKey;
}

async function askActualReminder() {
  const slotHour = getCurrentSlotHour();
  if (!slotHour) {
    // не наш слот — ничего не делаем (защита от случайных запусков)
    return;
  }

  const dayKey = getDayKey();
  const reminderKey = `${dayKey}_${slotHour}`; // например: 2025-12-19_10

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
    const { id, title, details, telegram_chat_id } = row;

    const parsedDetails = safeJsonParseMaybe(details);

    // 1) Спрашиваем ТОЛЬКО пока услуга актуальна
    const isActualNow = isServiceActual(parsedDetails, row);
    if (!isActualNow) continue;

    // 2) Не дублируем в рамках одного слота дня
    const already =
      parsedDetails?.tg_actual_reminders &&
      parsedDetails.tg_actual_reminders[reminderKey] === true;

    if (already) continue;

    /**
     * 3) Антидубль (multi-instance):
     * атомарно ставим отметку "этот слот сегодня уже отправлен"
     * если другой инстанс успел раньше — rowCount=0
     */
    const lockRes = await db.query(
      `
      UPDATE services
      SET
        details = jsonb_set(
          COALESCE(details::jsonb, '{}'::jsonb),
          $2::text[],
          'true'::jsonb,
          true
        ),
        tg_last_actual_check_at = NOW()
      WHERE id = $1
        AND COALESCE(
          (COALESCE(details::jsonb, '{}'::jsonb)->'tg_actual_reminders'->>$3),
          'false'
        ) <> 'true'
      RETURNING id
      `,
      [id, ["tg_actual_reminders", reminderKey], reminderKey]
    );

    if (lockRes.rowCount === 0) continue;

    const text =
      `⏳ *Отказ ещё актуален?*\n\n` +
      `🧳 ${title}\n\n` +
      `Пожалуйста, подтвердите, чтобы услуга не осталась с устаревшим статусом.`;

    try {
      // Для refused_* — шлём через новый бот (если есть), иначе через старый (fallback)
      const tokenOverride = CLIENT_BOT_TOKEN ? CLIENT_BOT_TOKEN : "";

      await tgSend(
        telegram_chat_id,
        text,
        {
          parse_mode: "Markdown",
          reply_markup: buildSvcActualKeyboard(id, { isActual: isActualNow }),
        },
        tokenOverride
      );
    } catch (e) {
      console.error("[askActualReminder] tgSend failed:", {
        serviceId: id,
        chatId: telegram_chat_id,
        error: e?.message || e,
      });

      // Если отправка не удалась — откатываем отметку слота, чтобы попробовать снова
      try {
        await db.query(
          `
          UPDATE services
          SET details = (
            COALESCE(details::jsonb, '{}'::jsonb)
            #- $2::text[]
          )
          WHERE id = $1
          `,
          [id, ["tg_actual_reminders", reminderKey]]
        );
      } catch (rollbackErr) {
        console.error("[askActualReminder] rollback failed:", rollbackErr?.message || rollbackErr);
      }
    }
  }
}

module.exports = { askActualReminder };
