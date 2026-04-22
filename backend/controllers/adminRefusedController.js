// backend/controllers/adminRefusedController.js
const db = require("../db");

// Telegram send + keyboards/helpers
const { tgSend } = require("../utils/telegram");
const CLIENT_BOT_TOKEN = (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();

// helpers для проверки актуальности услуги
const {
  isServiceActual,
  parseDateFlexible,
} = require("../telegram/helpers/serviceActual");
const {
  buildSvcActualKeyboard,
} = require("../telegram/keyboards/serviceActual");

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

    const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
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

  // 1) Новый единый стандарт для всех refused_* услуг
  let raw = pick("startDate", "start_date");

  // 2) Обратная совместимость со старыми данными
  if (!raw) {
    if (cat === "refused_hotel") {
      raw = pick(
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "dateFrom",
        "date_from",
        "date"
      );
    } else if (cat === "refused_ticket") {
      raw = pick(
        "eventDate",
        "event_date",
        "date",
        "dateFrom",
        "date_from"
      );
    } else if (cat === "refused_flight") {
      raw = pick(
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "startFlightDate",
        "start_flight_date",
        "flightDate",
        "flight_date",
        "dateFrom",
        "date_from",
        "date"
      );
    } else {
      // refused_tour и общий fallback
      raw = pick(
        "dateFrom",
        "date_from",
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "flightDate",
        "flight_date",
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "eventDate",
        "event_date",
        "date"
      );
    }
  }

  let dt = parseDateSafe(raw);
  if (dt) return dt;

  // fallback по конечной дате, если стартовая не найдена/битая
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
  if (
    !d.tg_actual_reminders_meta ||
    typeof d.tg_actual_reminders_meta !== "object"
  ) {
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
      category = "", // refused_tour / refused_hotel / refused_flight / refused_ticket
      status = "", // published / approved / draft / rejected / deleted
      q = "",
      page = "1",
      limit = "30",

      // all | actual | inactive
      actuality: actualityRaw = "",

      // backward compatibility:
      // includeInactive=1 => all, includeInactive=0 => actual
      includeInactive = "",

      // 0 => only non-deleted, 1 => include deleted too
      showDeleted = "0",

      // sorting
      sortBy: sortByRaw = "sort_date", // created_at | provider | sort_date | id
      sortOrder: sortOrderRaw = "asc", // asc | desc
    } = req.query;

    const sortBy = String(sortByRaw || "sort_date").toLowerCase();
    const sortOrder =
      String(sortOrderRaw || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    const dir = sortOrder === "desc" ? -1 : 1;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

    let actuality = String(actualityRaw || "").trim().toLowerCase();
    if (!["all", "actual", "inactive"].includes(actuality)) {
      if (String(includeInactive) === "1") actuality = "all";
      else actuality = "actual";
    }

    const where = [];
    const params = [];

    where.push(`s.category LIKE 'refused_%'`);

    if (String(showDeleted) !== "1") {
      where.push(`s.deleted_at IS NULL`);
    }

    if (category && String(category).startsWith("refused_")) {
      params.push(category);
      where.push(`s.category = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`LOWER(s.status) = LOWER($${params.length})`);
    } else if (String(showDeleted) === "1") {
      // без фильтра по status, чтобы видеть и deleted
    } else {
      where.push(`LOWER(s.status) IN ('published', 'approved')`);
    }

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

    const sql = `
      SELECT
        s.id,
        s.category,
        s.status,
        s.title,
        s.provider_id,
        s.created_at,
        s.updated_at,
        s.deleted_at,
        s.deleted_by,
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
    `;

    const rowsRes = await db.query(sql, params);
    const rows = Array.isArray(rowsRes.rows) ? rowsRes.rows : [];

    let items = rows.map((r) => {
      const detailsObj = parseDetailsAny(r.details);
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
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
        deletedBy: r.deleted_by || null,
        expiration: r.expiration ? new Date(r.expiration).toISOString() : null,
        provider: {
          id: r.p_id,
          name: r.p_name,
          phone: r.p_phone,
          telegramUsername: r.p_social,
          chatId,
        },
        details: detailsObj,
        isActual: !!actual,
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

    if (actuality === "actual") {
      items = items.filter((x) => x.isActual);
    } else if (actuality === "inactive") {
      items = items.filter((x) => !x.isActual);
    }

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
        return pa.localeCompare(pb, "ru", { sensitivity: "base" }) * dir;
      }
      if (sortBy === "id") {
        return (Number(a.id || 0) - Number(b.id || 0)) * dir;
      }

      const da = a.startDateForSort ? new Date(a.startDateForSort) : null;
      const dbb = b.startDateForSort ? new Date(b.startDateForSort) : null;
      if (!da && !dbb) return 0;
      if (!da) return 1;
      if (!dbb) return -1;
      return (da.getTime() - dbb.getTime()) * dir;
    });

    const total = items.length;
    const offset = (pageNum - 1) * limitNum;
    const paged = items.slice(offset, offset + limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      sortBy,
      sortOrder,
      actuality,
      showDeleted: String(showDeleted) === "1" ? "1" : "0",
      items: paged,
    });
  } catch (e) {
    console.error("[adminRefused] listActualRefused error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getRefusedById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

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
      LIMIT 1
    `;
    const r = await db.query(sql, [id]);
    const row = r.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const detailsObj = parseDetailsAny(row.details);
    const chatId = pickProviderChatId(row);

    const svcForActual = {
      ...row,
      expiration: row.expiration_at || row.expiration || null,
    };

    res.json({
      success: true,
      item: {
        id: row.id,
        category: row.category,
        status: row.status,
        title: row.title,
        providerId: row.provider_id,
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : null,
        updatedAt: row.updated_at
          ? new Date(row.updated_at).toISOString()
          : null,
        deletedAt: row.deleted_at
          ? new Date(row.deleted_at).toISOString()
          : null,
        deletedBy: row.deleted_by || null,
        expiration: row.expiration_at
          ? new Date(row.expiration_at).toISOString()
          : null,
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
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

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
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const chatId = pickProviderChatId(row);
    if (!chatId) {
      return res.json({
        success: false,
        message: "Provider has no telegram chat id",
      });
    }

    const detailsObj = normalizeMeta(parseDetailsAny(row.details));
    const meta = detailsObj.tg_actual_reminders_meta;

    const escapeHtml = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const force = String(req.query.force || "0") === "1";
    if (!force && meta.lockUntil) {
      const lock = new Date(meta.lockUntil);
      if (!isNaN(lock.getTime()) && lock.getTime() > Date.now()) {
        return res.json({
          success: false,
          message: `Locked until ${meta.lockUntil}`,
          locked: true,
          meta: {
            lockUntil: meta.lockUntil,
            lastSentAt: meta.lastSentAt || null,
          },
        });
      }
    }

    const keyboard = buildSvcActualKeyboard(row.id, { isActual: true });
    const safeTitle = escapeHtml((row.title || "Услуга").toString().slice(0, 80));
    const safeCategory = escapeHtml(row.category);
    const d = parseDetailsAny(row.details);

    const dateInfo =
      (d.startDate && d.endDate && `${d.startDate} → ${d.endDate}`) ||
      (d.checkinDate &&
        d.checkoutDate &&
        `${d.checkinDate} → ${d.checkoutDate}`) ||
      (d.checkInDate &&
        d.checkOutDate &&
        `${d.checkInDate} → ${d.checkOutDate}`) ||
      (d.departureFlightDate &&
        `${d.departureFlightDate}${
          d.returnFlightDate ? ` → ${d.returnFlightDate}` : ""
        }`) ||
      (d.eventDate && String(d.eventDate)) ||
      "";

    const placeInfo =
      [d.directionCountry, d.directionFrom, d.directionTo]
        .filter(Boolean)
        .join(" / ") ||
      [d.country, d.city].filter(Boolean).join(" / ") ||
      (d.hotel && String(d.hotel)) ||
      "";

    const msg =
      `⏰ <b>Проверка актуальности</b>\n\n` +
      `Код: <code>#R${row.id}</code>\n` +
      `Услуга: <b>${safeTitle}</b>\n` +
      (placeInfo
        ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n`
        : "") +
      (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
      `Категория: <code>${safeCategory}</code>\n\n` +
      `Актуально ли предложение сейчас?`;

    const sendOk = await tgSend(
      chatId,
      msg,
      {
        reply_markup: keyboard,
        disable_web_page_preview: true,
      },
      CLIENT_BOT_TOKEN || ""
    );

    meta.lastSentAt = nowIso();
    meta.lastSentBy = "admin";
    meta.lockUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    meta.lastSendOk = !!sendOk;

    await db.query(`UPDATE services SET details = $1 WHERE id = $2`, [
      JSON.stringify(detailsObj),
      row.id,
    ]);

    res.json({
      success: true,
      ok: !!sendOk,
      sent: !!sendOk,
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

exports.extendRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

    const checkRes = await db.query(
      `
      SELECT id, category, status, details, expiration_at
      FROM services
      WHERE id = $1
        AND deleted_at IS NULL
        AND category LIKE 'refused_%'
      LIMIT 1
      `,
      [id]
    );

    const row = checkRes.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const updRes = await db.query(
      `
      UPDATE services
         SET
           expiration_at = COALESCE(expiration_at, NOW()) + interval '7 days',
           details = jsonb_set(
             jsonb_set(
               COALESCE(details::jsonb, '{}'::jsonb),
               '{isActive}',
               'true'::jsonb,
               true
             ),
             '{expiration}',
             to_jsonb(
               (COALESCE(expiration_at, NOW()) + interval '7 days')::timestamp
             )::jsonb,
             true
           ),
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
         AND category LIKE 'refused_%'
       RETURNING id, category, status, details, expiration_at, updated_at
      `,
      [id]
    );

    const updated = updRes.rows?.[0];
    return res.json({
      success: true,
      message: "Extended",
      item: {
        ...updated,
        details: parseDetailsAny(updated?.details),
      },
    });
  } catch (e) {
    console.error("[adminRefused] extendRefusedService error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

    const actorId = Number(req.user?.id) || null;

    const delRes = await db.query(
      `
      UPDATE services
         SET
           status = 'deleted',
           deleted_at = NOW(),
           deleted_by = $2,
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
         AND category LIKE 'refused_%'
       RETURNING id
      `,
      [id, actorId]
    );

    if (!delRes.rowCount) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({
      success: true,
      message: "Deleted",
      id,
    });
  } catch (e) {
    console.error("[adminRefused] deleteRefusedService error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.restoreRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Bad id",
      });
    }

    const upd = await db.query(
      `
      UPDATE services
      SET
        deleted_at = NULL,
        deleted_by = NULL,
        status = 'published',
        updated_at = NOW()
      WHERE id = $1
        AND category LIKE 'refused_%'
      RETURNING id
      `,
      [id]
    );

    if (!upd.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    return res.json({
      success: true,
      message: "Service restored",
      id,
    });
  } catch (e) {
    console.error("[adminRefused] restoreRefusedService error:", e);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
