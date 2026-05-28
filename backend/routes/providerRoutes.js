// backend/routes/providerRoutes.js
const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  restoreService,
  purgeService,
  serviceAction,
  updateServiceImagesOnly,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
  getProviderPublicById,
  searchProvidersPublic,
  availableProvidersPublic,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
  listProviderServices,
  createProviderService,
  patchProviderService,
  bulkCreateProviderServices,
  deleteProviderService,
  getProviderServicesPublic,

  // ✅ TRASH (корзина)
  getProviderDeletedServices,
  restoreProviderService,
  purgeProviderService,
} = require("../controllers/providerController");

const {
  loginProviderWithTelegram,
} = require("../controllers/providerTelegramAuthController");

const { notifyModerationNew } = require("../utils/telegram");
const { logProviderServiceAction } = require("../utils/serviceAuditLog");
const { applyServiceLifecycleAction } = require("../utils/serviceLifecycle");

function requireProvider(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  if (req.user.role && req.user.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

/* -------------------- PUBLIC SEARCH / AVAILABLE -------------------- */

router.get("/search", searchProvidersPublic);
router.get("/available", availableProvidersPublic);

/* -------------------- AUTH / PROFILE / SERVICES / CALENDAR -------------------- */

router.post("/register", registerProvider);
router.post("/login", loginProvider);
router.post("/telegram-login", loginProviderWithTelegram);

router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

router.get("/stats", authenticateToken, requireProvider, getProviderStats);


router.get("/finance", authenticateToken, requireProvider, async (req, res) => {
  const providerId = Number(req.user.id);
  if (!Number.isFinite(providerId) || providerId <= 0) {
    return res.status(401).json({ ok: false, message: "Требуется авторизация поставщика" });
  }

  async function hasTable(name) {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [name]
    );
    return !!r.rowCount;
  }

  const toSum = (v) => Math.round(Number(v || 0) / 100);

  try {
    const unlocksQ = await pool.query(
      `
      SELECT
        u.id,
        u.client_id,
        u.service_id,
        u.price_charged,
        FLOOR(COALESCE(u.price_charged, 0) / 100)::bigint AS price_sum,
        u.source,
        u.created_at,
        COALESCE(c.name, c.full_name, c.phone, 'Client #' || u.client_id::text) AS client_name,
        c.phone AS client_phone,
        c.telegram AS client_telegram,
        s.title AS service_title,
        s.category AS service_category
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.provider_id = $1
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 50
      `,
      [providerId]
    );

    const statsQ = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS unlock_count,
        COALESCE(SUM(COALESCE(u.price_charged, 0)), 0)::bigint AS unlock_amount_tiyin,
        FLOOR(COALESCE(SUM(COALESCE(u.price_charged, 0)), 0) / 100)::bigint AS unlock_amount_sum
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      WHERE s.provider_id = $1
      `,
      [providerId]
    );

    let telegramPayments = [];
    let telegramStats = { telegram_paid_count: 0, telegram_paid_sum: 0 };
    if (await hasTable("telegram_payments")) {
      const tgQ = await pool.query(
        `
        SELECT
          tp.id,
          tp.payment_type,
          tp.client_id,
          tp.service_id,
          tp.status,
          tp.source,
          tp.currency,
          tp.amount_minor,
          COALESCE(tp.amount_sum, FLOOR(COALESCE(tp.amount_minor,0) / 100))::bigint AS amount_sum,
          tp.telegram_payment_charge_id,
          tp.provider_payment_charge_id,
          tp.created_at,
          s.title AS title,
          s.category AS service_category
        FROM telegram_payments tp
        JOIN services s ON s.id = tp.service_id
        WHERE s.provider_id = $1
        ORDER BY tp.created_at DESC, tp.id DESC
        LIMIT 50
        `,
        [providerId]
      );
      telegramPayments = tgQ.rows || [];

      const tgStatsQ = await pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE tp.status IN ('paid','success','completed','unlocked'))::bigint AS telegram_paid_count,
          COALESCE(SUM(CASE WHEN tp.status IN ('paid','success','completed','unlocked') THEN COALESCE(tp.amount_sum, FLOOR(COALESCE(tp.amount_minor,0) / 100)) ELSE 0 END),0)::bigint AS telegram_paid_sum
        FROM telegram_payments tp
        JOIN services s ON s.id = tp.service_id
        WHERE s.provider_id = $1
        `,
        [providerId]
      );
      telegramStats = tgStatsQ.rows?.[0] || telegramStats;
    }

    let supportDonations = [];
    let supportStats = { support_paid_count: 0, support_paid_sum: 0 };
    if (await hasTable("provider_support_donations")) {
      const supportQ = await pool.query(
        `
        SELECT
          d.id,
          d.provider_id,
          d.service_id,
          d.status,
          d.source,
          d.payme_id,
          d.payme_order_id,
          d.amount_tiyin,
          FLOOR(COALESCE(d.amount_tiyin,0) / 100)::bigint AS amount_sum,
          d.created_at,
          d.paid_at,
          COALESCE(s.title, 'Поддержка проекта') AS title
        FROM provider_support_donations d
        LEFT JOIN services s ON s.id = d.service_id
        WHERE d.provider_id = $1
           OR s.provider_id = $1
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT 50
        `,
        [providerId]
      );
      supportDonations = supportQ.rows || [];

      const supportStatsQ = await pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE d.status = 'paid')::bigint AS support_paid_count,
          FLOOR(COALESCE(SUM(CASE WHEN d.status = 'paid' THEN d.amount_tiyin ELSE 0 END),0) / 100)::bigint AS support_paid_sum
        FROM provider_support_donations d
        LEFT JOIN services s ON s.id = d.service_id
        WHERE d.provider_id = $1
           OR s.provider_id = $1
        `,
        [providerId]
      );
      supportStats = supportStatsQ.rows?.[0] || supportStats;
    }

    const baseStats = statsQ.rows?.[0] || {};
    return res.json({
      ok: true,
      provider_id: providerId,
      stats: {
        unlock_count: Number(baseStats.unlock_count || 0),
        unlock_amount_tiyin: Number(baseStats.unlock_amount_tiyin || 0),
        unlock_amount_sum: Number(baseStats.unlock_amount_sum || 0),
        telegram_paid_count: Number(telegramStats.telegram_paid_count || 0),
        telegram_paid_sum: Number(telegramStats.telegram_paid_sum || 0),
        support_paid_count: Number(supportStats.support_paid_count || 0),
        support_paid_sum: Number(supportStats.support_paid_sum || 0),
      },
      recent_unlocks: unlocksQ.rows || [],
      telegram_payments: telegramPayments,
      support_donations: supportDonations,
    });
  } catch (e) {
    console.error("providers/finance error:", e);
    return res.status(500).json({ ok: false, message: "provider finance error" });
  }
});


router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.post("/services/:id/restore", authenticateToken, requireProvider, restoreService);
router.delete("/services/:id/purge", authenticateToken, requireProvider, purgeService);
router.post("/services/:id/action", authenticateToken, requireProvider, serviceAction);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

/* -------------------- PROVIDER SERVICES (каскад в профиле) -------------------- */
// Важно: ставим ДО маршрута "/:id(\\d+)", чтобы порядок не мешал.
// Публичный просмотр каскадных услуг провайдера (только активные; включает vehicle_model)
router.get("/:providerId(\\d+)/services/public", getProviderServicesPublic);

router.get("/:providerId(\\d+)/services", authenticateToken, requireProvider, listProviderServices);
router.post("/:providerId(\\d+)/services", authenticateToken, requireProvider, createProviderService);
router.patch("/:providerId(\\d+)/services/:id(\\d+)", authenticateToken, requireProvider, patchProviderService);
router.post("/:providerId(\\d+)/services/bulk", authenticateToken, requireProvider, bulkCreateProviderServices);
router.delete("/:providerId(\\d+)/services/:id(\\d+)", authenticateToken, requireProvider, deleteProviderService);

/* -------------------- ✅ TRASH / корзина (каскадные услуги) -------------------- */
router.get("/:providerId(\\d+)/services/deleted", authenticateToken, requireProvider, getProviderDeletedServices);
router.post("/:providerId(\\d+)/services/:id(\\d+)/restore", authenticateToken, requireProvider, restoreProviderService);
router.delete("/:providerId(\\d+)/services/:id(\\d+)/purge", authenticateToken, requireProvider, purgeProviderService);

router.get("/booked-dates", authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

router.get("/booked-details", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `
        SELECT
           bd.date::text AS date,
           COALESCE(rp.name, c.name)   AS name,
           COALESCE(rp.phone, c.phone) AS phone,
           CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
           CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
           COALESCE(rp.id, c.id) AS "profileId",
           CASE
             WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
             ELSE '/profile/client/'   || c.id
           END AS "profileUrl"
        FROM booking_dates bd
        JOIN bookings b   ON b.id = bd.booking_id
        LEFT JOIN clients   c  ON c.id = b.client_id
        LEFT JOIN providers rp ON rp.id = b.requester_provider_id
        WHERE b.provider_id = $1
          AND b.status IN ('confirmed','active')
          AND bd.date >= CURRENT_DATE
        ORDER BY bd.date, name
      `,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error("providers/booked-details error:", e);
    res.status(500).json({ message: "booked-details error" });
  }
});

router.get("/calendar", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const [booked, blocked, details] = await Promise.all([
      pool.query(
        `
          SELECT DISTINCT bd.date::text AS date
          FROM booking_dates bd
          JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY 1
        `,
        [providerId]
      ),
      pool.query(
        `
          SELECT date::text AS date
          FROM provider_blocked_dates
          WHERE provider_id = $1
          ORDER BY 1
        `,
        [providerId]
      ),
      pool.query(
        `
          SELECT
             bd.date::text AS date,
             COALESCE(rp.name, c.name)   AS name,
             COALESCE(rp.phone, c.phone) AS phone,
             CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
             CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
             COALESCE(rp.id, c.id) AS "profileId",
             CASE
               WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
               ELSE '/profile/client/' || c.id
             END AS "profileUrl"
          FROM booking_dates bd
          JOIN bookings b   ON b.id = bd.booking_id
          LEFT JOIN clients   c  ON c.id = b.client_id
          LEFT JOIN providers rp ON rp.id = b.requester_provider_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY bd.date, name
        `,
        [providerId]
      ),
    ]);
    res.json({
      booked: booked.rows,
      blocked: blocked.rows,
      bookedDetails: details.rows,
    });
  } catch (e) {
    console.error("providers/calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});

router.get("/:providerId(\\d+)/calendar", getCalendarPublic);

/* -------------------- FAVORITES -------------------- */

router.get("/favorites", authenticateToken, requireProvider, listProviderFavorites);
router.post("/favorites/toggle", authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

/* -------------------- SUBMIT SERVICE TO MODERATION -------------------- */

router.post(
  "/services/:id/submit",
  authenticateToken,
  requireProvider,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const applied = await applyServiceLifecycleAction(pool, {
        providerId: req.user.id,
        serviceId: id,
        action: "submit",
      });

      await logProviderServiceAction({
        req,
        action: "service_submitted",
        providerId: req.user.id,
        serviceId: id,
        oldService: applied.before,
        newService: applied.service,
        meta: { submitted_to_moderation: true },
      });

      try {
        await notifyModerationNew({ service: id });
      } catch {}

      return res.json({ ok: true, service: applied.service });
    } catch (e) {
      if (e?.code === "PROOF_IMAGES_REQUIRED") {
        return res.status(400).json({
          message: "Before sending to moderation, upload screenshots confirming the authenticity of the booking/ticket.",
          code: "PROOF_IMAGES_REQUIRED",
        });
      }

      if (e?.code === "SERVICE_NOT_SUBMITTABLE") {
        return res.status(409).json({
          message: "Service must be in draft/rejected (or empty status) to submit",
          code: e.code,
        });
      }

      return next(e);
    }
  }
);

router.get("/:id(\\d+)", getProviderPublicById);

/* -------------------- HOTELS -------------------- */
router.get("/me", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query("SELECT id FROM hotels WHERE provider_id=$1 LIMIT 1", [providerId]);
    return res.json({
      id: providerId,
      hotel_id: q.rows?.[0]?.id || null,
    });
  } catch (e) {
    console.error("providers/me error:", e);
    res.status(500).json({ message: "me error" });
  }
});

module.exports = router;
