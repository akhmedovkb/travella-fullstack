// backend/controllers/adminRefusedController.js
const db = require("../db");

// Telegram send + keyboards/helpers
const { tgSend } = require("../utils/telegram");
const CLIENT_BOT_TOKEN = (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();

// helpers для проверки актуальности услуги
// Важно: serviceActual.js НЕ экспортирует parseDetailsAny/parseDateSafe.
// Поэтому делаем безопасные парсеры локально, а из helper берём только isServiceActual + parseDateFlexible.
const { isServiceActual, parseDateFlexible } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

// безопасный парсинг details (json/json-string/null)
function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// SAFE DATE PARSER (never throws)
// поддерживает "кривые" YYYY-16-01 (swap month/day)
function parseDateSafe(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  const s = String(val).trim();
  if (!s) return null;

  // expected YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    let [, y, a, b] = m;
    let mm = Number(a);
    let dd = Number(b);

    // swap if month > 12 and day <= 12 (e.g. 2026-16-01 -> 2026-01-16)
    if (mm > 12 && dd <= 12) {
      [mm, dd] = [dd, mm];
    }

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // fallback: parseDateFlexible (понимает YYYY.MM.DD и datetime)
  return parseDateFlexible ? parseDateFlexible(s) : null;
}

// взять chatId провайдера
function pickProviderChatId(p) {
  return p.telegram_refused_chat_id || null;
}

// дата для сортировки/отображения
function getStartDateForAdminSort(svc) {
  const d = parseDetailsAny(svc.details);
  const cat = String(svc.category || "").toLowerCase();

  const pick = (...keys) => {
    for (const k of keys) {
      const v = d?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v instanceof Date) return v;
    }
    return null;
  };

  let raw =
    (cat === "refused_hotel" &&
      pick("checkinDate", "checkInDate", "check_in", "check_in_date", "startDate", "start_date")) ||
    (cat === "refused_ticket" &&
      pick("eventDate", "event_date", "date", "startDate", "start_date")) ||
    (cat === "refused_flight" &&
      pick("departureFlightDate", "departureDate", "departure_date", "startFlightDate", "start_flight_date", "startDate", "start_date")) ||
    pick("departureFlightDate", "startDate", "start_date", "dateFrom", "date_from");

  let dt = parseDateSafe(raw);
  if (dt) return dt;

  raw = pick(
    "endDate",
    "end_date",
    "checkoutDate",
    "checkOutDate",
    "checkout_date",
    "returnFlightDate",
    "endFlightDate"
  );
  dt = parseDateSafe(raw);
  return dt || null;
}

function normalizeMeta(detailsObj) {
  const d = detailsObj && typeof detailsObj === "object" ? detailsObj : {};
  if (!d.tg_actual_reminders_meta || typeof d.tg_actual_reminders_meta !== "object") {
    d.tg_actual_reminders_meta = {};
  }
  return d;
}

function nowIso() {
  return new Date().toISOString();
}

exports.listActualRefused = async (req, res) => {
  try {
    const {
      category = "",         // refused_tour / refused_hotel / refused_flight / refused_ticket
      status = "",           // published / approved
      q = "",                // поиск по названию/отелю/направлению/провайдеру
      page = "1",
      limit = "30",
      includeInactive = "0", // 1 = показывать всё, 0 = только актуальные по isServiceActual
      // sorting
      // created_at | provider | sort_date
      sortBy: sortByRaw = "sort_date",
      // asc | desc
      sortOrder: sortOrderRaw = "asc",
    } = req.query;
    const sortBy = String(sortByRaw || "sort_date").toLowerCase();
    const sortOrder = String(sortOrderRaw || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    const dir = sortOrder === "desc" ? -1 : 1;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const where = [];
    const params = [];

    // отказные категории
    where.push(`s.category LIKE 'refused_%'`);
    where.push(`s.deleted_at IS NULL`);

    if (category && String(category).startsWith("refused_")) {
      params.push(category);
      where.push(`s.category = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`LOWER(s.status) = LOWER($${params.length})`);
    } else {
      // по умолчанию берём те, что реально на витрине
      where.push(`LOWER(s.status) IN ('published', 'approved')`);
    }

    // простая текстовая фильтрация
    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      const pIdx = params.length;
      where.push(`
        (
          LOWER(COALESCE(s.title,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.name,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.phone,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.social,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(s.details::text,'')) LIKE $${pIdx}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalSql = `
      SELECT COUNT(*)::int AS total
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      ${whereSql}
    `;
    const totalRes = await db.query(totalSql, params);
    const total = totalRes.rows?.[0]?.total || 0;

    const sql = `
      SELECT
        s.id, s.category, s.status, s.title, s.provider_id, s.created_at, s.updated_at,
        s.expiration_at AS expiration,
        s.details,
        p.id AS p_id,
        p.name AS p_name,
        p.phone AS p_phone,
        p.social AS p_social,
        p.telegram_refused_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      ${whereSql}
      ORDER BY s.id DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    const rowsRes = await db.query(sql, params);
    const rows = Array.isArray(rowsRes.rows) ? rowsRes.rows : [];

    // JS-фильтрация актуальности + сортировка по ближайшей дате
    let items = rows.map((r) => {
      const detailsObj = parseDetailsAny(r.details);

      // isServiceActual умеет брать expiration из svc.expiration — мы его подали как alias expiration
      const actual = isServiceActual(detailsObj, r);

      const dt = getStartDateForAdminSort(r);
      const chatId = pickProviderChatId(r);

      const meta = (detailsObj && detailsObj.tg_actual_reminders_meta) || {};
      return {
        id: r.id,
        category: r.category,
        status: r.status,
        title: r.title,
        providerId: r.provider_id,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        provider: {
          id: r.p_id,
          name: r.p_name,
          phone: r.p_phone,
          telegramUsername: r.p_social,
          chatId,
        },
        details: detailsObj,
        isActual: actual,
        startDateForSort: dt ? dt.toISOString() : null,
        meta: {
          lastSentAt: meta.lastSentAt || null,
          lastAnswer: meta.lastAnswer || null,
          lastConfirmedAt: meta.lastConfirmedAt || null,
          lockUntil: meta.lockUntil || null,
          lastSentBy: meta.lastSentBy || null,
        },
      };
    });

    if (includeInactive !== "1") {
      items = items.filter((x) => x.isActual);
    }

    // сортировка (после фильтра includeInactive — важно)
    items.sort((a, b) => {
      if (sortBy === "created_at") {
        const da = a.createdAt ? new Date(a.createdAt) : null;
        const dbb = b.createdAt ? new Date(b.createdAt) : null;
        if (!da && !dbb) return 0;
        if (!da) return 1;
        if (!dbb) return -1;
        return (da.getTime() - dbb.getTime()) * dir;
      }

      if (sortBy === "provider") {
        const pa = (a.provider?.name || "").toString().toLowerCase();
        const pb = (b.provider?.name || "").toString().toLowerCase();
        // localeCompare даёт стабильную сортировку для кириллицы/латиницы
        return pa.localeCompare(pb, "ru", { sensitivity: "base" }) * dir;
      }

      // default: sort_date (твоя "Дата (сорт)" = startDateForSort)
      const da = a.startDateForSort ? new Date(a.startDateForSort) : null;
      const dbb = b.startDateForSort ? new Date(b.startDateForSort) : null;
      if (!da && !dbb) return 0;
      if (!da) return 1;
      if (!dbb) return -1;
      return (da.getTime() - dbb.getTime()) * dir;
    });

    res.json({
      success: true,
      total,
      page: pageNum,
      sortBy,
      sortOrder,
      limit: limitNum,
      items,
    });
  } catch (e) {
    console.error("[adminRefused] listActualRefused error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getRefusedById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Bad id" });

    const sql = `
      SELECT
        s.*,
        p.id AS p_id,
        p.name AS p_name,
        p.phone AS p_phone,
        p.social AS p_social,
        p.telegram_refused_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
        AND s.deleted_at IS NULL
      LIMIT 1
    `;
    const r = await db.query(sql, [id]);
    const row = r.rows?.[0];
    if (!row) return res.status(404).json({ success: false, message: "Not found" });

    const detailsObj = parseDetailsAny(row.details);
    const chatId = pickProviderChatId(row);

    // isServiceActual понимает svc.expiration (не expiration_at), поэтому подаем алиас
    const svcForActual = { ...row, expiration: row.expiration_at || row.expiration || null };

    res.json({
      success: true,
      item: {
        ...row,
        details: detailsObj,
        provider: {
          id: row.p_id,
          name: row.p_name,
          phone: row.p_phone,
          telegramUsername: row.p_social,
          chatId,
        },
        isActual: isServiceActual(detailsObj, svcForActual),
        startDateForSort: (() => {
          const dt = getStartDateForAdminSort(row);
          return dt ? dt.toISOString() : null;
        })(),
      },
    });
  } catch (e) {
    console.error("[adminRefused] getRefusedById error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.askActualNow = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Bad id" });

    const sql = `
      SELECT
        s.id, s.category, s.status, s.title, s.details, s.provider_id,
        p.telegram_refused_chat_id,
        p.social, p.phone, p.name
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
        AND s.deleted_at IS NULL
      LIMIT 1
    `;
    const r = await db.query(sql, [id]);
    const row = r.rows?.[0];
    if (!row) return res.status(404).json({ success: false, message: "Not found" });

    const chatId = pickProviderChatId(row);
    if (!chatId) {
      return res.json({ success: false, message: "Provider has no telegram chat id" });
    }

    const detailsObj = normalizeMeta(parseDetailsAny(row.details));
    const meta = detailsObj.tg_actual_reminders_meta;

    // Telegram parse_mode safety:
    // Раньше мы отправляли Markdown и подставляли динамические значения (title/category).
    // Из-за символов вроде "*" в названиях (например "5*") Telegram падал с
    // "can't parse entities". Поэтому шлём в HTML (дефолт в tgSend) и экранируем.
    const escapeHtml = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    // антиспам: если lockUntil ещё не прошёл — не шлём (если не force)
    const force = String(req.query.force || "0") === "1";
    if (!force && meta.lockUntil) {
      const lock = new Date(meta.lockUntil);
      if (!isNaN(lock.getTime()) && lock.getTime() > Date.now()) {
        return res.json({
          success: false,
          message: `Locked until ${meta.lockUntil}`,
          meta: { lockUntil: meta.lockUntil, lastSentAt: meta.lastSentAt || null },
        });
      }
    }

    const keyboard = buildSvcActualKeyboard(row.id, { isActual: true });
    const safeTitle = escapeHtml((row.title || "Услуга").toString().slice(0, 80));
    const safeCategory = escapeHtml(row.category);
    const d = parseDetailsAny(row.details);

    // даты (берём самые вероятные поля по категориям)
    const dateInfo =
      (d.startDate && d.endDate && `${d.startDate} → ${d.endDate}`) ||
      (d.checkinDate && d.checkoutDate && `${d.checkinDate} → ${d.checkoutDate}`) ||
      (d.checkInDate && d.checkOutDate && `${d.checkInDate} → ${d.checkOutDate}`) ||
      (d.departureFlightDate &&
        `${d.departureFlightDate}${d.returnFlightDate ? ` → ${d.returnFlightDate}` : ""}`) ||
      (d.eventDate && String(d.eventDate)) ||
      "";
    
    // направление/локация/отель
    const placeInfo =
      [d.directionCountry, d.directionFrom, d.directionTo].filter(Boolean).join(" / ") ||
      [d.country, d.city].filter(Boolean).join(" / ") ||
      (d.hotel && String(d.hotel)) ||
      "";

    const msg =
      `⏰ <b>Проверка актуальности</b>\n\n` +
      `Код: <code>#R${row.id}</code>\n` +
      `Услуга: <b>${safeTitle}</b>\n` +
      (placeInfo ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n` : "") +
      (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
      `Категория: <code>${safeCategory}</code>\n\n` +
      `Актуально ли предложение сейчас?`;

    // tgSend по умолчанию шлёт с parse_mode=HTML, поэтому parse_mode не передаём.
    const sendOk = await tgSend(
      chatId,
      msg,
      {
        reply_markup: keyboard,
        disable_web_page_preview: true,
      },
      CLIENT_BOT_TOKEN || ""
    );

    // обновляем meta
    meta.lastSentAt = nowIso();
    meta.lastSentBy = "admin";
    meta.lockUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6 часов
    meta.lastSendOk = !!sendOk;

    // пишем в details обратно
    await db.query(`UPDATE services SET details = $1 WHERE id = $2`, [
      JSON.stringify(detailsObj),
      row.id,
    ]);

    res.json({
      success: true,
      ok: !!sendOk,
      chatId,
      message: "Sent",
      meta: {
        lastSentAt: meta.lastSentAt,
        lockUntil: meta.lockUntil,
        lastSentBy: meta.lastSentBy,
      },
    });
  } catch (e) {
    console.error("[adminRefused] askActualNow error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
