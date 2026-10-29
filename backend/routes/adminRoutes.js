// backend/routes/adminRoutes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const pool = require("../db");
const { readModerationQueue } = require("../utils/adminModerationQueue");
const { correctionNotificationParts, correctionSnapshot, normalizeReasonCodes, readCorrectionReview } = require("../utils/serviceCorrections");
const { writeServiceEditHistory } = require("../utils/serviceEditHistory");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const leadController = require("../controllers/leadController");
const { uploadBufferToR2 } = require("../utils/r2Upload");

const {
  tgSend,
  notifyModerationApproved,
  notifyModerationRejected,
  notifyModerationUnpublished,
} = require("../utils/telegram");

const { broadcastApprovedService } = require("../utils/serviceApprovalBroadcast");
const {
  ensureServiceModerationEvents,
  logServiceModerationEvent,
  listServiceModerationEvents,
} = require("../utils/serviceModerationEvents");

function phoneToDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

const adminImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (String(file?.mimetype || "").toLowerCase().startsWith("image/")) return cb(null, true);
    const error = new Error("unsupported_image_type");
    error.code = "unsupported_image_type";
    return cb(error);
  },
});

/* ---------- СПИСКИ (идут первыми) ---------- */

router.get("/services/queue", authenticateToken, requireAdmin, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    await ensureServiceModerationEvents(pool);
    res.json(await readModerationQueue(pool, req.query));
  } catch (error) {
    console.error("[admin service queue]", error.message);
    res.status(500).json({ ok: false, message: "Не удалось загрузить очередь. Повторите запрос." });
  }
});

router.get("/services/counts", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE COALESCE(s.moderation_status, s.status) = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE COALESCE(s.moderation_status, s.status) = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status, '')) IN ('published','approved','active') AND COALESCE(LOWER(s.moderation_status), 'approved') IN ('approved','published','active'))::int AS published
      FROM services s JOIN providers p ON p.id = s.provider_id WHERE s.deleted_at IS NULL`);
    res.json({ ok: true, counts: result.rows[0] });
  } catch (error) {
    console.error("[admin service counts]", error.message);
    res.status(500).json({ ok: false, message: "Не удалось загрузить счётчики" });
  }
});

// /api/admin/services/pending
router.get("/services/pending", authenticateToken, requireAdmin, async (req, res) => {
  await ensureServiceModerationEvents(pool);
  const q = await pool.query(
    `SELECT
        s.*,
        p.name AS provider_name,
        p.type AS provider_type,
        p.phone AS provider_phone,
        p.social AS provider_social,
        p.telegram_refused_chat_id AS provider_telegram_refused_chat_id,
        p.telegram_web_chat_id AS provider_telegram_web_chat_id,
        p.telegram_chat_id AS provider_telegram_chat_id,
        p.tg_chat_id AS provider_tg_chat_id,
        ev.action AS last_moderation_action,
        ev.reason_code AS last_moderation_reason_code,
        ev.reason AS last_moderation_reason,
        ev.created_at AS last_moderation_at,
        ev.actor_id AS last_moderation_actor_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       LEFT JOIN LATERAL (
         SELECT action, reason_code, reason, created_at, actor_id
           FROM service_moderation_events
          WHERE service_id = s.id AND action NOT IN ('service_edited','correction_reviewed')
          ORDER BY created_at DESC
          LIMIT 1
       ) ev ON TRUE
      WHERE COALESCE(s.moderation_status, s.status) = 'pending' AND s.deleted_at IS NULL
      ORDER BY s.submitted_at ASC NULLS LAST, s.updated_at DESC`
  );
  res.json(q.rows);
});

// /api/admin/services/rejected
router.get("/services/rejected", authenticateToken, requireAdmin, async (req, res) => {
  await ensureServiceModerationEvents(pool);
  const q = await pool.query(
    `SELECT
        s.*,
        p.name AS provider_name,
        p.type AS provider_type,
        p.phone AS provider_phone,
        p.social AS provider_social,
        p.telegram_refused_chat_id AS provider_telegram_refused_chat_id,
        p.telegram_web_chat_id AS provider_telegram_web_chat_id,
        p.telegram_chat_id AS provider_telegram_chat_id,
        p.tg_chat_id AS provider_tg_chat_id,
        ev.action AS last_moderation_action,
        ev.reason_code AS last_moderation_reason_code,
        ev.reason AS last_moderation_reason,
        ev.created_at AS last_moderation_at,
        ev.actor_id AS last_moderation_actor_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       LEFT JOIN LATERAL (
         SELECT action, reason_code, reason, created_at, actor_id
           FROM service_moderation_events
          WHERE service_id = s.id AND action NOT IN ('service_edited','correction_reviewed')
          ORDER BY created_at DESC
          LIMIT 1
       ) ev ON TRUE
      WHERE COALESCE(s.moderation_status, s.status) = 'rejected' AND s.deleted_at IS NULL
      ORDER BY COALESCE(s.rejected_at, s.updated_at) DESC`
  );
  res.json(q.rows);
});

// /api/admin/services/published
router.get("/services/published", authenticateToken, requireAdmin, async (req, res) => {
  await ensureServiceModerationEvents(pool);
  const q = await pool.query(
    `SELECT
        s.*,
        p.name AS provider_name,
        p.type AS provider_type,
        p.phone AS provider_phone,
        p.social AS provider_social,
        p.telegram_refused_chat_id AS provider_telegram_refused_chat_id,
        p.telegram_web_chat_id AS provider_telegram_web_chat_id,
        p.telegram_chat_id AS provider_telegram_chat_id,
        p.tg_chat_id AS provider_tg_chat_id,
        ev.action AS last_moderation_action,
        ev.reason_code AS last_moderation_reason_code,
        ev.reason AS last_moderation_reason,
        ev.created_at AS last_moderation_at,
        ev.actor_id AS last_moderation_actor_id,
        COALESCE(stats.views_count, 0)::int AS views_count,
        COALESCE(stats.unlocks_count, 0)::int AS contact_unlocks_count,
        COALESCE(stats.quick_requests_count, 0)::int AS quick_requests_count,
        COALESCE(stats.telegram_failed_count, 0)::int AS telegram_failed_count,
        COALESCE(stats.telegram_sent_count, 0)::int AS telegram_sent_count
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       LEFT JOIN LATERAL (
         SELECT action, reason_code, reason, created_at, actor_id
           FROM service_moderation_events
          WHERE service_id = s.id AND action NOT IN ('service_edited','correction_reviewed')
          ORDER BY created_at DESC
          LIMIT 1
       ) ev ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           (SELECT COUNT(*) FROM service_views v WHERE v.service_id = s.id) AS views_count,
           (SELECT COUNT(*) FROM client_service_contact_unlocks u WHERE u.service_id = s.id) AS unlocks_count,
           (SELECT COUNT(*) FROM telegram_quick_requests q WHERE q.service_id = s.id) AS quick_requests_count,
           (SELECT COUNT(*) FROM service_moderation_events me WHERE me.service_id = s.id AND me.action = 'telegram_failed') AS telegram_failed_count,
           (SELECT COUNT(*) FROM service_moderation_events me WHERE me.service_id = s.id AND me.action = 'telegram_sent') AS telegram_sent_count
       ) stats ON TRUE
      WHERE s.deleted_at IS NULL
        AND LOWER(COALESCE(s.status, '')) IN ('published','approved','active')
        AND COALESCE(LOWER(s.moderation_status), 'approved') IN ('approved','published','active')
      ORDER BY COALESCE(s.published_at, s.approved_at, s.updated_at) DESC
      LIMIT 200`
  );
  res.json(q.rows);
});

/* ---------- ДЕЙСТВИЯ и карточка (после списков; :id только цифры) ---------- */

// карточка услуги для предпросмотра
router.get("/services/:id(\\d+)", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT
        s.*,
        to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version,
        to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS provider_edit_version,
        p.name AS provider_name,
        p.type AS provider_type,
        p.telegram_refused_chat_id,
        p.telegram_web_chat_id,
        p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1`,
    [req.params.id]
  );
  if (!q.rows.length) return res.status(404).json({ message: "Not found" });
  res.json(q.rows[0]);
});

router.post(
  "/services/:id(\\d+)/proof-images/upload",
  authenticateToken,
  requireAdmin,
  adminImageUpload.array("files", 20),
  async (req, res) => {
    try {
      const serviceId = Number(req.params.id);
      if (!Number.isFinite(serviceId) || serviceId <= 0) {
        return res.status(400).json({ ok: false, message: "Bad service id" });
      }

      const exists = await pool.query(`SELECT id FROM services WHERE id = $1 LIMIT 1`, [serviceId]);
      if (!exists.rows.length) return res.status(404).json({ ok: false, message: "Service not found" });

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ ok: false, message: "No images uploaded" });

      const uploaded = [];
      for (const file of files) {
        const result = await uploadBufferToR2(file, {
          folder: "refused-services/proof",
          public_prefix: `service-${serviceId}-proof`,
        });
        uploaded.push({
          url: result.url,
          width: result.width,
          height: result.height,
          publicId: result.public_id,
        });
      }

      return res.json({ ok: true, images: uploaded });
    } catch (error) {
      console.error("[admin proof upload] error:", error?.message || error);
      const notConfigured = error?.code === "r2_not_configured";
      return res.status(notConfigured ? 503 : 500).json({
        ok: false,
        message: notConfigured ? "Хранилище изображений не настроено" : "Не удалось загрузить подтверждение",
      });
    }
  }
);

router.post(
  "/services/:id(\\d+)/images/upload",
  authenticateToken,
  requireAdmin,
  adminImageUpload.array("files", 20),
  async (req, res) => {
    try {
      const serviceId = Number(req.params.id);
      if (!Number.isFinite(serviceId) || serviceId <= 0) {
        return res.status(400).json({ ok: false, message: "Bad service id" });
      }

      const exists = await pool.query(`SELECT id FROM services WHERE id = $1 LIMIT 1`, [serviceId]);
      if (!exists.rows.length) return res.status(404).json({ ok: false, message: "Service not found" });

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ ok: false, message: "No images uploaded" });

      const uploaded = [];
      for (const file of files) {
        const result = await uploadBufferToR2(file, {
          folder: "services/images",
          public_prefix: `service-${serviceId}`,
        });
        uploaded.push({
          url: result.url,
          width: result.width,
          height: result.height,
          publicId: result.public_id,
        });
      }

      return res.json({ ok: true, images: uploaded });
    } catch (error) {
      console.error("[admin service image upload] error:", error?.message || error);
      const notConfigured = error?.code === "r2_not_configured";
      return res.status(notConfigured ? 503 : 500).json({
        ok: false,
        message: notConfigured ? "Хранилище изображений не настроено" : "Не удалось загрузить изображения",
      });
    }
  }
);

router.get("/services/:id(\\d+)/moderation-events", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const events = await listServiceModerationEvents(pool, req.params.id, req.query?.limit || 30);
    const current = await pool.query(`SELECT s.*, to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id=$1 AND deleted_at IS NULL`,[req.params.id]);
    if (!current.rows[0]) return res.status(404).json({message:"Услуга не найдена"});
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, items: events, correction: await readCorrectionReview(pool,current.rows[0]) });
  } catch (e) {
    console.error("[admin moderation-events] error:", e?.message || e);
    res.status(500).json({ ok: false, message: "moderation events error" });
  }
});

router.post("/services/:id(\\d+)/correction-review", authenticateToken, requireAdmin, async (req,res) => {
  let db;
  try {
    await ensureServiceModerationEvents(pool);
    db = await pool.connect();
    await db.query("BEGIN");
    const result = await db.query(`SELECT s.*, to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[req.params.id]);
    const service = result.rows[0];
    if (!service) throw Object.assign(new Error("Услуга не найдена"),{status:404});
    const correction = await readCorrectionReview(db,service);
    if (!correction || String(correction.requestId)!==String(req.body?.requestId) || service.edit_version!==req.body?.expected_edit_version) throw Object.assign(new Error("Данные изменились. Откройте услугу повторно перед проверкой."),{status:409});
    const codes = req.body?.checkedCodes;
    if (!Array.isArray(codes) || codes.length>10 || codes.some(c=>!correction.reasonCodes.includes(c))) throw Object.assign(new Error("Некорректный список проверок"),{status:400});
    await db.query(`INSERT INTO service_moderation_events (service_id,actor_id,actor_role,action,meta) VALUES ($1,$2,'admin','correction_reviewed',$3::jsonb)`,[service.id,req.user.id,JSON.stringify({requestId:correction.requestId,checkedCodes:[...new Set(codes)],fingerprint:correction.fingerprint})]);
    await db.query("COMMIT");
    res.json({ok:true});
  } catch(error) { if(db) await db.query("ROLLBACK"); res.status(error.status || 500).json({message:error.status ? error.message : "Не удалось сохранить проверку"}); }
  finally { db?.release(); }
});

// полное редактирование услуги админом без ломания модерации
router.put("/services/:id(\\d+)", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ message: "Bad service id" });
  }

  const parseMaybeJson = (value, fallback) => {
    if (typeof value === "undefined") return fallback;
    if (value === null) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error("INVALID_JSON");
      }
    }
    return value;
  };

  let client;
  let transactionOpen = false;
  try {
    await ensureServiceModerationEvents(pool);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    const cur = await client.query(`SELECT s.*, to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    const row = cur.rows[0];
    const body = req.body || {};
    if (typeof body.expected_edit_version !== "undefined" && body.expected_edit_version !== row.edit_version) {
      return res.status(409).json({ ok: false, code: "SERVICE_EDIT_CONFLICT", message: "Услуга изменена после открытия редактора. Ваш черновик сохранён в форме." });
    }
    const normalizeChatId = (value) => {
      if (typeof value === "undefined") return undefined;
      if (value === null) return null;
      const s = String(value).trim();
      if (!s) return null;
      if (!/^-?\d+$/.test(s)) {
        throw new Error("INVALID_CHAT_ID");
      }
      return s;
    };

    let nextImages;
    let nextAvailability;
    let nextDetails;

    try {
      nextImages = parseMaybeJson(body.images, row.images ?? []);
      nextAvailability = parseMaybeJson(body.availability, row.availability ?? []);
      nextDetails = parseMaybeJson(body.details, row.details ?? {});
    } catch {
      return res.status(400).json({ message: "Invalid JSON payload" });
    }

    if (nextDetails && typeof nextDetails === "object" && !Array.isArray(nextDetails)) {
      const previousDetails = row.details && typeof row.details === "object" && !Array.isArray(row.details)
        ? row.details
        : {};
      const previousProofStatus = String(previousDetails.proofReviewStatus || "").trim().toLowerCase();
      const nextProofStatus = String(nextDetails.proofReviewStatus || "").trim().toLowerCase();

      if (nextProofStatus !== previousProofStatus) {
        if (nextProofStatus === "approved" || nextProofStatus === "rejected") {
          nextDetails.proofReviewedAt = new Date().toISOString();
          nextDetails.proofReviewedBy = req.user?.id || null;
        } else {
          nextDetails.proofReviewedAt = "";
          nextDetails.proofReviewedBy = null;
        }
      }
    }

    const nextTitle =
      typeof body.title === "undefined" ? row.title : body.title;
    const nextDescription =
      typeof body.description === "undefined" ? row.description : body.description;
    const nextCategory =
      typeof body.category === "undefined" ? row.category : body.category;
    const normalizePrice = (value, fallback) => {
      if (typeof value === "undefined") return fallback;
      if (value === null) return null;

      const s = String(value).trim();
      if (!s) return null;

      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("INVALID_PRICE");
      }

      return n;
    };

    const nextPrice = normalizePrice(body.price, row.price);
    const nextNetPrice = normalizePrice(body.net_price, row.net_price);
    const nextGrossPrice = normalizePrice(body.gross_price, row.gross_price);
    const detailNet = Number(String(nextDetails?.netPrice ?? nextDetails?.net_price ?? nextNetPrice ?? "").replace(/\s/g, "").replace(",", "."));
    const detailGross = Number(String(nextDetails?.grossPrice ?? nextDetails?.gross_price ?? nextDetails?.price ?? nextGrossPrice ?? nextPrice ?? "").replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(detailNet) && Number.isFinite(detailGross) && detailGross < detailNet) return res.status(400).json({ message: "Gross не должен быть ниже Netto" });
    const nextCurrency = typeof body.currency === "undefined" ? row.currency : String(body.currency || "USD").trim().toUpperCase().slice(0, 8);
    const nextCountry = typeof body.country === "undefined" ? row.country : String(body.country || "").trim() || null;
    const nextCity = typeof body.city === "undefined" ? row.city : String(body.city || "").trim() || null;
    const nextLocation = typeof body.location === "undefined" ? row.location : String(body.location || "").trim() || null;
    const nextExpirationAt = typeof body.expiration_at === "undefined" ? row.expiration_at : (body.expiration_at || null);
    const nextVehicleModel =
      typeof body.vehicle_model === "undefined"
        ? row.vehicle_model
        : body.vehicle_model;

    let nextTelegramRefusedChatId;
    let nextTelegramWebChatId;
    let nextTelegramChatId;

    try {
      nextTelegramRefusedChatId = normalizeChatId(body.telegram_refused_chat_id);
      nextTelegramWebChatId = normalizeChatId(body.telegram_web_chat_id);
      nextTelegramChatId = normalizeChatId(body.telegram_chat_id);
    } catch (e) {
      if (e?.message === "INVALID_CHAT_ID") {
        return res.status(400).json({ message: "Invalid Telegram chat id" });
      }
      throw e;
    }
        const providerId = row.provider_id;
    const providerCur = await client.query(
      `SELECT telegram_refused_chat_id, telegram_web_chat_id, telegram_chat_id,
         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS provider_edit_version
         FROM providers WHERE id = $1 FOR UPDATE`,
      [providerId]
    );

    if (!providerCur.rows.length) {
      return res.status(404).json({ message: "Provider not found" });
    }

    const providerRow = providerCur.rows[0];
    const editingContacts = ["telegram_refused_chat_id", "telegram_web_chat_id", "telegram_chat_id"].some((key) => typeof body[key] !== "undefined");
    if (editingContacts && typeof body.expected_provider_edit_version !== "undefined" && body.expected_provider_edit_version !== providerRow.provider_edit_version) {
      return res.status(409).json({ ok: false, code: "PROVIDER_EDIT_CONFLICT", message: "Контакты поставщика изменены другим администратором. Ваш черновик сохранён в форме." });
    }

    const finalTelegramRefusedChatId =
      typeof nextTelegramRefusedChatId === "undefined"
        ? providerRow.telegram_refused_chat_id
        : nextTelegramRefusedChatId;

    const finalTelegramWebChatId =
      typeof nextTelegramWebChatId === "undefined"
        ? providerRow.telegram_web_chat_id
        : nextTelegramWebChatId;

    const finalTelegramChatId =
      typeof nextTelegramChatId === "undefined"
        ? providerRow.telegram_chat_id
        : nextTelegramChatId;
    
    const upd = await client.query(
      `UPDATE services
          SET title = $2,
              description = $3,
              category = $4,
              price = $5,
             images = $6::jsonb,
              availability = $7::jsonb,
              details = $8::jsonb,
              vehicle_model = $9,
              currency = $10,
              net_price = $11,
              gross_price = $12,
              country = $13,
              city = $14,
              location = $15,
              expiration_at = $16,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version`,
      [
        id,
        nextTitle,
        nextDescription,
        nextCategory,
        nextPrice,
        JSON.stringify(Array.isArray(nextImages) ? nextImages : []),
        JSON.stringify(Array.isArray(nextAvailability) ? nextAvailability : []),
        JSON.stringify(
          nextDetails && typeof nextDetails === "object" && !Array.isArray(nextDetails)
            ? nextDetails
            : {}
        ),
        nextVehicleModel,
        nextCurrency,
        nextNetPrice,
        nextGrossPrice,
        nextCountry,
        nextCity,
        nextLocation,
        nextExpirationAt,
      ]
    );
    await client.query(
      `UPDATE providers
          SET telegram_refused_chat_id = $2,
              telegram_web_chat_id = $3,
              telegram_chat_id = $4,
              updated_at = NOW()
        WHERE id = $1 AND (telegram_refused_chat_id IS DISTINCT FROM $2 OR telegram_web_chat_id IS DISTINCT FROM $3 OR telegram_chat_id IS DISTINCT FROM $4)`,
      [
        providerId,
        finalTelegramRefusedChatId,
        finalTelegramWebChatId,
        finalTelegramChatId,
      ]
    );

    await writeServiceEditHistory(client, {
      before: row, after: upd.rows[0], providerBefore: providerRow,
      providerAfter: { telegram_refused_chat_id: finalTelegramRefusedChatId, telegram_web_chat_id: finalTelegramWebChatId, telegram_chat_id: finalTelegramChatId },
      actorId: req.user?.id,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return res.json({
      ok: true,
      service: {
        ...upd.rows[0],
        telegram_refused_chat_id: finalTelegramRefusedChatId,
        telegram_web_chat_id: finalTelegramWebChatId,
        telegram_chat_id: finalTelegramChatId,
      },
    });
  } catch (e) {
    if (e?.message === "INVALID_PRICE") {
      return res.status(400).json({ message: "Invalid price" });
    }

    console.error("[admin update service] error:", e);
    return res.status(500).json({ message: "Internal error" });
  } finally {
    if (transactionOpen && client) await client.query("ROLLBACK").catch((error) => console.error("[admin edit rollback]", error.message));
    if (client) client.release();
  }
});

/**
 * ✅ Авто-запись previousPrice при изменении цены в админке
 * PATCH /api/admin/services/:id/price
 *
 * Ожидаем: { grossPrice: "1750" } (можно число/строку, с валютой или без)
 * Логика:
 * - читаем текущие details
 * - oldCurrent = details.grossPrice || details.price || details.netPrice || services.price
 * - пишем details.previousPrice = oldCurrent, если новая цена реально изменилась
 * - обновляем details.grossPrice
 *
 * Ничего из текущего approve/broadcast не ломаем.
 */
router.patch("/services/:id(\\d+)/price", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Bad service id" });

  const { grossPrice } = req.body || {};
  if (grossPrice === undefined) {
    return res.status(400).json({ message: "grossPrice is required" });
  }

  const toNum = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  try {
    const cur = await pool.query(`SELECT id, price, details FROM services WHERE id=$1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ message: "Not found" });

    const row = cur.rows[0];

    // parse details robustly
    let d = {};
    if (row.details && typeof row.details === "object") d = row.details;
    else if (typeof row.details === "string") {
      try {
        d = JSON.parse(row.details);
      } catch {
        d = {};
      }
    }

    // "старая" цена — в том же порядке, как её берёт карточка для client
    const oldCurrent = d.grossPrice ?? d.price ?? d.netPrice ?? row.price ?? null;

    // проставляем новую цену
    d.grossPrice = grossPrice;

    const oldNum = toNum(oldCurrent);
    const newNum = toNum(grossPrice);

    // если реально поменялось — фиксируем previousPrice
    if (oldNum !== null && newNum !== null && newNum !== oldNum) {
      d.previousPrice = oldCurrent;
    }

    const upd = await pool.query(
      `UPDATE services
          SET details = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, details, updated_at`,
      [id, JSON.stringify(d)]
    );

    return res.json({ ok: true, service: upd.rows[0] });
  } catch (e) {
    console.error("[admin service price] error:", e);
    return res.status(500).json({ message: "Internal error" });
  }
});

// approve (только для pending)
router.post("/services/:id(\\d+)/approve", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const body = req.body || {};
  const approvalMode = String(body.approvalMode || body.approval_mode || "clean").trim().toLowerCase();
  const approvalWarnings = Array.isArray(body.warnings)
    ? body.warnings.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20)
    : [];
  const approvalAction =
    approvalMode === "with_warnings" || approvalWarnings.length
      ? "approved_with_warnings"
      : "approved_clean";

  const beforeRes = await pool.query(
    `SELECT id, status, moderation_status, details FROM services WHERE id = $1`,
    [req.params.id]
  );
  const before = beforeRes.rows[0] || null;

  const { rows } = await pool.query(
    `UPDATE services
        SET moderation_status = 'approved',
            status            = 'published',
            approved_at       = NOW(),
            approved_by       = $2,
            published_at      = NOW(),
            rejected_at       = NULL,
            rejected_by       = NULL,
            rejected_reason   = NULL,
            updated_at        = NOW()
      WHERE id = $1 AND COALESCE(moderation_status, status) IN ('pending','rejected','approved') AND deleted_at IS NULL
      RETURNING id, status, moderation_status, published_at`,
    [req.params.id, adminId]
  );

  if (!rows.length) {
    return res.status(400).json({ message: "Service is not available for this moderation action" });
  }

  await logServiceModerationEvent(pool, {
    serviceId: rows[0].id,
    actorId: adminId,
    actorRole: "admin",
    action: approvalAction,
    before,
    after: rows[0],
    meta: {
      approvalMode: approvalAction,
      warnings: approvalWarnings,
    },
  });

  // TG → поставщику (выбор правильного чата + правильного бота)
  try {
    const info = await pool.query(
      `SELECT 
          s.title,
          p.telegram_refused_chat_id,
          p.telegram_web_chat_id,
          p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       WHERE s.id = $1`,
      [rows[0].id]
    );

    const row = info.rows[0] || {};
    const refusedChatId = row.telegram_refused_chat_id || null;
    const fallbackChatId = row.telegram_web_chat_id || row.telegram_chat_id || null;

    const chatId = refusedChatId || fallbackChatId;

    // если используем telegram_refused_chat_id — это чат нового (client/refused) бота
    const tokenOverride = refusedChatId
      ? (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim() || null
      : null;

    if (chatId) {
      const text = `✅ Ваша услуга одобрена и опубликована\n\n📌 ${row.title || ""}`;
      tokenOverride ? await tgSend(chatId, text, {}, tokenOverride) : await tgSend(chatId, text, {});
    }
  } catch (e) {
    console.error("[admin approve] tg notify failed:", e?.message || e);
  }

  // TG → всем: уведомление о новом отказе/авторском туре после одобрения.
  // Вынесено в hardened utility:
  // - берёт только chat_id нового refused/client-бота;
  // - не подмешивает provider.telegram_web_chat_id старого бота;
  // - если sendPhoto не проходит, делает fallback на текст;
  // - считает реальную доставку, а не fulfilled Promise с false.
  let broadcastResult = null;
  try {
    broadcastResult = await broadcastApprovedService(rows[0].id, { db: pool });
    console.log("[admin approve] service approval broadcast result:", broadcastResult);
  } catch (e) {
    broadcastResult = { ok: false, reason: "BROADCAST_EXCEPTION", error: e?.message || String(e) };
    console.error("[admin approve] broadcast failed:", e?.message || e);
  }

  await logServiceModerationEvent(pool, {
    serviceId: rows[0].id,
    actorId: adminId,
    actorRole: "admin",
    action: broadcastResult?.ok ? "telegram_sent" : "telegram_failed",
    reasonCode: broadcastResult?.reason || null,
    reason: broadcastResult?.ok
      ? `Telegram broadcast delivered: ${broadcastResult.delivered || 0}/${broadcastResult.recipients || 0}`
      : `Telegram broadcast failed: ${broadcastResult?.reason || broadcastResult?.error || "unknown"}`,
    before: rows[0],
    after: rows[0],
    meta: { broadcast: broadcastResult },
  });

  res.json({ ok: true, service: rows[0], broadcast: broadcastResult });
});

// repeat Telegram broadcast for already published service
router.post("/services/:id(\\d+)/rebroadcast", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const serviceId = Number(req.params.id);

  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad service id" });
  }

  let broadcastResult = null;
  try {
    broadcastResult = await broadcastApprovedService(serviceId, {
      db: pool,
      logPrefix: "[admin rebroadcast]",
    });
  } catch (e) {
    broadcastResult = { ok: false, reason: "BROADCAST_EXCEPTION", error: e?.message || String(e) };
    console.error("[admin rebroadcast] failed:", e?.message || e);
  }

  await logServiceModerationEvent(pool, {
    serviceId,
    actorId: adminId,
    actorRole: "admin",
    action: broadcastResult?.ok ? "telegram_sent" : "telegram_failed",
    reasonCode: broadcastResult?.reason || null,
    reason: broadcastResult?.ok
      ? `Telegram rebroadcast delivered: ${broadcastResult.delivered || 0}/${broadcastResult.recipients || 0}`
      : `Telegram rebroadcast failed: ${broadcastResult?.reason || broadcastResult?.error || "unknown"}`,
    before: { id: serviceId },
    after: { id: serviceId },
    meta: { broadcast: broadcastResult, repeat: true },
  });

  res.json({ ok: Boolean(broadcastResult?.ok), broadcast: broadcastResult });
});

// reject / request correction (только для pending)
router.post("/services/:id(\\d+)/reject", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const body = req.body || {};
  const reason = String(body.reason || "").trim();
  const reasonCode = String(body.reasonCode || body.reason_code || "OTHER").trim().toUpperCase();

  if (reason.length < 5) {
    return res.status(400).json({ message: "Reason is required", code: "REJECT_REASON_REQUIRED" });
  }

  let rows;
  let db;
  try {
    const reasonCodes = normalizeReasonCodes(body.reasonCodes,reasonCode);
    if (reason.length>4000) return res.status(400).json({message:"Сообщение должно быть не длиннее 4000 символов"});
    await ensureServiceModerationEvents(pool);
    db = await pool.connect();
    await db.query("BEGIN");
    const beforeRes = await db.query(`SELECT s.*, to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[req.params.id]);
    const before = beforeRes.rows[0];
    if (!before || (before.moderation_status || before.status)!=='pending') throw Object.assign(new Error("Исправления можно запросить только для услуги на модерации"),{status:409});
    if (body.expected_edit_version && body.expected_edit_version!==before.edit_version) throw Object.assign(new Error("Услуга изменилась. Откройте её повторно."),{status:409});
    const updated = await db.query(`UPDATE services SET moderation_status='rejected',status='rejected',rejected_at=NOW(),rejected_by=$2,rejected_reason=$3,
      details=COALESCE(details,'{}'::jsonb) || jsonb_build_object('meta',COALESCE(details->'meta','{}'::jsonb) || jsonb_build_object('moderation_rejection_code',$4::text,'moderation_rejection_codes',$5::jsonb,'moderation_rejected_at',NOW())),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,adminId,reason,reasonCodes[0],JSON.stringify(reasonCodes)]);
    rows = updated.rows;
    await db.query(`INSERT INTO service_moderation_events (service_id,actor_id,actor_role,action,reason_code,reason,from_status,to_status,from_moderation_status,to_moderation_status,meta)
      VALUES ($1,$2,'admin','correction_requested',$3,$4,$5,'rejected',$6,'rejected',$7::jsonb)`,[before.id,adminId,reasonCodes[0],reason,before.status,before.moderation_status,JSON.stringify({correction:{reasonCodes,snapshot:correctionSnapshot(before)}})]);
    await db.query("COMMIT");
  } catch(error) {
    if (db) await db.query("ROLLBACK");
    return res.status(error.status || 500).json({message:error.status ? error.message : "Не удалось запросить исправление"});
  } finally { db?.release(); }

  // TG → поставщику (выбор правильного чата + правильного бота)
  let notificationSent=false;
  let notificationAvailable=false;
  try {
    const info = await pool.query(
      `SELECT 
          s.title,
          p.telegram_refused_chat_id,
          p.telegram_web_chat_id,
          p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       WHERE s.id = $1`,
      [rows[0].id]
    );

    const row = info.rows[0] || {};
    const refusedChatId = row.telegram_refused_chat_id || null;
    const fallbackChatId = row.telegram_web_chat_id || row.telegram_chat_id || null;

    const chatId = refusedChatId || fallbackChatId;
    const tokenOverride = refusedChatId
      ? ((process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim() ||
          (process.env.TELEGRAM_BOT_TOKEN || "").trim() ||
          null)
      : null;

    if (chatId) {
      notificationAvailable=true;
      for (const part of correctionNotificationParts(row.title,reason)) await tgSend(chatId,part,{parse_mode:undefined},tokenOverride || "",true);
      notificationSent=true;
    }
  } catch (e) {
    console.error("[admin reject] tg notify failed:", e?.message || e);
  }

  res.json({ ok: true, service: rows[0], notification:{sent:notificationSent,available:notificationAvailable} });
});

// снять с публикации
router.post("/services/:id(\\d+)/unpublish", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { rows } = await pool.query(
    `UPDATE services
        SET status         = 'archived',
            published_at   = NULL,
            unpublished_at = NOW(),
            unpublished_by = $2,
            updated_at     = NOW()
      WHERE id = $1 AND status = 'published'
      RETURNING id, status, unpublished_at, unpublished_by`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in published" });

  notifyModerationUnpublished({ service: rows[0].id }).catch(() => {});
  res.json({ ok: true, service: rows[0] });
});

// DELETE /api/admin/leads/:id  (жесткое удаление: lead + client/provider + хвосты)
router.delete("/leads/:id(\\d+)", authenticateToken, requireAdmin, leadController.deleteLeadFully);

/* ===================== RESET endpoints (совместимо с фронтом Leads.jsx) ===================== */

// POST /api/admin/reset-provider
router.post("/reset-provider", authenticateToken, requireAdmin, async (req, res) => {
  const leadId = Number(req.body?.leadId);
  if (!Number.isFinite(leadId)) {
    return res.status(400).json({ ok: false, message: "bad leadId" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(`SELECT * FROM leads WHERE id=$1 FOR UPDATE`, [leadId]);
    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "lead_not_found" });
    }

    const lead = leadRes.rows[0];
    const digits = phoneToDigits(lead.phone);

    const delProv = await db.query(
      `DELETE FROM providers
        WHERE regexp_replace(phone,'\\D','','g') = $1
        RETURNING id`,
      [digits]
    );

    await db.query(
      `UPDATE leads
          SET decision = NULL,
              decided_at = NULL,
              status = 'new'
        WHERE id = $1`,
      [leadId]
    );

    await db.query("COMMIT");

    return res.json({
      ok: true,
      providerFound: delProv.rowCount > 0,
      providerId: delProv.rows?.[0]?.id ?? null,
      leadReset: true,
    });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("[admin reset-provider] error:", e);
    return res.status(500).json({ ok: false, message: "reset_failed" });
  } finally {
    db.release();
  }
});

// POST /api/admin/reset-client
router.post("/reset-client", authenticateToken, requireAdmin, async (req, res) => {
  const leadId = Number(req.body?.leadId);
  if (!Number.isFinite(leadId)) {
    return res.status(400).json({ ok: false, message: "bad leadId" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(`SELECT * FROM leads WHERE id=$1 FOR UPDATE`, [leadId]);
    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "lead_not_found" });
    }

    const lead = leadRes.rows[0];
    const digits = phoneToDigits(lead.phone);

    const delClient = await db.query(
      `DELETE FROM clients
        WHERE regexp_replace(phone,'\\D','','g') = $1
        RETURNING id`,
      [digits]
    );

    await db.query(
      `UPDATE leads
          SET decision = NULL,
              decided_at = NULL,
              status = 'new'
        WHERE id = $1`,
      [leadId]
    );

    await db.query("COMMIT");

    return res.json({
      ok: true,
      clientFound: delClient.rowCount > 0,
      clientId: delClient.rows?.[0]?.id ?? null,
      leadReset: true,
    });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("[admin reset-client] error:", e);
    return res.status(500).json({ ok: false, message: "reset_failed" });
  } finally {
    db.release();
  }
});

/* --- Change provider password (admin only) --- */
router.patch("/providers/:id(\\d+)/password", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Bad provider id" });
  }
  if (typeof password !== "string" || password.trim().length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 chars" });
  }

  try {
    const q = `
      UPDATE public.providers
         SET password  = $1,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email
    `;
    const { rows } = await pool.query(q, [password.trim(), id]);
    if (!rows.length) {
      return res.status(404).json({ message: "Provider not found" });
    }

    return res.json({ ok: true, provider: rows[0] });
  } catch (e) {
    console.error("admin change password error:", e);
    return res.status(500).json({ message: "Internal error" });
  }
});

module.exports = router;
