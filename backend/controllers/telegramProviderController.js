// backend/controllers/telegramProviderController.js
const pool = require("../db");
const axiosBase = require("axios");
const { tgSend, notifyModerationNew } = require("../utils/telegram");
const { logProviderServiceAction } = require("../utils/serviceAuditLog");
const { applyServiceLifecycleAction } = require("../utils/serviceLifecycle");
const { logProviderFunnelEvent } = require("../utils/providerFunnel");
const { REFUSED_CATEGORIES } = require("../utils/serviceCategories");
const MAX_TITLE_LEN = 100;
const {
  extractPrices,
  isPriceDrop,
  broadcastPriceDropCard,
} = require("../utils/refusedPriceDropBroadcast");

const TG_TOKEN =
  process.env.TELEGRAM_CLIENT_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN ||
  "";

const tgAxios = axiosBase.create({
  timeout: 15000,
});

// ---------- public base helpers (для imageUrl) ----------
const SITE_PUBLIC_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ||
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  ""
).replace(/\/+$/, "");

function publicBase() {
  return SITE_PUBLIC_URL || API_PUBLIC_URL || "https://travella.uz";
}

function safeParseDate(val, endOfDay = false) {
  if (val === undefined || val === null || val === "") return null;

  if (val instanceof Date) {
    const d = new Date(val.getTime());
    if (!Number.isFinite(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
  }

  if (typeof val === "number") {
    const ms = val > 9999999999 ? val : val * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const raw = String(val || "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const ms = n > 9999999999 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    let [, y, a, b] = m;
    let mm = Number(a);
    let dd = Number(b);
    if (mm > 12 && dd <= 12) [mm, dd] = [dd, mm];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const d = new Date(Number(y), mm - 1, dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function firstDate(...values) {
  for (const value of values) {
    const parsed = safeParseDate(value, false);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof details === "object" ? details : {};
}

function normalizeServiceSnapshot(row) {
  if (!row || typeof row !== "object") return row || null;
  return {
    ...row,
    details: normalizeDetails(row.details),
    images: Array.isArray(row.images)
      ? row.images
      : (() => {
          try {
            return typeof row.images === "string" ? JSON.parse(row.images) : row.images || [];
          } catch {
            return [];
          }
        })(),
  };
}

async function fetchProviderServiceSnapshot(serviceId, providerId) {
  const r = await pool.query(
    `
    SELECT
      id,
      provider_id,
      category,
      title,
      price,
      status,
      moderation_status,
      details,
      images,
      expiration_at,
      deleted_at,
      created_at,
      updated_at
    FROM services
    WHERE id = $1 AND provider_id = $2
    LIMIT 1
    `,
    [serviceId, providerId]
  );
  return normalizeServiceSnapshot(r.rows[0] || null);
}

async function logBotServiceAudit({ req, action, providerId, serviceId, oldService, newService, meta = {} }) {
  await logProviderServiceAction({
    req,
    action,
    source: "telegram_bot",
    actorRole: "provider",
    providerId,
    serviceId,
    oldService: normalizeServiceSnapshot(oldService),
    newService: normalizeServiceSnapshot(newService),
    meta,
  });
}

function isTruthyActive(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  return !(s === "false" || s === "0" || s === "no" || s === "inactive" || s === "неактуально");
}

function getRefusedActualityDate(details = {}, service = {}) {
  const category = String(service.category || details.category || "").toLowerCase();

  if (category === "refused_hotel") {
    return firstDate(
      details.checkIn,
      details.check_in,
      details.checkInDate,
      details.check_in_date,
      details.startDate,
      details.start_date,
      service.start_date
    );
  }

  if (category === "refused_event_ticket" || category === "refused_ticket") {
    return firstDate(
      details.eventDate,
      details.event_date,
      details.startDate,
      details.start_date,
      service.start_date
    );
  }

  return firstDate(
    details.startFlightDate,
    details.departureFlightDate,
    details.departureDate,
    details.departure_date,
    details.startDate,
    details.start_date,
    service.start_date
  );
}

function isRefusedServiceActual(service, today = new Date()) {
  const details = normalizeDetails(service?.details);
  const category = String(service?.category || details.category || "").toLowerCase();
  const isRefused = category.startsWith("refused_") || category === "author_tour";

  if (!isRefused) return true;
  if (!isTruthyActive(details.isActive ?? details.is_active)) return false;

  const expiration = firstDate(
    service?.expiration_at,
    service?.expiration,
    service?.expires_at,
    details.expiration_at,
    details.expiration,
    details.expiration_ts
  );
  if (expiration && expiration < new Date()) return false;

  const actualDate = getRefusedActualityDate(details, service);
  if (!actualDate) return true;

  const floor = new Date(today);
  floor.setHours(0, 0, 0, 0);
  return actualDate >= floor;
}

// ---------- helpers ----------
function guessMimeByPath(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function tgFileIdToDataUrl(fileId) {
  if (!TG_TOKEN) return null;
  if (!fileId) return null;

  // 1) getFile
  const getFileUrl = `https://api.telegram.org/bot${TG_TOKEN}/getFile`;
  const r1 = await tgAxios.get(getFileUrl, { params: { file_id: fileId } });

  const filePath = r1?.data?.result?.file_path;
  if (!filePath) return null;

  // 2) download
  const dlUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`;
  const r2 = await tgAxios.get(dlUrl, { responseType: "arraybuffer" });

  const buf = Buffer.from(r2.data);

  // safety: не тащим гигантские файлы в base64
  const MAX = 6 * 1024 * 1024; // 6MB
  if (buf.length > MAX) return null;

  const mime = guessMimeByPath(filePath);
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function normalizeImagesForDb(images) {
  if (!Array.isArray(images)) return [];

  const out = [];
  for (const it of images) {
    if (typeof it === "string") {
      const s = it.trim();
      if (!s) continue;

      // tg:fileId -> dataURL
      if (s.startsWith("tg:")) {
        const fileId = s.slice(3).trim();
        try {
          const dataUrl = await tgFileIdToDataUrl(fileId);
          if (dataUrl) {
            out.push(dataUrl);
            continue;
          }
        } catch (e) {
          console.log("[telegram] tgFileIdToDataUrl failed:", e?.message || e);
        }
        continue;
      }

      out.push(s);
      continue;
    }

    if (it && typeof it === "object") {
      const v = it.url || it.src || it.path || it.location || it.href || null;
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
  }

  return out;
}

// ---------- helpers: safe string limits ----------
function clampString(s, maxLen) {
  if (s === null || s === undefined) return "";
  const str = String(s).trim();
  if (!maxLen || maxLen <= 0) return str;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function normalizeDateTimeInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T23:59:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(raw)) {
    return raw.replace(/\s+/, "T") + ":00";
  }

  if (/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}$/.test(raw)) {
    const [datePart, timePart] = raw.split(/\s+/);
    const normalizedDate = datePart.replace(/\./g, "-");
    return `${normalizedDate}T${timePart}:00`;
  }

  return raw;
}


function ymdToUtcEndOfDay(value) {
  const m = String(value || "").trim().match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function getDetailsTripStartForExpiration(category, details) {
  const cat = String(category || "").toLowerCase();
  if (cat === "refused_flight") {
    return details?.departureFlightDate || details?.startFlightDate || details?.startDate || null;
  }
  return details?.startDate || details?.departureFlightDate || details?.startFlightDate || null;
}

function isExpirationAfterTripStartForStorage(category, details, expirationIso) {
  if (!expirationIso) return false;
  const exp = new Date(expirationIso);
  const tripStartEnd = ymdToUtcEndOfDay(getDetailsTripStartForExpiration(category, details));
  if (Number.isNaN(exp.getTime()) || !tripStartEnd) return false;
  return exp.getTime() > tripStartEnd.getTime();
}

function parseExpirationForStorage(value) {
  if (value === undefined) {
    return { provided: false, valid: true, value: undefined };
  }

  if (value === null) {
    return { provided: true, valid: true, value: null };
  }

  const raw = String(value).trim();
  if (!raw) {
    return { provided: true, valid: true, value: null };
  }

  const normalized = normalizeDateTimeInput(raw);
  const d = new Date(normalized);

  if (Number.isNaN(d.getTime())) {
    return { provided: true, valid: false, value: null };
  }

  return { provided: true, valid: true, value: d.toISOString() };
}

/**
 * Получить заявки поставщика по его Telegram chatId
 * GET /api/telegram/provider/:chatId/bookings?status=pending
 */
async function getProviderBookings(req, res) {
  try {
    const { chatId } = req.params;
    const status = req.query.status || "pending";

    const providerRes = await pool.query(
      `SELECT id, name
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (providerRes.rowCount === 0) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const providerId = providerRes.rows[0].id;

    const bookingsRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         b.date,
         b.client_message,
         b.created_at,
         b.currency,
         b.tb_meta,
         s.title        AS service_title,
         c.name         AS client_name,
         c.telegram_chat_id AS client_chat_id,
         COALESCE(b.tb_meta->>'startDate', b.date::text) AS start_date,
         (b.tb_meta->>'endDate') AS end_date,
         (b.tb_meta->>'adults')::int    AS persons_adults,
         (b.tb_meta->>'children')::int  AS persons_children,
         (b.tb_meta->>'infants')::int   AS persons_infants
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.provider_id = $1
        AND b.status = $2
      ORDER BY b.created_at DESC
      LIMIT 20`,
      [providerId, status]
    );

    return res.json({
      success: true,
      bookings: bookingsRes.rows,
    });
  } catch (err) {
    console.error("getProviderBookings error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

async function confirmBooking(req, res) {
  try {
    const { chatId, bookingId } = req.params;

    const bookingRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         b.date,
         b.tb_meta,
         s.title AS service_title,
         c.telegram_chat_id AS client_chat_id
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN providers p ON p.id = b.provider_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.id = $1
        AND (
          p.telegram_chat_id::text = $2
          OR p.tg_chat_id::text = $2
          OR p.telegram_web_chat_id::text = $2
          OR p.telegram_refused_chat_id::text = $2
        )
      LIMIT 1`,
      [bookingId, chatId]
    );

    if (bookingRes.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Booking not found for this provider" });
    }

    const row = bookingRes.rows[0];

    if (row.status !== "pending") {
      return res.status(400).json({ error: "Booking is not pending" });
    }

    await pool.query(
      `UPDATE bookings
          SET status = 'confirmed', updated_at = NOW()
        WHERE id = $1`,
      [bookingId]
    );

    if (row.client_chat_id) {
      const text =
        `✅ <b>Ваша бронь подтверждена!</b>\n\n` +
        `Тур: <b>${row.service_title}</b>\n` +
        `Дата: ${row.date}\n`;

      tgSend(row.client_chat_id, text);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("confirmBooking error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

async function rejectBooking(req, res) {
  try {
    const { chatId, bookingId } = req.params;

    const bookingRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         s.title AS service_title,
         c.telegram_chat_id AS client_chat_id
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN providers p ON p.id = b.provider_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.id = $1
        AND (
          p.telegram_chat_id::text = $2
          OR p.tg_chat_id::text = $2
          OR p.telegram_web_chat_id::text = $2
          OR p.telegram_refused_chat_id::text = $2
        )
      LIMIT 1`,
      [bookingId, chatId]
    );

    if (bookingRes.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Booking not found for this provider" });
    }

    const row = bookingRes.rows[0];

    if (row.status !== "pending") {
      return res.status(400).json({ error: "Booking is not pending" });
    }

    await pool.query(
      `UPDATE bookings
          SET status = 'rejected', updated_at = NOW()
        WHERE id = $1`,
      [bookingId]
    );

    if (row.client_chat_id) {
      const text =
        `❌ <b>Ваша бронь отклонена.</b>\n\n` +
        `Тур: <b>${row.service_title}</b>\n`;

      tgSend(row.client_chat_id, text);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("rejectBooking error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

async function getProviderServices(req, res) {
  try {
    const { chatId } = req.params;

    const providerRes = await pool.query(
      `SELECT id, name
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = providerRes.rows[0].id;

    const categories = REFUSED_CATEGORIES;

    const servicesRes = await pool.query(
      `
      SELECT
        s.id,
        s.category,
        s.status,
        s.title,
        s.price,
        s.details,
        s.images,
        s.expiration_at,
        COALESCE(
          s.details::jsonb ->> 'startDate',
          s.details::jsonb ->> 'start_date',
          s.details::jsonb ->> 'departureFlightDate',
          s.details::jsonb ->> 'departureDate',
          s.details::jsonb ->> 'checkIn',
          s.details::jsonb ->> 'eventDate'
        ) AS start_date,
        COALESCE(
          s.details::jsonb ->> 'endDate',
          s.details::jsonb ->> 'end_date',
          s.details::jsonb ->> 'returnFlightDate',
          s.details::jsonb ->> 'returnDate',
          s.details::jsonb ->> 'checkOut'
        ) AS end_date,
        s.created_at,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
        WHERE s.provider_id = $1
          AND s.category = ANY($2::text[])
          AND s.deleted_at IS NULL
          AND s.status IN ('published', 'approved', 'active')
          AND (
            s.expiration_at IS NULL
            OR s.expiration_at > NOW()
          )
      ORDER BY s.created_at DESC
      LIMIT 100
      `,
      [providerId, categories]
    );

    return res.json({
      success: true,
      items: servicesRes.rows,
    });
  } catch (err) {
    console.error("[telegram] getProviderServices error:", err);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

// 🟢 ВСЕ услуги провайдера (для кнопки "Карточками")
async function getProviderServicesAll(req, res) {
  try {
    const { chatId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,

      [chatId]
    );

    if (!provRes.rowCount) {
      return res.json({ success: true, items: [] });
    }

    const providerId = provRes.rows[0].id;

    const servicesRes = await pool.query(
      `
      SELECT
        s.*,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
        AND s.status IN ('published', 'approved', 'active')
        AND (
          s.expiration_at IS NULL
          OR s.expiration_at > NOW()
        )
        AND COALESCE((s.details::jsonb ->> 'isActive')::boolean, true) = true
      ORDER BY s.created_at DESC
      `,
      [providerId]
    );

    return res.json({
      success: true,
      items: servicesRes.rows,
    });
  } catch (e) {
    console.error("[tg] getProviderServicesAll error:", e);
    return res.status(500).json({ success: false });
  }
}


async function getProviderDraftServices(req, res) {
  try {
    const { chatId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false });
    }

    const providerId = provRes.rows[0].id;

    const q = await pool.query(
      `
      SELECT
        s.*,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
        AND COALESCE(s.status, 'draft') = 'draft'
      ORDER BY COALESCE(s.updated_at, s.created_at) DESC
      LIMIT 100
      `,
      [providerId]
    );

    return res.json({ success: true, items: q.rows, services: q.rows });
  } catch (e) {
    console.error("[tg] getProviderDraftServices error:", e);
    return res.status(500).json({ success: false });
  }
}

async function getProviderPendingServices(req, res) {
  try {
    const { chatId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false });
    }

    const providerId = provRes.rows[0].id;

    const q = await pool.query(
      `
      SELECT
        s.*,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
        AND (s.status = 'pending' OR s.moderation_status = 'pending')
      ORDER BY COALESCE(s.updated_at, s.created_at) DESC
      LIMIT 100
      `,
      [providerId]
    );

    return res.json({ success: true, items: q.rows, services: q.rows });
  } catch (e) {
    console.error("[tg] getProviderPendingServices error:", e);
    return res.status(500).json({ success: false });
  }
}



async function getProviderArchiveServices(req, res) {
  try {
    const { chatId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false });
    }

    const providerId = provRes.rows[0].id;

    const q = await pool.query(
      `
      SELECT
        s.*,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
        AND (
          s.status = 'archived'
          OR s.expiration_at <= NOW()
          OR COALESCE((s.details::jsonb ->> 'isActive')::boolean, true) = false
        )
      ORDER BY COALESCE(s.expiration_at, s.updated_at, s.created_at) DESC
      LIMIT 100
      `,
      [providerId]
    );

    return res.json({ success: true, items: q.rows });
  } catch (e) {
    console.error("[tg] getProviderArchiveServices error:", e);
    return res.status(500).json({ success: false });
  }
}

async function getProviderDeletedServices(req, res) {
  try {
    const { chatId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false });
    }

    const providerId = provRes.rows[0].id;

    const q = await pool.query(
      `
      SELECT id, title, category, deleted_at
        FROM services
       WHERE provider_id = $1
         AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT 50
      `,
      [providerId]
    );

    return res.json({ success: true, items: q.rows });
  } catch (e) {
    console.error("[tg] getProviderDeletedServices error:", e);
    return res.status(500).json({ success: false });
  }
}

/**
 * ✅ Публичный поиск (маркетплейс) для provider-бота
 * GET /api/telegram/provider/:chatId/search?category=refused_tour
 *
 * FIX: раньше было только status='approved' => часто 0 результатов.
 * Теперь логика как у client-search:
 * - status IN ('approved','published','active')
 * - isActive true
 * - expiration не истёк
 * - endDate/endFlightDate не в прошлом
 * + добавляем imageUrl (Telegram-friendly)
 */
async function searchPublicServices(req, res) {
  try {
    const chatIdRaw = req.params.chatId;
    const category = String(req.query.category || "").trim();

    // chatId может быть большим int, оставим строкой для сравнения
    const chatId = String(chatIdRaw || "").trim();
    if (!chatId) {
      return res.status(400).json({ success: false, error: "BAD_CHAT_ID" });
    }

    if (!category || !REFUSED_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: "BAD_CATEGORY" });
    }

    // определим провайдера по chatId (если это провайдер)
    let providerId = null;
    try {
      const pr = await pool.query(
        `SELECT id
           FROM providers
          WHERE telegram_chat_id::text = $1
             OR tg_chat_id::text = $1
             OR telegram_web_chat_id::text = $1
             OR telegram_refused_chat_id::text = $1
          LIMIT 1`,
        [chatId]
      );
      providerId = pr.rows[0]?.id || null;
    } catch (e) {
      providerId = null;
    }

    const categoryFilter =
      category === "refused_ticket"
        ? ["refused_ticket", "refused_event_ticket"]
        : [category];

    // Публичные: approved
    // Свои (если providerId найден): published/active/pending/approved
    const q = `
      SELECT
        s.id,
        s.category,
        s.status,
        s.moderation_status,
        s.title,
        s.price,
        s.details,
        s.images,
        s.expiration_at AS expiration,
        s.created_at,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.category = ANY($1::text[])
        AND s.deleted_at IS NULL
        AND (
          s.details IS NULL
          OR (s.details::jsonb->>'isActive') IS NULL
          OR LOWER(s.details::jsonb->>'isActive') = 'true'
        )
        AND (
          s.expiration_at IS NULL
          OR s.expiration_at > NOW()
        )
        AND (
          (s.details::jsonb->>'expiration') IS NULL
          OR NULLIF(s.details::jsonb->>'expiration', '')::timestamp > NOW()
        )
        AND (
          s.status IN ('approved', 'published', 'active')
          OR (
            $2::int IS NOT NULL
            AND s.provider_id = $2
            AND s.status IN ('published', 'active', 'pending', 'approved')
          )
        )
      ORDER BY s.created_at DESC
      LIMIT 200
    `;

    const { rows } = await pool.query(q, [categoryFilter, providerId]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = (rows || []).filter((row) => isRefusedServiceActual(row, today));

    return res.json({ success: true, items });
  } catch (err) {
    console.error("[telegram] searchPublicServices error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
}

async function serviceActionFromBot(req, res, action) {
  try {
    const { chatId, serviceId } = req.params;
    const svcId = Number(serviceId);

    if (!Number.isFinite(svcId) || svcId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "BAD_SERVICE_ID" });
    }

    const providerRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    const oldService = await fetchProviderServiceSnapshot(svcId, providerId);
    if (!oldService) {
      return res
        .status(404)
        .json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    const applied = await applyServiceLifecycleAction(pool, {
      providerId,
      serviceId: svcId,
      action,
    });

    if (!applied.rowCount || !applied.service) {
      return res
        .status(404)
        .json({ success: false, error: "SERVICE_NOT_FOUND_OR_DELETED" });
    }

    const updated = normalizeServiceSnapshot(applied.service);

    const botActionMap = {
      unpublish: "bot_service_unpublished",
      extend7: "bot_service_extended",
      archive: "bot_service_archived",
      restore_active: "bot_service_restored_from_archive",
    };

    await logBotServiceAudit({
      req,
      action: botActionMap[action] || `bot_service_${action}`,
      providerId,
      serviceId: svcId,
      oldService,
      newService: updated,
      meta: { bot_action: action },
    });

    const funnelActionMap = {
      unpublish: "archived",
      extend7: "published",
      archive: "archived",
      restore_active: "published",
    };

    await logProviderFunnelEvent({
      source: "telegram_bot",
      actorRole: "provider",
      actorId: Number(chatId) || null,
      providerId,
      serviceId: svcId,
      category: updated?.category || oldService?.category || null,
      eventName: funnelActionMap[action] || "service_lifecycle_action",
      status: updated?.status || null,
      meta: { bot_action: action, note: "bot_lifecycle_funnel" },
    });

    return res.json({ success: true, service: updated });
  } catch (err) {
    console.error("[telegram] serviceActionFromBot error:", err);
    return res
      .status(err?.status || 500)
      .json({ success: false, error: "SERVER_ERROR" });
  }
}

async function unpublishServiceFromBot(req, res) {
  return serviceActionFromBot(req, res, "unpublish");
}
async function extendService7FromBot(req, res) {
  return serviceActionFromBot(req, res, "extend7");
}
async function archiveServiceFromBot(req, res) {
  return serviceActionFromBot(req, res, "archive");
}
async function restoreArchivedServiceFromBot(req, res) {
  return serviceActionFromBot(req, res, "restore_active");
}

/**
 * Создание услуги из Telegram-бота (шаговый мастер)
 * POST /api/telegram/provider/:chatId/services
 *
 * body: { category, title, price, details, images }
 */
async function createServiceFromBot(req, res) {
  try {
    const { chatId } = req.params;
    const { category, title, price, details, images } = req.body || {};

    if (!category || !REFUSED_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ success: false, error: "BAD_CATEGORY" });
    }

    if (!title || typeof title !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "TITLE_REQUIRED" });
    }

    const safeTitle = clampString(title, MAX_TITLE_LEN);

    const providerRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    let priceNum = null;
    if (price !== undefined && price !== null && price !== "") {
      const n = Number(price);
      if (!Number.isNaN(n)) {
        priceNum = n;
      }
    }

    const safeDetails =
      details && typeof details === "object" && !Array.isArray(details)
        ? { ...details }
        : {};

    const safeImagesArr = Array.isArray(images) ? images : [];
    const normalizedImages = await normalizeImagesForDb(safeImagesArr);

    const expirationParsed = parseExpirationForStorage(safeDetails.expiration);
    if (!expirationParsed.valid) {
      return res.status(400).json({
        success: false,
        error: "BAD_EXPIRATION",
      });
    }

    if (expirationParsed.provided) {
      safeDetails.expiration = expirationParsed.value;
    }

    if (
      expirationParsed.provided &&
      expirationParsed.value &&
      isExpirationAfterTripStartForStorage(category, safeDetails, expirationParsed.value)
    ) {
      return res.status(400).json({
        success: false,
        error: "BAD_EXPIRATION_AFTER_START",
      });
    }

    const safeDetailsJson = JSON.stringify(safeDetails);
    const safeImagesJson = JSON.stringify(normalizedImages);

    const insertRes = await pool.query(
      `
        INSERT INTO services (
          provider_id,
          title,
          category,
          price,
          details,
          images,
          expiration_at,
          status,
          moderation_status,
          submitted_at,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7,
          'draft',
          'draft',
          NULL,
          NOW()
        )
        RETURNING id, title, category, status, moderation_status, details, images
      `,
      [
        providerId,
        safeTitle,
        category,
        priceNum,
        safeDetailsJson,
        safeImagesJson,
        expirationParsed.provided ? expirationParsed.value : null,
      ]
    );

    // ВАЖНО: услуга создаётся как draft. Уведомление модерации отправляется
    // только после submitServiceFromBot(), когда статус становится pending.
    await logBotServiceAudit({
      req,
      action: "bot_service_created",
      providerId,
      serviceId: insertRes.rows[0].id,
      oldService: null,
      newService: insertRes.rows[0],
    });

    await logProviderFunnelEvent({
      source: "telegram_bot",
      actorRole: "provider",
      actorId: Number(chatId) || null,
      providerId,
      serviceId: insertRes.rows[0].id,
      category,
      eventName: "wizard_saved_draft",
      status: "draft",
      meta: { note: "bot_service_created_funnel" },
    });

    return res.json({
      success: true,
      service: insertRes.rows[0],
    });
  } catch (err) {
    console.error("[telegram] createServiceFromBot error:", err);
    return res
      .status(500)
      .json({ success: false, error: "SERVER_ERROR" });
  }
}

async function getProviderServiceByIdFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;
    const svcId = Number(serviceId);

    if (!Number.isFinite(svcId) || svcId <= 0) {
      return res.status(400).json({ success: false, error: "BAD_SERVICE_ID" });
    }

    const providerRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    const svcRes = await pool.query(
      `
      SELECT
        s.id,
        s.provider_id,
        s.category,
        s.status,
        s.title,
        s.price,
        s.details,
        s.images,
        s.expiration_at AS expiration,
        s.created_at,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1 AND s.provider_id = $2
      LIMIT 1
      `,
      [svcId, providerId]
    );

    if (svcRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    return res.json({ success: true, service: svcRes.rows[0] });
  } catch (err) {
    console.error("[telegram] getProviderServiceByIdFromBot error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
}

/**
 Soft-delete (status = deleted)
 МОИ КАРТОЧКИ
 */
async function deleteServiceFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = provRes.rows[0].id;
    const applied = await applyServiceLifecycleAction(pool, {
      providerId,
      serviceId,
      action: "delete",
    });

    await logBotServiceAudit({
      req,
      action: "bot_service_deleted",
      providerId,
      serviceId,
      oldService: applied.before,
      newService: applied.service,
    });

    return res.json({ success: true, item: applied.service });
  } catch (e) {
    console.error("[tg] deleteServiceFromBot error:", e);
    return res.status(e?.status || 500).json({
      success: false,
      error: e?.code || "SERVER_ERROR",
      blockers: e?.blockers || undefined,
    });
  }
}

async function restoreServiceFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = provRes.rows[0].id;
    const applied = await applyServiceLifecycleAction(pool, {
      providerId,
      serviceId,
      action: "restore_deleted",
    });

    await logBotServiceAudit({
      req,
      action: "bot_service_restored",
      providerId,
      serviceId,
      oldService: applied.before,
      newService: applied.service,
    });

    return res.json({ success: true, item: applied.service });
  } catch (e) {
    console.error("[tg] restoreServiceFromBot error:", e);
    return res.status(e?.status || 500).json({
      success: false,
      error: e?.code || "SERVER_ERROR",
      blockers: e?.blockers || undefined,
    });
  }
}

// HARD DELETE SERVICE FROM TRASH
async function purgeServiceFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;

    const provRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!provRes.rowCount) {
      return res.status(403).json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = provRes.rows[0].id;
    const applied = await applyServiceLifecycleAction(pool, {
      providerId,
      serviceId,
      action: "purge",
    });

    await logBotServiceAudit({
      req,
      action: "bot_service_purged",
      providerId,
      serviceId,
      oldService: applied.before,
      newService: null,
    });

    return res.json({ success: true, purgedId: applied.purgedId });
  } catch (e) {
    console.error("[tg] purgeServiceFromBot error:", e);
    return res.status(e?.status || 500).json({
      success: false,
      error: e?.code || "SERVER_ERROR",
      blockers: e?.blockers || undefined,
    });
  }
}

/**
 * PATCH /api/telegram/provider/:chatId/services/:serviceId
 * body: { title?, price?, details?, images? }
 */
async function updateServiceFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;
    const svcId = Number(serviceId);

    if (!Number.isFinite(svcId) || svcId <= 0) {
      return res.status(400).json({ success: false, error: "BAD_SERVICE_ID" });
    }

    const providerRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    const svcRes = await pool.query(
      `SELECT id, provider_id, category, title, price, status, moderation_status, details, images, expiration_at, deleted_at, created_at, updated_at
         FROM services
        WHERE id = $1 AND provider_id = $2
        LIMIT 1`,
      [svcId, providerId]
    );

    if (svcRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    const existing = svcRes.rows[0];
    const prevPrices = extractPrices(existing);

    if (!REFUSED_CATEGORIES.includes(existing.category)) {
      return res
        .status(400)
        .json({ success: false, error: "CATEGORY_NOT_EDITABLE" });
    }

    const body = req.body || {};

    const nextTitleRaw =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : existing.title;

    const nextTitle = clampString(nextTitleRaw, MAX_TITLE_LEN);

    let nextPrice = existing.price;
    if (body.price !== undefined && body.price !== null && body.price !== "") {
      const n = Number(body.price);
      if (!Number.isNaN(n)) nextPrice = n;
    }

    let prevDetails = existing.details || {};
    if (typeof prevDetails === "string") {
      try {
        prevDetails = JSON.parse(prevDetails);
      } catch {
        prevDetails = {};
      }
    }
    if (!prevDetails || typeof prevDetails !== "object" || Array.isArray(prevDetails)) {
      prevDetails = {};
    }

    const rawPatchDetails =
      body.details && typeof body.details === "object" && !Array.isArray(body.details)
        ? body.details
        : {};

    const patchDetails = { ...rawPatchDetails };
    const hasExpirationInPatch = Object.prototype.hasOwnProperty.call(
      patchDetails,
      "expiration"
    );

    if (hasExpirationInPatch) {
      const parsed = parseExpirationForStorage(patchDetails.expiration);
      if (!parsed.valid) {
        return res.status(400).json({
          success: false,
          error: "BAD_EXPIRATION",
        });
      }
      patchDetails.expiration = parsed.value;
    }

    const mergedDetails = {
      ...(prevDetails || {}),
      ...(patchDetails || {}),
    };

    let nextExpirationAt = existing.expiration_at || null;

    if (hasExpirationInPatch) {
      nextExpirationAt = patchDetails.expiration || null;
    } else if (
      Object.prototype.hasOwnProperty.call(mergedDetails, "expiration") &&
      mergedDetails.expiration
    ) {
      const parsedMerged = parseExpirationForStorage(mergedDetails.expiration);
      if (!parsedMerged.valid) {
        return res.status(400).json({
          success: false,
          error: "BAD_EXPIRATION",
        });
      }
      mergedDetails.expiration = parsedMerged.value;
      nextExpirationAt = parsedMerged.value;
    }

    let nextImages = existing.images || [];
    if (typeof nextImages === "string") {
      try {
        nextImages = JSON.parse(nextImages);
      } catch {
        nextImages = [];
      }
    }
    if (!Array.isArray(nextImages)) nextImages = [];

    if (Object.prototype.hasOwnProperty.call(body, "images")) {
      if (body.images === null) {
        nextImages = [];
      } else if (Array.isArray(body.images)) {
        nextImages = await normalizeImagesForDb(body.images);
      }
    }

    const updRes = await pool.query(
      `
      UPDATE services
         SET
           title = $3,
           price = $4,
           details = $5::jsonb,
           expiration_at = $6,
           images = $7::jsonb,
           status = 'draft',
           moderation_status = 'draft',
           submitted_at = NULL,
           published_at = NULL,
           approved_at = NULL,
           rejected_at = NULL,
           rejected_reason = NULL,
           updated_at = NOW()
       WHERE id = $1 AND provider_id = $2
       RETURNING id, provider_id, title, price, category, status, moderation_status, details, images, expiration_at, deleted_at, created_at, updated_at
      `,
      [
        svcId,
        providerId,
        nextTitle,
        nextPrice,
        JSON.stringify(mergedDetails),
        nextExpirationAt,
        JSON.stringify(nextImages),
      ]
    );

    try {
      const nextSvcRow = updRes.rows[0];
      const nextPrices = extractPrices(nextSvcRow);
      const drop = isPriceDrop(prevPrices, nextPrices);

      if (drop.any) {
        await broadcastPriceDropCard(nextSvcRow.id, "🔥 <b>ЦЕНА СНИЖЕНА!</b>");
      }
    } catch (e) {
      console.error("[price drop] broadcast failed (bot):", e?.message || e);
    }

    await logBotServiceAudit({
      req,
      action: "bot_service_updated",
      providerId,
      serviceId: svcId,
      oldService: existing,
      newService: updRes.rows[0],
    });

    // ВАЖНО: после редактирования услуга остаётся draft.
    // Уведомление модерации отправляется только после proof + submitServiceFromBot().
    return res.json({ success: true, service: updRes.rows[0] });
  } catch (err) {
    console.error("[telegram] updateServiceFromBot error:", err);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: err?.message || "Unknown error",
    });
  }
}

async function submitServiceFromBot(req, res) {
  try {
    const { chatId, serviceId } = req.params;
    const svcId = Number(serviceId);

    if (!Number.isFinite(svcId) || svcId <= 0) {
      return res.status(400).json({ success: false, error: "BAD_SERVICE_ID" });
    }

    const providerRes = await pool.query(
      `SELECT id
         FROM providers
        WHERE telegram_chat_id::text = $1
           OR tg_chat_id::text = $1
           OR telegram_web_chat_id::text = $1
           OR telegram_refused_chat_id::text = $1
        LIMIT 1`,
      [chatId]
    );

    if (!providerRes.rowCount) {
      return res.status(404).json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = providerRes.rows[0].id;
    const applied = await applyServiceLifecycleAction(pool, {
      providerId,
      serviceId: svcId,
      action: "submit",
    });

    await logBotServiceAudit({
      req,
      action: "bot_service_submitted",
      providerId,
      serviceId: svcId,
      oldService: applied.before,
      newService: applied.service,
    });

    await logProviderFunnelEvent({
      source: "telegram_bot",
      actorRole: "provider",
      actorId: Number(chatId) || null,
      providerId,
      serviceId: svcId,
      category: applied?.service?.category || applied?.before?.category || null,
      eventName: "submitted_to_moderation",
      status: applied?.service?.status || "pending",
      meta: { note: "bot_service_submitted_funnel" },
    });

    try {
      await notifyModerationNew({ service: svcId });
    } catch (e) {
      console.error("[telegram] notifyModerationNew failed:", e);
    }

    return res.json({ success: true, service: applied.service });
  } catch (err) {
    console.error("[telegram] submitServiceFromBot error:", err);
    return res.status(err?.status || 500).json({
      success: false,
      error: err?.code || "SERVER_ERROR",
      message: err?.code === "PROOF_IMAGES_REQUIRED" ? "Proof images are required" : undefined,
      blockers: err?.blockers || undefined,
    });
  }
}

module.exports = {
  getProviderBookings,
  confirmBooking,
  rejectBooking,
  getProviderServices,
  getProviderServicesAll,
  getProviderDraftServices,
  getProviderPendingServices,
  getProviderDeletedServices,
  getProviderArchiveServices,
  deleteServiceFromBot,
  restoreServiceFromBot,
  purgeServiceFromBot,
  searchPublicServices,
  getProviderServiceByIdFromBot,
  updateServiceFromBot,
  unpublishServiceFromBot,
  extendService7FromBot,
  archiveServiceFromBot,
  restoreArchivedServiceFromBot,
  createServiceFromBot,
  submitServiceFromBot,
};
