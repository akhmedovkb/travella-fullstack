// backend/jobs/askActualReminder.js
// Напоминалка "Отказ ещё актуален?" для refused_* услуг.
//  - Автослоты: 10:00 / 14:00 / 18:00 (Asia/Tashkent) с окном 25 минут
//  - Ручной запуск: forceSlot (10|14|18) и/или forceDay (YYYY-MM-DD)
//  - Антидубль: details.tgActualReminder = { date, sent:{ "10": true }, answeredDate? }
//  - Спрашиваем только если услуга сейчас актуальна (isServiceActual)
//  - Отправляем через CLIENT_BOT_TOKEN, чтобы кнопки работали

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual, normalizeDateInput } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

const TZ = "Asia/Tashkent";
const SLOTS_HOURS = [10, 14, 18];
const WINDOW_MINUTES = 25;

const CLIENT_BOT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

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

// локальная дата/время в TZ
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
    dateStr: `${yyyy}-${mm}-${dd}`,
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

function getActiveSlot(now, options = {}) {
  const forceSlot = normalizeSlotHour(options.forceSlot);
  const forcedDay =
    typeof options.forceDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.forceDay)
      ? options.forceDay
      : null;

  // ручной запуск
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

  // авто по окну
  const { dateStr, hour, minute } = getLocalParts(now, TZ);
  if (!SLOTS_HOURS.includes(hour)) return null;
  if (minute < 0 || minute > WINDOW_MINUTES) return null;

  return { dateStr, slotKey: String(hour), hour, minute, forced: false };
}

function pickReminderChat(row) {
  const v =
    row.telegram_refused_chat_id ||
    row.telegram_chat_id ||
    row.telegram_web_chat_id ||
    null;
  return v ? Number(v) : null;
}

function buildDetailsSnippet(details) {
  const d = details || {};
  const parts = [];

  const to = d.directionCountry || d.directionTo || d.direction || "";
  const from = d.directionFrom || "";
  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(String(to));

  const start = normalizeDateInput(d.startDate) || d.departureFlightDate || d.startDate;
  const end = normalizeDateInput(d.endDate) || d.returnFlightDate || d.endDate;
  if (start || end) parts.push(`${start || "?"} — ${end || "?"}`);

  if (d.hotel) parts.push(String(d.hotel));

  return parts.filter(Boolean).slice(0, 3).join(" · ");
}

async function askActualReminder(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const slot = getActiveSlot(now, options);

  const stats = {
    scanned: 0,
    actual: 0,
    locked: 0,
    sent: 0,
    failed: 0,
    skippedAnsweredToday: 0,
    skippedNoChat: 0,
  };

  if (!slot) return { ok: true, slot: null, stats };

  const { dateStr, slotKey } = slot;

  const res = await db.query(
    `
    SELECT
      s.id,
      s.title,
      s.category,
      s.details,
      p.telegram_chat_id,
      p.telegram_refused_chat_id,
      p.telegram_web_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category LIKE 'refused_%'
      AND s.status IN ('approved','published')
      AND (
        p.telegram_refused_chat_id IS NOT NULL
        OR p.telegram_chat_id IS NOT NULL
        OR p.telegram_web_chat_id IS NOT NULL
      )
    `
  );

  for (const row of res.rows) {
    stats.scanned += 1;

    const chatId = pickReminderChat(row);
    if (!chatId) {
      stats.skippedNoChat += 1;
      continue;
    }

    const parsedDetails = safeJsonParseMaybe(row.details);

    // только если сейчас актуально
    const isActualNow = isServiceActual(parsedDetails, row);
    if (!isActualNow) continue;
    stats.actual += 1;

    // если уже ответили сегодня — не дергать
    const meta = parsedDetails?.tgActualReminder || {};
    if (meta && meta.answeredDate === dateStr) {
      stats.skippedAnsweredToday += 1;
      continue;
    }

    // 🔒 антидубль на слот (между инстансами тоже)
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
        AND NOT (
          (COALESCE(details::jsonb, '{}'::jsonb)->'tgActualReminder'->>'date') = $2
          AND (COALESCE(details::jsonb, '{}'::jsonb)->'tgActualReminder'->'sent' ? $3)
        )
      RETURNING id
      `,
      [row.id, dateStr, slotKey]
    );

    if (lockRes.rowCount === 0) continue;
    stats.locked += 1;

    const snippet = buildDetailsSnippet(parsedDetails);

    const text =
      `<b>⏳ Отказ ещё актуален?</b>\n` +
      `🧾 ID: <code>${row.id}</code>\n` +
      (row.title ? `🧳 <b>${String(row.title)}</b>\n` : "") +
      (snippet ? `ℹ️ ${snippet}\n` : "") +
      `\nПожалуйста, подтвердите, чтобы объявление не осталось с устаревшим статусом.`;

    try {
      await tgSend(
        chatId,
        text,
        {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: buildSvcActualKeyboard(row.id, { isActual: isActualNow }),
        },
        CLIENT_BOT_TOKEN
      );

      stats.sent += 1;
    } catch (e) {
      stats.failed += 1;

      // откатим флаг слота
      await db.query(
        `
        UPDATE services
        SET details = (
          COALESCE(details::jsonb, '{}'::jsonb)
          #- ARRAY['tgActualReminder','sent',$2]
        )
        WHERE id = $1
        `,
        [row.id, slotKey]
      );
    }
  }

  return { ok: true, slot, stats };
}

module.exports = { askActualReminder, getActiveSlot };
