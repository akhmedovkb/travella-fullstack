//backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

const TZ = "Asia/Tashkent";

// В какие часы спрашиваем (локально по Ташкенту)
const SLOTS_HOURS = [10, 14, 18];

// “Окно” в минутах от начала часа, когда разрешаем отправку.
// Например, 10:00–10:20, 14:00–14:20, 18:00–18:20
const WINDOW_MINUTES = 25;

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

// Получаем локальные компоненты времени в TZ без сторонних библиотек
function getLocalParts(date, timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // en-CA обычно даёт YYYY-MM-DD и компоненты
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const yyyy = map.year || "1970";
  const mm = map.month || "01";
  const dd = map.day || "01";
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);

  return {
    dateStr: `${yyyy}-${mm}-${dd}`, // YYYY-MM-DD
    hour,
    minute,
  };
}

// Определяем, какой слот сейчас активен (если мы в окне)
function getActiveSlot(now) {
  const { dateStr, hour, minute } = getLocalParts(now, TZ);

  if (!SLOTS_HOURS.includes(hour)) return null;
  if (minute < 0 || minute > WINDOW_MINUTES) return null;

  // slotKey используем как ключ в JSON (например "10", "14", "18")
  const slotKey = String(hour);

  return { dateStr, slotKey, hour, minute };
}

async function askActualReminder() {
  const now = new Date();
  const slot = getActiveSlot(now);

  // Если сейчас не 10/14/18 и не в окне — просто выходим
  if (!slot) return;

  const { dateStr, slotKey } = slot;

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

    // 1) Спрашиваем ТОЛЬКО пока актуально
    const isActualNow = isServiceActual(parsedDetails, row);
    if (!isActualNow) continue;

    /**
     * 2) 🔒 Антидубль на СЛОТ:
     * атомарно помечаем, что для (dateStr, slotKey) уже спросили.
     *
     * Храним в details:
     * details.tgActualReminder = { date: "YYYY-MM-DD", sent: { "10": true, "14": true, "18": true } }
     *
     * Условие:
     * - если date совпадает И sent[slotKey] уже true -> НЕ шлём
     * - если date другая -> сбрасываем sent и ставим текущий слот
     */
    const lockRes = await db.query(
      `
      UPDATE services
      SET
        tg_last_actual_check_at = NOW(),
        details = CASE
          WHEN (COALESCE(details::jsonb, '{}'::jsonb)->'tgActualReminder'->>'date') = $2
          THEN
            jsonb_set(
              COALESCE(details::jsonb, '{}'::jsonb),
              ARRAY['tgActualReminder','sent',$3],
              'true'::jsonb,
              true
            )
          ELSE
            jsonb_set(
              jsonb_set(
                COALESCE(details::jsonb, '{}'::jsonb),
                '{tgActualReminder,date}',
                to_jsonb($2::text),
                true
              ),
              '{tgActualReminder,sent}',
              jsonb_build_object($3, true),
              true
            )
        END
      WHERE id = $1
        AND (
          NOT (
            (COALESCE(details::jsonb, '{}'::jsonb)->'tgActualReminder'->>'date') = $2
            AND (COALESCE(details::jsonb, '{}'::jsonb)->'tgActualReminder'->'sent' ? $3)
          )
        )
      RETURNING id
      `,
      [id, dateStr, slotKey]
    );

    if (lockRes.rowCount === 0) {
      // Уже отправляли в этот слот сегодня (или другой инстанс успел)
      continue;
    }

    const text =
      `⏳ *Отказ ещё актуален?*\n\n` +
      `🧳 ${title}\n\n` +
      `Пожалуйста, подтвердите, чтобы услуга не осталась с устаревшим статусом.`;

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

      // ❗ если отправка не удалась — откатываем флаг слота,
      // чтобы можно было попробовать снова в том же слоте
      await db.query(
        `
        UPDATE services
        SET details = (
          COALESCE(details::jsonb, '{}'::jsonb)
          #- ARRAY['tgActualReminder','sent',$2]
        )
        WHERE id = $1
        `,
        [id, slotKey]
      );
    }
  }
}

module.exports = { askActualReminder };
