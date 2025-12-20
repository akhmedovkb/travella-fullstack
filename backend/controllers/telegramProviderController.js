// backend/controllers/telegramProviderController.js
const pool = require("../db");
const axiosBase = require("axios");
const { tgSend } = require("../utils/telegram");
const MAX_TITLE_LEN = 100;

const REFUSED_CATEGORIES = [
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
];

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
        WHERE telegram_chat_id = $1
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
        AND p.telegram_chat_id = $2
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
        AND p.telegram_chat_id = $2
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
        WHERE telegram_chat_id = $1
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
          s.expiration_at AS expiration,
          s.created_at,
          p.name   AS provider_name,
          p.social AS provider_telegram
        FROM services s
        LEFT JOIN providers p ON p.id = s.provider_id
       WHERE s.provider_id = $1
         AND s.category = ANY($2::text[])
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
        `SELECT id FROM providers WHERE telegram_chat_id::text = $1 LIMIT 1`,
        [chatId]
      );
      providerId = pr.rows[0]?.id || null;
    } catch (e) {
      providerId = null;
    }

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
      WHERE s.category = $1
        AND (
          s.status = 'approved'
          OR (
            $2::int IS NOT NULL
            AND s.provider_id = $2
            AND s.status IN ('published', 'active', 'pending', 'approved')
          )
        )
      ORDER BY s.created_at DESC
      LIMIT 100
    `;

    const { rows } = await pool.query(q, [category, providerId]);

    return res.json({ success: true, items: rows || [] });
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
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    const svcRes = await pool.query(
      `SELECT id, status, details, expiration_at
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

    let updated;

    if (action === "unpublish") {
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               details = jsonb_set(
                 jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                           '{isActive}', 'false'::jsonb, true),
                 '{expiration}',
                 to_jsonb(NOW()::timestamp)::jsonb,
                 true
               ),
               expiration_at = NOW()
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else if (action === "extend7") {
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               expiration_at = COALESCE(expiration_at, NOW()) + interval '7 days',
               details = jsonb_set(
                 COALESCE(details::jsonb, '{}'::jsonb),
                 '{expiration}',
                 to_jsonb(
                   (COALESCE(expiration_at, NOW()) + interval '7 days')::timestamp
                 )::jsonb,
                 true
               )
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else if (action === "archive") {
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               status = 'archived',
               expiration_at = COALESCE(expiration_at, NOW()),
               details = jsonb_set(
                 COALESCE(details::jsonb, '{}'::jsonb),
                 '{isActive}',
                 'false'::jsonb,
                 true
               )
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else {
      return res
        .status(400)
        .json({ success: false, error: "UNKNOWN_ACTION" });
    }

    return res.json({ success: true, service: updated });
  } catch (err) {
    console.error("[telegram] serviceActionFromBot error:", err);
    return res
      .status(500)
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
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
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

    const safeDetails = details && typeof details === "object" ? details : {};
    const safeImagesArr = Array.isArray(images) ? images : [];

    const normalizedImages = await normalizeImagesForDb(safeImagesArr);

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
          'pending',
          'pending',
          NOW(),
          NOW()
        )
        RETURNING id, title, category, status, moderation_status, details, images
      `,
      [providerId, safeTitle, category, priceNum, safeDetailsJson, safeImagesJson]
    );

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
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "PROVIDER_NOT_FOUND" });
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
      return res.status(404).json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    return res.json({ success: true, service: svcRes.rows[0] });
  } catch (err) {
    console.error("[telegram] getProviderServiceByIdFromBot error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
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
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    const svcRes = await pool.query(
      `SELECT id, category, title, price, details, images, expiration_at
         FROM services
        WHERE id = $1 AND provider_id = $2
        LIMIT 1`,
      [svcId, providerId]
    );

    if (svcRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    const existing = svcRes.rows[0];

    if (!REFUSED_CATEGORIES.includes(existing.category)) {
      return res.status(400).json({ success: false, error: "CATEGORY_NOT_EDITABLE" });
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
      try { prevDetails = JSON.parse(prevDetails); } catch { prevDetails = {}; }
    }
    const patchDetails = body.details && typeof body.details === "object" ? body.details : {};
    const mergedDetails = { ...(prevDetails || {}), ...(patchDetails || {}) };

    let nextExpirationAt = existing.expiration_at || null;
    if (mergedDetails && mergedDetails.expiration) {
      const d = new Date(mergedDetails.expiration);
      if (!Number.isNaN(d.getTime())) {
        nextExpirationAt = d.toISOString();
      }
    }

    // images:
    //   omitted -> keep existing
    //   null    -> clear
    //   array   -> replace (ВАЖНО: await!)
    let nextImages = existing.images || [];
    if (typeof nextImages === "string") {
      try { nextImages = JSON.parse(nextImages); } catch { nextImages = []; }
    }
    if (Object.prototype.hasOwnProperty.call(body, "images")) {
      if (body.images === null) {
        nextImages = [];
      } else if (Array.isArray(body.images)) {
        // ✅ FIX: await (иначе в БД попадёт {} и будет jsonb_typeof <> 'array')
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
           images = $7::jsonb
       WHERE id = $1 AND provider_id = $2
       RETURNING id, title, price, category, status, details, images, expiration_at
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

    return res.json({ success: true, service: updRes.rows[0] });
  } catch (err) {
    console.error("[telegram] updateServiceFromBot error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
}

module.exports = {
  getProviderBookings,
  confirmBooking,
  rejectBooking,
  getProviderServices,
  searchPublicServices,
  getProviderServiceByIdFromBot,
  updateServiceFromBot,
  unpublishServiceFromBot,
  extendService7FromBot,
  archiveServiceFromBot,
  createServiceFromBot,
};
