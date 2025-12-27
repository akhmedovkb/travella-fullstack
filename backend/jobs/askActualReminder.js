// backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

const TZ = "Asia/Tashkent";

// В какие часы спрашиваем (локально по Ташкенту)
const SLOTS_HOURS = [10, 14, 18];

// “Окно” в минутах от начала часа для авто-планировщика
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

function normalizeSlotHour(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (!SLOTS_HOURS.includes(n)) return null;
  return n;
}

/**
 * options:
 * - now?: Date
 * - forceSlot?: 10|14|18   (ручной запуск слота)
 * - forceDay?: "YYYY-MM-DD" (ручной запуск дня)
 */
function getActiveSlot(now, options = {}) {
  const forceSlot = normalizeSlotHour(options.forceSlot);
  const forcedDay =
    typeof options.forceDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.forceDay)
      ? options.forceDay
      : null;

  // РУЧНОЙ запуск: игнорируем “окно минут”
  if (forceSlot) {
    const { dateStr } = getLocalParts(now, TZ);
    return {
      dateStr: forcedDay || dateStr,
      slotKey: String(forceSlot),
      hour: forceSlot,
      minute: 0,
      forced: true,
    };
  }

  // АВТО-режим по окну 10/14/18
  const { dateStr, hour, minute } = getLocalParts(now, TZ);

  if (!SLOTS_HOURS.includes(hour)) return null;
  if (minute < 0 || minute > WINDOW_MINUTES) return null;

  return { dateStr, slotKey: String(hour), hour, minute, forced: false };
}

/**
 * Выбор куда слать напоминание:
 * - приоритет: telegram_refused_chat_id (новый бот) -> telegram_web_chat_id -> telegram_chat_id
 * - токен:
 *    - если используем telegram_refused_chat_id => TELEGRAM_CLIENT_BOT_TOKEN
 *    - иначе => старый (без tokenOverride)
 * - если отправка новым ботом не удалась — делаем fallback на старого (вдруг человек не запускал нового бота)
 */
function pickReminderDestination(row) {
  const refusedChatId = row.telegram_refused_chat_id || null;
  const webChatId = row.telegram_web_chat_id || null;
  const oldChatId = row.telegram_chat_id || null;

  const chatId = refusedChatId || webChatId || oldChatId || null;

  const clientToken = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
  const useClientBot = Boolean(refusedChatId && clientToken);

  return {
    chatId,
    useClientBot,
    clientToken,
  };
}

async function askActualReminder(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const slot = getActiveSlot(now, options);
  if (!slot) {
    return {
      ok: true,
      skipped: true,
      reason: "no_active_slot",
      stats: {
        scanned: 0,
        actual: 0,
        locked: 0,
        sent: 0,
        failed: 0,
        skippedConfirmedToday: 0,
        skippedNoChat: 0,
      },
    };
  }

  const { dateStr, slotKey } = slot;

  const stats = {
    scanned: 0,
    actual: 0,
    locked: 0,
    sent: 0,
    failed: 0,
    skippedConfirmedToday: 0,
    skippedNoChat: 0,
  };

  const res = await db.query(`
    SELECT
      s.id,
      s.title,
      s.details,
      s.tg_last_actual_check_at,

      p.telegram_chat_id,
      p.telegram_web_chat_id,
      p.telegram_refused_chat_id

    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category LIKE 'refused_%'
      AND s.status IN ('approved','published')
      AND (
        p.telegram_refused_chat_id IS NOT NULL
        OR p.telegram_web_chat_id IS NOT NULL
        OR p.telegram_chat_id IS NOT NULL
      )
  `);

  for (const row of res.rows) {
    stats.scanned += 1;

    const { id, title, details } = row;
    const parsedDetails = safeJsonParseMaybe(details);

    // 0) Если уже отвечал сегодня — не спрашиваем вообще
    const meta = parsedDetails?.tg_actual_reminders_meta || parsedDetails?.tgActualMeta || {};
    if (meta.lastConfirmedAt) {
      const last = new Date(meta.lastConfirmedAt);
      if (!Number.isNaN(last.getTime())) {
        const lastLocal = getLocalParts(last, TZ).dateStr;
        if (lastLocal === dateStr) {
          stats.skippedConfirmedToday += 1;
          continue;
        }
      }
    }

    // 1) Спрашиваем ТОЛЬКО пока актуально
    const isActualNow = isServiceActual(parsedDetails, row);
    if (!isActualNow) continue;
    stats.actual += 1;

    const dest = pickReminderDestination(row);
    if (!dest.chatId) {
      stats.skippedNoChat += 1;
      continue;
    }

    // 2) 🔒 Антидубль на слот
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
      continue;
    }
    stats.locked += 1;

    const text =
      `⏳ *Отказ ещё актуален?*\n\n` +
      `🧳 ${title}\n\n` +
      `Пожалуйста, подтвердите, чтобы услуга не осталась с устаревшим статусом.`;

    const extra = {
      parse_mode: "Markdown",
      reply_markup: buildSvcActualKeyboard(id, { isActual: isActualNow }),
      disable_web_page_preview: true,
    };

    try {
      // 3) Пытаемся отправить:
      // - если есть telegram_refused_chat_id => сначала новым ботом
      // - если не получилось — fallback на старый
      let ok = false;

      if (dest.useClientBot) {
        ok = await tgSend(dest.chatId, text, extra, dest.clientToken);
        if (!ok) {
          ok = await tgSend(dest.chatId, text, extra); // fallback старым
        }
      } else {
        ok = await tgSend(dest.chatId, text, extra); // старым
      }

      if (ok) {
        stats.sent += 1;
        continue;
      }

      // если дошли сюда — значит tgSend вернул false
      throw new Error("tgSend returned false");
    } catch (e) {
      stats.failed += 1;

      console.error("[askActualReminder] tgSend failed:", {
        serviceId: id,
        chatId: dest.chatId,
        error: e?.message || e,
      });

      // откатываем флаг слота (чтобы можно было повторить)
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

  return {
    ok: true,
    slot,
    stats,
  };
}

module.exports = { askActualReminder };
