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

const ACTUAL_REMINDER_CATEGORIES = Object.freeze([
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
  "refused_event_ticket",
  "author_tour",
]);

function supportsActualReminderCategory(category) {
  return ACTUAL_REMINDER_CATEGORIES.includes(String(category || "").trim().toLowerCase());
}

// Сколько дней подряд можно игнорировать напоминания, прежде чем снять с актуальности
// (считаем по дням в Ташкенте)
const MAX_IGNORED_DAYS = Number(process.env.ACTUAL_REMINDER_MAX_IGNORED_DAYS || 2);

// ✅ Токен Bot Otkaznyx Turov (client bot)
const CLIENT_TG_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

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

// ✅ Всегда отправляем через Bot Otkaznyx Turov
function pickTokenForChat() {
  return CLIENT_TG_TOKEN;
}

function getMeta(detailsObj) {
  const d = detailsObj && typeof detailsObj === "object" ? detailsObj : {};
  return d.tg_actual_reminders_meta && typeof d.tg_actual_reminders_meta === "object"
    ? d.tg_actual_reminders_meta
    : {};
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function saveDetails(serviceId, detailsObj) {
  await db.query(`UPDATE services SET details = $2 WHERE id = $1`, [
    serviceId,
    JSON.stringify(detailsObj || {}),
  ]);
}

async function askActualReminder(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const slot = getActiveSlot(now, options);

  // Если сейчас не 10/14/18 и не ручной forceSlot — выходим
  if (!slot) {
    return { ok: true, skipped: true, reason: "no_active_slot" };
  }

  // ✅ Если токена нового бота нет — не пытаемся слать
  if (!CLIENT_TG_TOKEN) {
    console.warn("[askActualReminder] TELEGRAM_CLIENT_BOT_TOKEN is empty — skip sending");
    return { ok: false, skipped: true, reason: "no_client_token" };
  }

  const { dateStr, slotKey } = slot;

  const stats = {
    ok: true,
    slot: { dateStr, slotKey, hour: slot.hour, minute: slot.minute, forced: slot.forced },
    scanned: 0,
    eligible_actual: 0,
    skipped_confirmed_today: 0,
    skipped_not_actual: 0,
    locked_out: 0,
    sent: 0,
    send_failed: 0,
  };

  // ✅ Ключевая правка:
  // 1) Берём ТОЛЬКО telegram_refused_chat_id
  // 2) Отсекаем всех без него (те самые 110 "старых")
  const res = await db.query(`
    SELECT
      s.id,
      s.title,
      s.category,
      s.details,
      s.tg_last_actual_check_at,
      p.telegram_refused_chat_id AS telegram_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category = ANY($1::text[])
      AND s.status IN ('approved','published')
      AND s.deleted_at IS NULL
      AND p.telegram_refused_chat_id IS NOT NULL
  `, [ACTUAL_REMINDER_CATEGORIES]);

  for (const row of res.rows) {
    stats.scanned += 1;

    const { id, title, details, telegram_chat_id } = row;
    const parsedDetails = safeJsonParseMaybe(details);
    const meta = getMeta(parsedDetails);

    // 0) Если стоит lockUntil (админ/система заморозила) — не трогаем до окончания
    if (meta.lockUntil) {
      const lock = new Date(meta.lockUntil);
      if (!Number.isNaN(lock.getTime()) && lock.getTime() > Date.now()) {
        stats.locked_out += 1;
        continue;
      }
    }

    // 1) Если уже отвечал сегодня — НЕ спрашиваем вообще
    if (meta.lastConfirmedAt) {
      const last = new Date(meta.lastConfirmedAt);
      if (!Number.isNaN(last.getTime())) {
        const lastLocal = getLocalParts(last, TZ).dateStr;
        if (lastLocal === dateStr) {
          stats.skipped_confirmed_today += 1;
          continue;
        }
      }
    }

    // 2) Учёт игнора: если вчера (или раньше) мы слали напоминание, а подтверждения нет,
    // то увеличиваем ignoredDays 1 раз за день. После MAX_IGNORED_DAYS — снимаем с актуальности.
    const lastSentAt = meta.lastSentAt ? new Date(meta.lastSentAt) : null;
    const lastConfirmedAt = meta.lastConfirmedAt ? new Date(meta.lastConfirmedAt) : null;
    const lastIgnoredDate = typeof meta.lastIgnoredDate === "string" ? meta.lastIgnoredDate : null;

    const lastSentLocal =
      lastSentAt && !Number.isNaN(lastSentAt.getTime())
        ? getLocalParts(lastSentAt, TZ).dateStr
        : null;
    const lastConfirmedLocal =
      lastConfirmedAt && !Number.isNaN(lastConfirmedAt.getTime())
        ? getLocalParts(lastConfirmedAt, TZ).dateStr
        : null;

    const hasUnconfirmedPrevSend = Boolean(
      lastSentLocal &&
        lastSentLocal !== dateStr &&
        (!lastConfirmedLocal || lastConfirmedLocal !== lastSentLocal)
    );

    if (hasUnconfirmedPrevSend && lastIgnoredDate !== dateStr) {
      const nextIgnored = Math.max(0, Number(meta.ignoredDays || 0)) + 1;
      parsedDetails.tg_actual_reminders_meta = {
        ...meta,
        ignoredDays: nextIgnored,
        lastIgnoredDate: dateStr,
      };

      // если превысили лимит — снимаем с актуальности сразу
      if (MAX_IGNORED_DAYS > 0 && nextIgnored >= MAX_IGNORED_DAYS) {
        parsedDetails.isActive = false;
        await saveDetails(id, parsedDetails);

        // мягкое уведомление провайдеру
        try {
          const tokenOverride = pickTokenForChat();
          await tgSend(
            telegram_chat_id,
            `⛔ <b>Снято с актуальности</b> (нет ответа на напоминания)\n\n` +
              `🧾 ID: <code>#R${id}</code>\n` +
              `🧳 Услуга: <b>${escapeHtml(title || "Услуга")}</b>\n\n` +
              `Если предложение снова актуально — откройте услугу в боте и подтвердите/продлите.`,
            {
              parse_mode: "HTML",
              reply_markup: buildSvcActualKeyboard(id, { isActual: false }),
            },
            tokenOverride,
            false
          );
        } catch {
          // не критично
        }

        stats.skipped_not_actual += 1;
        continue;
      }

      // сохраняем обновлённую meta даже если дальше будем отправлять напоминание
      await saveDetails(id, parsedDetails);
    }

    // 3) Спрашиваем ТОЛЬКО пока актуально
    const isActualNow = isServiceActual(parsedDetails, row);
    if (!isActualNow) {
      stats.skipped_not_actual += 1;
      continue;
    }
    stats.eligible_actual += 1;

    // 4) 🔒 Антидубль на слот
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
      stats.locked_out += 1;
      continue;
    }

    // 4.1) Зафиксируем, что напоминание сейчас уходит (для статистики/анти-игнора)
    try {
      const qDet = await db.query(`SELECT details FROM services WHERE id = $1 LIMIT 1`, [id]);
      const curDetails = safeJsonParseMaybe(qDet.rows?.[0]?.details);
      const curMeta = getMeta(curDetails);
      curDetails.tg_actual_reminders_meta = {
        ...curMeta,
        lastSentAt: now.toISOString(),
        lastSentBy: "job",
        lastSentSlot: slotKey,
        lastSendOk: null,
      };
      await saveDetails(id, curDetails);
    } catch {
      // не критично
    }

    // 5) Текст — в HTML, чтобы не падало на символах вроде "5*" в названиях
    const text =
      `⏳ <b>Предложение ещё актуально?</b>\n\n` +
      `🧾 <b>ID:</b> <code>#R${id}</code>\n` +
      `🧳 <b>Услуга:</b> <b>${escapeHtml(title || "Услуга")}</b>\n\n` +
      `Нажмите кнопку ниже 👇`;

    const tokenOverride = pickTokenForChat();

    try {
      const ok = await tgSend(
        telegram_chat_id,
        text,
        {
          parse_mode: "HTML",
          reply_markup: buildSvcActualKeyboard(id, { isActual: true }),
        },
        tokenOverride,
        false
      );

      if (ok) {
        stats.sent += 1;
        try {
          const qDet = await db.query(`SELECT details FROM services WHERE id = $1 LIMIT 1`, [id]);
          const curDetails = safeJsonParseMaybe(qDet.rows?.[0]?.details);
          const curMeta = getMeta(curDetails);
          curDetails.tg_actual_reminders_meta = { ...curMeta, lastSendOk: true };
          await saveDetails(id, curDetails);
        } catch {}
      } else {
        throw new Error("tgSend returned false");
      }
    } catch (e) {
      stats.send_failed += 1;

      // отметим, что отправка не удалась
      try {
        const fresh = await db.query(`SELECT details FROM services WHERE id = $1`, [id]);
        const latestDetails = safeJsonParseMaybe(fresh.rows?.[0]?.details);
        const latestMeta = getMeta(latestDetails);
        latestDetails.tg_actual_reminders_meta = {
          ...latestMeta,
          lastSentAt: new Date().toISOString(),
          lastSentBy: "job",
          lastSentSlot: slotKey,
          lastSendOk: false,
        };
        await saveDetails(id, latestDetails);
      } catch {
        // ignore
      }

      console.error("[askActualReminder] tgSend failed:", {
        serviceId: id,
        chatId: telegram_chat_id,
        error: e?.message || e,
      });

      // откатываем флаг слота
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

  return stats;
}

module.exports = {
  ACTUAL_REMINDER_CATEGORIES,
  supportsActualReminderCategory,
  askActualReminder,
};
