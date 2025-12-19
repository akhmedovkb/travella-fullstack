// backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

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

/**
 * Ключ слота: YYYY-MM-DD_HH (например 2025-12-19_10)
 * Храним в details.tg_actual_reminders[slotKey] = ISO timestamp
 */
function buildSlotKey(now, slotHour, tzOffsetMinutes = 300) {
  // tzOffsetMinutes=300 для Asia/Tashkent (+05:00).
  // Мы не делаем сложный TZ-конвертер: job запускается планировщиком в нужные часы.
  // Но для force режима нам нужно стабильно строить день/слот.
  const t = new Date(now.getTime() + tzOffsetMinutes * 60 * 1000);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(slotHour).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}`;
}

function pickSlotHourFromNow(now, tzOffsetMinutes = 300) {
  // Определяем "ближайший слот" по локальному часу Tashkent.
  const t = new Date(now.getTime() + tzOffsetMinutes * 60 * 1000);
  const h = t.getUTCHours();
  if (h < 12) return 10;
  if (h < 16) return 14;
  return 18;
}

function cleanupReminderMap(map, keepDays = 14) {
  const out = { ...(map || {}) };
  const now = Date.now();
  const keepMs = keepDays * 24 * 3600 * 1000;

  for (const k of Object.keys(out)) {
    // ожидаем формат YYYY-MM-DD_HH
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})$/.exec(k);
    if (!m) {
      delete out[k];
      continue;
    }
    const [_, Y, M, D, H] = m;
    // интерпретируем как "локальную дату слота" в UTC (+00), это только для очистки
    const dt = Date.UTC(Number(Y), Number(M) - 1, Number(D), Number(H), 0, 0);
    if (!Number.isFinite(dt) || now - dt > keepMs) delete out[k];
  }
  return out;
}

function getMeta(details) {
  const d = details || {};
  const meta = (d.tg_actual_reminders_meta && typeof d.tg_actual_reminders_meta === "object")
    ? d.tg_actual_reminders_meta
    : {};

  return {
    totalSent: Number(meta.totalSent || 0),
    lastSentAt: meta.lastSentAt || null,
    lastConfirmedAt: meta.lastConfirmedAt || null,
    lastSlotKeySent: meta.lastSlotKeySent || null,
    ignoredDays: Number(meta.ignoredDays || 0), // подряд дней, когда не подтверждали
  };
}

async function setServiceDetails(serviceId, newDetails) {
  await db.query(
    `UPDATE services SET details = $2 WHERE id = $1`,
    [serviceId, JSON.stringify(newDetails)]
  );
}

/**
 * Если игнор N дней подряд — автоматически снимаем актуальность:
 * details.isActive = false
 */
async function autoDeactivateIfIgnored({ serviceId, providerChatId, details, ignoredDays, thresholdDays, clientBotToken }) {
  if (ignoredDays < thresholdDays) return false;

  const next = { ...(details || {}) };
  next.isActive = false;

  // чтобы не продолжать считать "ignoredDays" бесконечно
  const meta = getMeta(next);
  meta.ignoredDays = thresholdDays; // фиксируем
  next.tg_actual_reminders_meta = {
    ...meta,
    autoDeactivatedAt: new Date().toISOString(),
  };

  await setServiceDetails(serviceId, next);

  const text =
    `⚠️ <b>Услуга снята с актуальности</b>\n\n` +
    `Мы не получили подтверждение актуальности несколько дней подряд.\n` +
    `Если услуга всё ещё актуальна — зайдите в кабинет и активируйте её снова.\n\n` +
    `🔗 Кабинет: ${(process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "")}/dashboard/services`;

  // важно: для refused_* — шлём через новый клиентский бот (если есть), иначе через старого (tgSend сам сделает fallback на BOT_TOKEN)
  await tgSend(providerChatId, text, { parse_mode: "HTML" }, clientBotToken || "");
  return true;
}

/**
 * askActualReminder:
 * - НЕ использует tg_last_actual_check_at
 * - антидубль по details.tg_actual_reminders[slotKey]
 * - трекает ignoredDays (если ни разу не подтверждали)
 */
async function askActualReminder(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  // настройки
  const TZ_OFFSET_MIN = 300; // Asia/Tashkent (+05:00)
  const KEEP_DAYS = Number(process.env.ASK_ACTUAL_KEEP_DAYS || 14);
  const IGNORE_DAYS_THRESHOLD = Number(process.env.ASK_ACTUAL_IGNORE_DAYS || 3);

  // принудительный режим (для теста / админ-эндпойнта)
  const forceDay = options.forceDay || process.env.ASK_ACTUAL_FORCE_DAY || ""; // YYYY-MM-DD
  const forceSlot = Number(options.forceSlot || process.env.ASK_ACTUAL_FORCE_SLOT || 0); // 10/14/18

  let slotHour = forceSlot;
  if (![10, 14, 18].includes(slotHour)) {
    slotHour = pickSlotHourFromNow(now, TZ_OFFSET_MIN);
  }

  // Ключ "сегодняшнего слота" (или принудительной даты)
  let slotKey;
  if (forceDay && /^\d{4}-\d{2}-\d{2}$/.test(forceDay)) {
    slotKey = `${forceDay}_${String(slotHour).padStart(2, "0")}`;
  } else {
    slotKey = buildSlotKey(now, slotHour, TZ_OFFSET_MIN);
  }

  const { CLIENT_BOT_TOKEN } = process.env;

  const res = await db.query(`
    SELECT
      s.id,
      s.title,
      s.details,
      s.category,
      s.status,
      p.telegram_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category LIKE 'refused_%'
      AND s.status IN ('approved','published')
      AND p.telegram_chat_id IS NOT NULL
  `);

  for (const row of res.rows) {
    const serviceId = row.id;
    const title = row.title || "Услуга";
    const providerChatId = row.telegram_chat_id;

    const details = safeJsonParseMaybe(row.details);
    const remindersMap = cleanupReminderMap(details.tg_actual_reminders, KEEP_DAYS);

    // 1) если услуга уже не актуальна — ничего не шлём, но подчистим старое
    const isActualNow = isServiceActual(details, row);
    if (!isActualNow) {
      const next = { ...details, tg_actual_reminders: remindersMap };
      // опционально: сброс ignoredDays, если уже не актуально
      const meta = getMeta(next);
      next.tg_actual_reminders_meta = { ...meta, ignoredDays: 0 };
      // сохраняем только если реально меняли
      if (JSON.stringify(next) !== JSON.stringify(details)) {
        await setServiceDetails(serviceId, next);
      }
      continue;
    }

    // 2) антидубль: если в этом слоте уже отправляли — пропускаем
    if (remindersMap && remindersMap[slotKey]) {
      // но всё равно можем обновить очистку
      const next = { ...details, tg_actual_reminders: remindersMap };
      if (JSON.stringify(next) !== JSON.stringify(details)) {
        await setServiceDetails(serviceId, next);
      }
      continue;
    }

    // 3) готовим текст
    const text =
      `⏳ <b>Отказ ещё актуален?</b>\n\n` +
      `🧳 <b>${title}</b>\n\n` +
      `Подтвердите, пожалуйста, чтобы услуга не осталась с устаревшим статусом.`;

    // 4) обновляем details (логирование + отметка слота)
    const meta = getMeta(details);

    const nextDetails = {
      ...details,
      tg_actual_reminders: {
        ...(remindersMap || {}),
        [slotKey]: new Date().toISOString(),
      },
      tg_actual_reminders_meta: {
        ...meta,
        totalSent: meta.totalSent + 1,
        lastSentAt: new Date().toISOString(),
        lastSlotKeySent: slotKey,
        // если нет подтверждения давно — будем считать "игнор"
        // ЛОГИКА: если lastConfirmedAt отсутствует или старее текущего дня — +1 игнор-день только в 18:00
        // но у нас 3 слота/день, поэтому игнор-день считаем один раз в день (в 18:00)
      },
    };

    // 5) считаем ignoredDays только на последнем слоте дня (18)
    // чтобы "3 раза в день" не увеличивало ignoredDays в 3 раза
    if (slotHour === 18) {
      const confirmedAt = nextDetails.tg_actual_reminders_meta.lastConfirmedAt;
      const hasConfirmedRecently = confirmedAt ? true : false;

      // если вообще не было подтверждений — копим ignoredDays
      if (!hasConfirmedRecently) {
        nextDetails.tg_actual_reminders_meta.ignoredDays =
          Number(nextDetails.tg_actual_reminders_meta.ignoredDays || 0) + 1;
      }
    }

    // сохраняем детали до отправки (чтобы не было дубля при нескольких инстансах)
    await setServiceDetails(serviceId, nextDetails);

    try {
      // refused_* -> клиентский бот (если есть), иначе tgSend уйдёт по старому
      await tgSend(providerChatId, text, {
        parse_mode: "HTML",
        reply_markup: buildSvcActualKeyboard(serviceId, { isActual: true }),
      }, CLIENT_BOT_TOKEN || "");

      // 6) авто-деактивация, если игнор N дней подряд
      const ignoredDays = Number(nextDetails.tg_actual_reminders_meta.ignoredDays || 0);
      if (slotHour === 18) {
        await autoDeactivateIfIgnored({
          serviceId,
          providerChatId,
          details: nextDetails,
          ignoredDays,
          thresholdDays: IGNORE_DAYS_THRESHOLD,
          clientBotToken: CLIENT_BOT_TOKEN || "",
        });
      }
    } catch (e) {
      console.error("[askActualReminder] tgSend failed:", {
        serviceId,
        chatId: providerChatId,
        error: e?.response?.data || e?.message || e,
      });

      // если отправка не удалась — откатываем отметку слота,
      // чтобы попытаться в следующий раз
      const rollback = { ...details };
      const rbMap = cleanupReminderMap(rollback.tg_actual_reminders, KEEP_DAYS);
      if (rbMap && rbMap[slotKey]) delete rbMap[slotKey];
      rollback.tg_actual_reminders = rbMap;

      // totalSent не уменьшаем (это метрика), но можно при желании
      await setServiceDetails(serviceId, rollback);
    }
  }
}

module.exports = { askActualReminder };
