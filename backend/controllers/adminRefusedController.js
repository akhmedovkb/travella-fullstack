// backend/controllers/adminRefusedController.js
const db = require("../db");
const { tgSend } = require("../utils/telegram");

// keyboard builder (у тебя уже есть)
let buildSvcActualKeyboard = null;
try {
  ({ buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual"));
} catch (e) {
  // если вдруг файл отсутствует — не валим сервер, просто шлём без клавиатуры
  buildSvcActualKeyboard = null;
}

// -------------------------
// helpers (SELF-SUFFICIENT)
// -------------------------

function safeJsonParseMaybe(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const obj = JSON.parse(v);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toBoolLoose(v) {
  if (v === true || v === false) return v;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "да"].includes(s)) return true;
  if (["0", "false", "no", "n", "нет"].includes(s)) return false;
  return null;
}

// SAFE DATE PARSER (never throws)
// accepts:
// - YYYY-MM-DD
// - ISO string
// - Date
// and fixes "YYYY-16-01" by swapping (mm>12 and dd<=12)
function safeParseDate(val) {
  try {
    if (!val) return null;
    if (val instanceof Date && !Number.isNaN(val.getTime())) return val;

    const s = String(val).trim();
    if (!s) return null;

    // strict YYYY-MM-DD
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      let [, y, a, b] = m;
      let mm = Number(a);
      let dd = Number(b);

      if (mm > 12 && dd <= 12) {
        [mm, dd] = [dd, mm];
      }
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

      const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    }

    // ISO datetime / timestamp
    const d2 = new Date(s);
    if (Number.isNaN(d2.getTime())) return null;
    return d2;
  } catch {
    return null;
  }
}

function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function pickProviderChatId(p) {
  return p.telegram_refused_chat_id || p.telegram_web_chat_id || p.telegram_chat_id || null;
}

function ensureMeta(detailsObj) {
  const d = detailsObj && typeof detailsObj === "object" ? detailsObj : {};
  if (!d.tg_actual_reminders_meta || typeof d.tg_actual_reminders_meta !== "object") {
    d.tg_actual_reminders_meta = {};
  }
  return d;
}

/**
 * Определяем "дату для сортировки" по категории:
 * - refused_hotel: checkinDate/ checkInDate / startDate
 * - refused_flight: departureFlightDate / startDate
 * - refused_ticket: eventDate / date / startDate
 * - refused_tour: startDate / departureFlightDate
 *
 * Возвращаем Date|null
 */
function getStartDateForSort(category, details) {
  const d = details || {};
  const cat = String(category || "").toLowerCase();

  const pick = (...keys) => {
    for (const k of keys) {
      const v = d?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v instanceof Date) return v;
    }
    return null;
  };

  let raw = null;

  if (cat === "refused_hotel") {
    raw = pick("checkinDate", "checkInDate", "check_in", "check_in_date", "startDate", "start_date");
  } else if (cat === "refused_flight") {
    raw = pick(
      "departureFlightDate",
      "departureDate",
      "departure_date",
      "startFlightDate",
      "start_flight_date",
      "startDate",
      "start_date"
    );
  } else if (cat === "refused_ticket") {
    raw = pick("eventDate", "event_date", "date", "startDate", "start_date");
  } else {
    // refused_tour и прочее refused_*
    raw = pick("startDate", "start_date", "departureFlightDate", "dateFrom", "date_from");
  }

  let dt = safeParseDate(raw);
  if (dt) return dt;

  // fallback: end date
  raw = pick("endDate", "end_date", "checkoutDate", "checkOutDate", "returnFlightDate", "endFlightDate");
  dt = safeParseDate(raw);
  return dt || null;
}

/**
 * Самодостаточная проверка актуальности:
 * - status must be published/approved unless includeInactive=1
 * - details.isActive если явно false -> неактуально
 * - services.expiration_at если <= now -> неактуально
 * - details.expiration (timestamp) если <= now -> неактуально
 * - если есть endDate/endFlightDate/checkoutDate и оно < today -> неактуально
 */
function computeIsActual({ details, svcRow }) {
  try {
    const d = details || {};
    const now = new Date();
    const today = startOfToday();

    // details.isActive (может быть true/false/строкой)
    const isActive = toBoolLoose(d.isActive);
    if (isActive === false) return false;

    // services.expiration_at
    if (svcRow && svcRow.expiration_at) {
      const exp = safeParseDate(svcRow.expiration_at);
      if (exp && exp.getTime() <= now.getTime()) return false;
    }

    // details.expiration (обычно ISO или "YYYY-MM-DD ...")
    if (d.expiration) {
      const exp2 = safeParseDate(d.expiration);
      if (exp2 && exp2.getTime() <= now.getTime()) return false;
    }

    // end date check (не показываем явно прошедшие)
    const endRaw =
      d.endFlightDate ||
      d.endDate ||
      d.checkoutDate ||
      d.checkOutDate ||
      d.check_out_date ||
      d.returnFlightDate ||
      null;

    const end = safeParseDate(endRaw);
    if (end) {
      // сравниваем с началом сегодняшнего дня
      if (end.getTime() < today.getTime()) return false;
    }

    return true;
  } catch {
    // guard: если что-то странное — не валим сервер
    return true;
  }
}

function formatMeta(detailsObj) {
  const meta = detailsObj?.tg_actual_reminders_meta || {};
  return {
    lastSentAt: meta.lastSentAt || null,
    lastAnswer: meta.lastAnswer || null,
    lastConfirmedAt: meta.lastConfirmedAt || null,
    lockUntil: meta.lockUntil || null,
    lastSentBy: meta.lastSentBy || null,
  };
}

// -------------------------
// controllers
// -------------------------

/**
 * GET /api/admin/refused/actual
 * query:
 *  - category: refused_tour/refused_hotel/refused_flight/refused_ticket or ""(all refused_%)
 *  - status: "" -> default published/approved
 *  - q: search
 *  - page, limit
 *  - includeInactive: "1" to show inactive too
 */
exports.listActualRefused = async (req, res) => {
  try {
    const {
      category = "",
      status = "",
      q = "",
      page = "1",
      limit = "30",
      includeInactive = "0",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const where = [];
    const params = [];

    // refused_*
    where.push(`s.category LIKE 'refused_%'`);

    if (category && String(category).startsWith("refused_")) {
      params.push(category);
      where.push(`s.category = $${params.length}`);
    }

    if (status && String(status).trim()) {
      params.push(String(status).trim());
      where.push(`LOWER(s.status) = LOWER($${params.length})`);
    } else {
      where.push(`LOWER(s.status) IN ('published','approved')`);
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const i = params.length;
      where.push(`
        (
          LOWER(COALESCE(s.title,'')) LIKE $${i}
          OR LOWER(COALESCE(s.details::text,'')) LIKE $${i}
          OR LOWER(COALESCE(p.name,'')) LIKE $${i}
          OR LOWER(COALESCE(p.company_name,'')) LIKE $${i}
          OR LOWER(COALESCE(p.phone,'')) LIKE $${i}
          OR LOWER(COALESCE(p.telegram_username,'')) LIKE $${i}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRes = await db.query(
      `
      SELECT COUNT(*)::int AS total
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      ${whereSql}
      `,
      params
    );
    const total = totalRes.rows?.[0]?.total || 0;

    const rowsRes = await db.query(
      `
      SELECT
        s.id, s.category, s.status, s.title, s.provider_id,
        s.created_at, s.updated_at,
        s.expiration_at,
        s.details,
        p.id AS p_id,
        p.name AS p_name,
        p.company_name AS p_company_name,
        p.phone AS p_phone,
        p.telegram_username AS p_telegram_username,
        p.telegram_refused_chat_id, p.telegram_chat_id, p.telegram_web_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      ${whereSql}
      ORDER BY s.id DESC
      LIMIT ${limitNum} OFFSET ${offset}
      `,
      params
    );

    const rows = Array.isArray(rowsRes.rows) ? rowsRes.rows : [];

    // row-level guard: никакой ряд не должен уронить весь ответ
    const mapped = rows.map((r) => {
      try {
        const detailsObj = ensureMeta(safeJsonParseMaybe(r.details));
        const startDt = getStartDateForSort(r.category, detailsObj);
        const chatId = pickProviderChatId(r);

        const isActual = computeIsActual({ details: detailsObj, svcRow: r });

        return {
          id: r.id,
          category: r.category,
          status: r.status,
          title: r.title,
          providerId: r.provider_id,
          provider: {
            id: r.p_id,
            name: r.p_name,
            companyName: r.p_company_name,
            phone: r.p_phone,
            telegramUsername: r.p_telegram_username,
            chatId,
          },
          details: detailsObj,
          isActual,
          startDateForSort: startDt ? startDt.toISOString() : null,
          meta: formatMeta(detailsObj),
        };
      } catch (e) {
        return {
          id: r.id,
          category: r.category,
          status: r.status,
          title: r.title,
          providerId: r.provider_id,
          provider: {
            id: r.p_id,
            name: r.p_name,
            companyName: r.p_company_name,
            phone: r.p_phone,
            telegramUsername: r.p_telegram_username,
            chatId: pickProviderChatId(r),
          },
          details: safeJsonParseMaybe(r.details),
          isActual: true,
          startDateForSort: null,
          meta: {},
          __rowError: true,
        };
      }
    });

    let items = mapped;
    if (String(includeInactive) !== "1") {
      items = items.filter((x) => x.isActual);
    }

    // sort by nearest date, nulls go to bottom
    items.sort((a, b) => {
      const da = a.startDateForSort ? new Date(a.startDateForSort) : null;
      const dbb = b.startDateForSort ? new Date(b.startDateForSort) : null;
      if (!da && !dbb) return 0;
      if (!da) return 1;
      if (!dbb) return -1;
      return da.getTime() - dbb.getTime();
    });

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      items,
    });
  } catch (e) {
    console.error("[adminRefused] listActualRefused error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/admin/refused/:id
 */
exports.getRefusedById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Bad id" });

    const r = await db.query(
      `
      SELECT
        s.*,
        p.id AS p_id,
        p.name AS p_name,
        p.company_name AS p_company_name,
        p.phone AS p_phone,
        p.telegram_username AS p_telegram_username,
        p.telegram_refused_chat_id, p.telegram_chat_id, p.telegram_web_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    const row = r.rows?.[0];
    if (!row) return res.status(404).json({ success: false, message: "Not found" });

    const detailsObj = ensureMeta(safeJsonParseMaybe(row.details));
    const startDt = getStartDateForSort(row.category, detailsObj);

    return res.json({
      success: true,
      item: {
        ...row,
        details: detailsObj,
        provider: {
          id: row.p_id,
          name: row.p_name,
          companyName: row.p_company_name,
          phone: row.p_phone,
          telegramUsername: row.p_telegram_username,
          chatId: pickProviderChatId(row),
        },
        isActual: computeIsActual({ details: detailsObj, svcRow: row }),
        startDateForSort: startDt ? startDt.toISOString() : null,
      },
    });
  } catch (e) {
    console.error("[adminRefused] getRefusedById error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/admin/refused/:id/ask-actual?force=1
 */
exports.askActualNow = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Bad id" });

    const force = String(req.query.force || "0") === "1";

    const r = await db.query(
      `
      SELECT
        s.id, s.category, s.status, s.title, s.details, s.provider_id, s.expiration_at,
        p.telegram_refused_chat_id, p.telegram_chat_id, p.telegram_web_chat_id,
        p.telegram_username, p.phone, p.name, p.company_name
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    const row = r.rows?.[0];
    if (!row) return res.status(404).json({ success: false, message: "Not found" });

    const chatId = pickProviderChatId(row);
    if (!chatId) {
      return res.json({ success: false, message: "Provider has no telegram chat id" });
    }

    const detailsObj = ensureMeta(safeJsonParseMaybe(row.details));
    const meta = detailsObj.tg_actual_reminders_meta || {};

    // lockUntil anti-spam (если не force)
    if (!force && meta.lockUntil) {
      const lock = safeParseDate(meta.lockUntil);
      if (lock && lock.getTime() > Date.now()) {
        return res.json({
          success: false,
          locked: true,
          message: "Locked",
          meta: { lockUntil: meta.lockUntil, lastSentAt: meta.lastSentAt || null },
        });
      }
    }

    const title = (row.title || "Услуга").toString().slice(0, 80);
    const msg =
      `⏰ *Проверка актуальности*\n\n` +
      `Услуга: *${title}*\n` +
      `Категория: \`${row.category}\`\n\n` +
      `Актуально ли предложение сейчас?`;

    const replyMarkup = buildSvcActualKeyboard
      ? buildSvcActualKeyboard(row.id, { isActual: true })
      : undefined;

    const sendRes = await tgSend(chatId, msg, {
      parse_mode: "Markdown",
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    });

    // update meta in details
    detailsObj.tg_actual_reminders_meta = detailsObj.tg_actual_reminders_meta || {};
    detailsObj.tg_actual_reminders_meta.lastSentAt = new Date().toISOString();
    detailsObj.tg_actual_reminders_meta.lastSentBy = "admin";
    detailsObj.tg_actual_reminders_meta.lastSendOk = !!sendRes?.ok;

    // lock 6h
    detailsObj.tg_actual_reminders_meta.lockUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    await db.query(`UPDATE services SET details = $1 WHERE id = $2`, [
      JSON.stringify(detailsObj),
      row.id,
    ]);

    return res.json({
      success: true,
      ok: !!sendRes?.ok,
      chatId,
      message: sendRes?.ok ? "Sent" : "Not sent",
      meta: {
        lastSentAt: detailsObj.tg_actual_reminders_meta.lastSentAt,
        lockUntil: detailsObj.tg_actual_reminders_meta.lockUntil,
        lastSentBy: detailsObj.tg_actual_reminders_meta.lastSentBy,
      },
      tg: sendRes || null,
    });
  } catch (e) {
    console.error("[adminRefused] askActualNow error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
