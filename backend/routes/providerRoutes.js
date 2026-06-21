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
const { logProviderFunnelEvent } = require("../utils/providerFunnel");
const { buildRefusedQuality } = require("../utils/refusedQuality");

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

  const period = String(req.query.period || "30d").trim();
  const serviceId = Number(req.query.service_id || 0);
  const hasServiceFilter = Number.isFinite(serviceId) && serviceId > 0;

  function periodSql(alias = "u") {
    if (period === "today") return ` AND ${alias}.created_at >= date_trunc('day', NOW()) `;
    if (period === "7d") return ` AND ${alias}.created_at >= NOW() - INTERVAL '7 days' `;
    if (period === "30d") return ` AND ${alias}.created_at >= NOW() - INTERVAL '30 days' `;
    return "";
  }

  async function hasTable(name) {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [name]
    );
    return !!r.rowCount;
  }

  async function hasColumns(table, columns) {
    const r = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=$1
        AND column_name = ANY($2::text[])
      `,
      [table, columns]
    );
    return new Set((r.rows || []).map((x) => x.column_name));
  }

  async function ensureLeadCrmTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_lead_crm (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL,
        client_id BIGINT,
        service_id BIGINT,
        status TEXT NOT NULL DEFAULT 'new',
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider_id, client_id, service_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_provider ON provider_lead_crm(provider_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_client ON provider_lead_crm(client_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_service ON provider_lead_crm(service_id)`);
  }

  try {
    await ensureLeadCrmTable();

    const clientsCols = await hasColumns("clients", ["name", "full_name", "phone", "telegram", "telegram_username", "username", "first_name", "last_name"]);
    const unlockCols = await hasColumns("client_service_contact_unlocks", ["id", "client_id", "service_id", "source", "created_at", "price_charged"]);

    const clientNameParts = [];
    if (clientsCols.has("name")) clientNameParts.push("NULLIF(c.name, '')");
    if (clientsCols.has("full_name")) clientNameParts.push("NULLIF(c.full_name, '')");
    if (clientsCols.has("first_name") || clientsCols.has("last_name")) {
      const first = clientsCols.has("first_name") ? "COALESCE(c.first_name,'')" : "''";
      const last = clientsCols.has("last_name") ? "COALESCE(c.last_name,'')" : "''";
      clientNameParts.push(`NULLIF(TRIM(${first} || ' ' || ${last}), '')`);
    }
    if (clientsCols.has("phone")) clientNameParts.push("NULLIF(c.phone, '')");
    const clientNameExpr = `COALESCE(${clientNameParts.length ? clientNameParts.join(", ") + ", " : ""}'Client #' || u.client_id::text)`;
    const clientPhoneExpr = clientsCols.has("phone") ? "c.phone" : "NULL::text";
    const clientTelegramExpr = clientsCols.has("telegram")
      ? "c.telegram"
      : clientsCols.has("telegram_username")
        ? "c.telegram_username"
        : clientsCols.has("username")
          ? "c.username"
          : "NULL::text";
    const unlockSourceExpr = unlockCols.has("source") ? "u.source" : "'telegram_payment'::text";
    const unlockCreatedExpr = unlockCols.has("created_at") ? "u.created_at" : "NOW()";

    const unlockWhereExtra = `${periodSql("u")} ${hasServiceFilter ? " AND s.id = $2 " : ""}`;
    const params = hasServiceFilter ? [providerId, serviceId] : [providerId];

    const unlocksQ = await pool.query(
      `
      SELECT
        u.id,
        u.client_id,
        u.service_id,
        ${unlockSourceExpr} AS source,
        ${unlockCreatedExpr} AS created_at,
        ${clientNameExpr} AS client_name,
        ${clientPhoneExpr} AS client_phone,
        ${clientTelegramExpr} AS client_telegram,
        s.title AS service_title,
        s.category AS service_category,
        COALESCE(l.status, 'new') AS lead_status,
        l.note AS lead_note
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN clients c ON c.id = u.client_id
      LEFT JOIN provider_lead_crm l
        ON l.provider_id = s.provider_id
       AND l.client_id = u.client_id
       AND l.service_id = u.service_id
      WHERE s.provider_id = $1
        ${unlockWhereExtra}
      ORDER BY ${unlockCreatedExpr} DESC, u.id DESC
      LIMIT 80
      `,
      params
    );

    const statsQ = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS unlock_count,
        COUNT(DISTINCT u.client_id)::bigint AS hot_clients_count
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      WHERE s.provider_id = $1
        ${unlockWhereExtra}
      `,
      params
    );

    const hotClientsQ = await pool.query(
      `
      SELECT
        u.client_id,
        ${clientNameExpr} AS client_name,
        ${clientPhoneExpr} AS client_phone,
        ${clientTelegramExpr} AS client_telegram,
        COUNT(*)::bigint AS unlock_count,
        MAX(${unlockCreatedExpr}) AS last_activity_at,
        (ARRAY_AGG(s.title ORDER BY ${unlockCreatedExpr} DESC, u.id DESC))[1] AS last_service_title,
        (ARRAY_AGG(s.id ORDER BY ${unlockCreatedExpr} DESC, u.id DESC))[1] AS last_service_id,
        COALESCE((ARRAY_AGG(l.status ORDER BY l.updated_at DESC NULLS LAST))[1], 'new') AS lead_status,
        (ARRAY_AGG(l.note ORDER BY l.updated_at DESC NULLS LAST))[1] AS lead_note
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN clients c ON c.id = u.client_id
      LEFT JOIN provider_lead_crm l
        ON l.provider_id = s.provider_id
       AND l.client_id = u.client_id
       AND l.service_id = u.service_id
      WHERE s.provider_id = $1
        ${unlockWhereExtra}
      GROUP BY u.client_id, ${clientPhoneExpr}, ${clientTelegramExpr}, ${clientNameExpr}
      ORDER BY COUNT(*) DESC, MAX(${unlockCreatedExpr}) DESC
      LIMIT 30
      `,
      params
    );

    let viewsCount = 0;
    let favoriteCount = 0;
    const viewsByService = new Map();
    const favoritesByService = new Map();

    if (await hasTable("service_views")) {
      const cols = await hasColumns("service_views", ["service_id", "created_at"]);
      if (cols.has("service_id")) {
        const viewsWhereExtra = `${cols.has("created_at") ? periodSql("v") : ""} ${hasServiceFilter ? " AND s.id = $2 " : ""}`;
        const viewsQ = await pool.query(
          `
          SELECT COUNT(*)::bigint AS views_count
          FROM service_views v
          JOIN services s ON s.id = v.service_id
          WHERE s.provider_id = $1
            ${viewsWhereExtra}
          `,
          params
        );
        viewsCount = Number(viewsQ.rows?.[0]?.views_count || 0);

        const viewsByServiceQ = await pool.query(
          `
          SELECT v.service_id, COUNT(*)::bigint AS views_count
          FROM service_views v
          JOIN services s ON s.id = v.service_id
          WHERE s.provider_id = $1
            ${viewsWhereExtra}
          GROUP BY v.service_id
          `,
          params
        );
        for (const row of viewsByServiceQ.rows || []) viewsByService.set(Number(row.service_id), Number(row.views_count || 0));
      }
    }

    if (await hasTable("wishlist")) {
      const cols = await hasColumns("wishlist", ["service_id", "created_at"]);
      if (cols.has("service_id")) {
        const favWhereExtra = `${cols.has("created_at") ? periodSql("w") : ""} ${hasServiceFilter ? " AND s.id = $2 " : ""}`;
        const favQ = await pool.query(
          `
          SELECT COUNT(*)::bigint AS favorite_count
          FROM wishlist w
          JOIN services s ON s.id = w.service_id
          WHERE s.provider_id = $1
            ${favWhereExtra}
          `,
          params
        );
        favoriteCount = Number(favQ.rows?.[0]?.favorite_count || 0);

        const favByServiceQ = await pool.query(
          `
          SELECT w.service_id, COUNT(*)::bigint AS favorite_count
          FROM wishlist w
          JOIN services s ON s.id = w.service_id
          WHERE s.provider_id = $1
            ${favWhereExtra}
          GROUP BY w.service_id
          `,
          params
        );
        for (const row of favByServiceQ.rows || []) favoritesByService.set(Number(row.service_id), Number(row.favorite_count || 0));
      }
    }

    let quickRequests = [];
    const quickByService = new Map();

    async function loadQuickRequestsFrom(table) {
      if (!(await hasTable(table))) return [];
      const cols = await hasColumns(table, [
        "id", "service_id", "client_id", "name", "client_name", "message", "status", "created_at",
        "requester_chat_id", "username", "first_name", "last_name", "provider_id"
      ]);
      if (!cols.has("service_id")) return [];

      const idExpr = cols.has("id") ? "qr.id" : "NULL::bigint";
      const clientIdExpr = cols.has("client_id") ? "qr.client_id" : "NULL::bigint";
      const nameExpr = cols.has("client_name")
        ? "qr.client_name"
        : cols.has("name")
          ? "qr.name"
          : cols.has("first_name") || cols.has("last_name")
            ? `NULLIF(TRIM(${cols.has("first_name") ? "COALESCE(qr.first_name,'')" : "''"} || ' ' || ${cols.has("last_name") ? "COALESCE(qr.last_name,'')" : "''"}), '')`
            : cols.has("requester_chat_id")
              ? "'TG #' || qr.requester_chat_id::text"
              : "NULL::text";
      const messageExpr = cols.has("message") ? "qr.message" : "NULL::text";
      const statusExpr = cols.has("status") ? "qr.status" : "'new'::text";
      const createdExpr = cols.has("created_at") ? "qr.created_at" : "NOW()";
      const sourceExpr = table === "telegram_quick_requests" ? "'telegram'::text" : "'site'::text";
      const quickWhereExtra = `${cols.has("created_at") ? periodSql("qr") : ""} ${hasServiceFilter ? " AND s.id = $2 " : ""}`;

      const quickQ = await pool.query(
        `
        SELECT
          ${idExpr} AS id,
          ${clientIdExpr} AS client_id,
          qr.service_id,
          ${nameExpr} AS client_name,
          ${messageExpr} AS message,
          ${statusExpr} AS status,
          ${createdExpr} AS created_at,
          ${sourceExpr} AS source,
          s.title AS service_title,
          s.category AS service_category
        FROM ${table} qr
        JOIN services s ON s.id = qr.service_id
        WHERE s.provider_id = $1
          ${quickWhereExtra}
        ORDER BY ${createdExpr} DESC
        LIMIT 40
        `,
        params
      );
      return quickQ.rows || [];
    }

    const qr1 = await loadQuickRequestsFrom("quick_requests");
    const qr2 = await loadQuickRequestsFrom("telegram_quick_requests");
    quickRequests = [...qr1, ...qr2]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 40);
    for (const row of quickRequests) {
      const sid = Number(row.service_id);
      if (Number.isFinite(sid)) quickByService.set(sid, (quickByService.get(sid) || 0) + 1);
    }

    const topServicesQ = await pool.query(
      `
      SELECT
        s.id AS service_id,
        s.title AS service_title,
        s.category AS service_category,
        COUNT(u.id)::bigint AS unlock_count,
        MAX(${unlockCreatedExpr}) AS last_unlock_at
      FROM services s
      LEFT JOIN client_service_contact_unlocks u ON u.service_id = s.id ${periodSql("u")}
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
        ${hasServiceFilter ? " AND s.id = $2 " : ""}
      GROUP BY s.id, s.title, s.category
      ORDER BY COUNT(u.id) DESC, MAX(${unlockCreatedExpr}) DESC NULLS LAST, s.id DESC
      LIMIT 20
      `,
      params
    );

    const topServices = (topServicesQ.rows || []).map((row) => {
      const sid = Number(row.service_id);
      const unlockCount = Number(row.unlock_count || 0);
      const views = viewsByService.get(sid) || 0;
      const favorites = favoritesByService.get(sid) || 0;
      const quick = quickByService.get(sid) || 0;
      return {
        ...row,
        unlock_count: unlockCount,
        views_count: views,
        favorite_count: favorites,
        quick_requests_count: quick,
        demand_score: unlockCount * 6 + quick * 4 + favorites * 2 + views,
      };
    }).sort((a, b) => Number(b.demand_score || 0) - Number(a.demand_score || 0));

    const servicesQ = await pool.query(
      `
      SELECT id, title, category
      FROM services
      WHERE provider_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 200
      `,
      [providerId]
    );

    const baseStats = statsQ.rows?.[0] || {};
    return res.json({
      ok: true,
      provider_id: providerId,
      filters: { period, service_id: hasServiceFilter ? serviceId : null },
      stats: {
        unlock_count: Number(baseStats.unlock_count || 0),
        hot_clients_count: Number(baseStats.hot_clients_count || 0),
        views_count: Number(viewsCount || 0),
        favorite_count: Number(favoriteCount || 0),
        quick_requests_count: quickRequests.length,
        new_leads_count: (unlocksQ.rows || []).filter((x) => String(x.lead_status || "new") === "new").length,
      },
      recent_unlocks: unlocksQ.rows || [],
      hot_clients: hotClientsQ.rows || [],
      top_services: topServices,
      quick_requests: quickRequests,
      services: servicesQ.rows || [],
    });
  } catch (e) {
    console.error("providers/finance demand dashboard error:", e);
    return res.status(500).json({ ok: false, message: "provider demand dashboard error" });
  }
});

router.post("/finance/leads/status", authenticateToken, requireProvider, async (req, res) => {
  const providerId = Number(req.user.id);
  const clientId = Number(req.body?.client_id || 0);
  const serviceId = Number(req.body?.service_id || 0);
  const status = String(req.body?.status || "new").trim();
  const allowed = new Set(["new", "contacted", "in_progress", "closed", "not_relevant"]);
  if (!allowed.has(status)) return res.status(400).json({ ok: false, message: "Некорректный статус" });
  if (!Number.isFinite(clientId) || clientId <= 0) return res.status(400).json({ ok: false, message: "Некорректный клиент" });
  if (!Number.isFinite(serviceId) || serviceId <= 0) return res.status(400).json({ ok: false, message: "Некорректная услуга" });

  try {
    const own = await pool.query(`SELECT 1 FROM services WHERE id=$1 AND provider_id=$2 LIMIT 1`, [serviceId, providerId]);
    if (!own.rowCount) return res.status(404).json({ ok: false, message: "Услуга не найдена" });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_lead_crm (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL,
        client_id BIGINT,
        service_id BIGINT,
        status TEXT NOT NULL DEFAULT 'new',
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider_id, client_id, service_id)
      )
    `);
    const r = await pool.query(
      `
      INSERT INTO provider_lead_crm (provider_id, client_id, service_id, status, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (provider_id, client_id, service_id)
      DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
      RETURNING *
      `,
      [providerId, clientId, serviceId, status]
    );
    return res.json({ ok: true, lead: r.rows?.[0] || null });
  } catch (e) {
    console.error("providers/finance/leads/status error:", e);
    return res.status(500).json({ ok: false, message: "Не удалось сохранить статус" });
  }
});

router.post("/finance/leads/note", authenticateToken, requireProvider, async (req, res) => {
  const providerId = Number(req.user.id);
  const clientId = Number(req.body?.client_id || 0);
  const serviceId = Number(req.body?.service_id || 0);
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  if (!Number.isFinite(clientId) || clientId <= 0) return res.status(400).json({ ok: false, message: "Некорректный клиент" });
  if (!Number.isFinite(serviceId) || serviceId <= 0) return res.status(400).json({ ok: false, message: "Некорректная услуга" });

  try {
    const own = await pool.query(`SELECT 1 FROM services WHERE id=$1 AND provider_id=$2 LIMIT 1`, [serviceId, providerId]);
    if (!own.rowCount) return res.status(404).json({ ok: false, message: "Услуга не найдена" });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_lead_crm (
        id BIGSERIAL PRIMARY KEY,
        provider_id BIGINT NOT NULL,
        client_id BIGINT,
        service_id BIGINT,
        status TEXT NOT NULL DEFAULT 'new',
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider_id, client_id, service_id)
      )
    `);
    const r = await pool.query(
      `
      INSERT INTO provider_lead_crm (provider_id, client_id, service_id, note, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (provider_id, client_id, service_id)
      DO UPDATE SET note=EXCLUDED.note, updated_at=NOW()
      RETURNING *
      `,
      [providerId, clientId, serviceId, note]
    );
    return res.json({ ok: true, lead: r.rows?.[0] || null });
  } catch (e) {
    console.error("providers/finance/leads/note error:", e);
    return res.status(500).json({ ok: false, message: "Не удалось сохранить заметку" });
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

      await logProviderFunnelEvent({
        source: "web_provider_dashboard",
        actorRole: "provider",
        actorId: req.user.id,
        providerId: req.user.id,
        serviceId: id,
        category: applied?.service?.category || applied?.before?.category || null,
        eventName: "submitted_to_moderation",
        status: applied?.service?.status || "pending",
        meta: { submitted_to_moderation: true, route: "provider_submit" },
      });

      try {
        await notifyModerationNew({ service: id });
      } catch {}

      return res.json({ ok: true, service: applied.service, quality: buildRefusedQuality(applied.service) });
    } catch (e) {
      if (e?.code === "PROOF_IMAGES_REQUIRED" || e?.code === "SERVICE_SUBMIT_BLOCKED") {
        const labels = Array.isArray(e?.blockerDetails) ? e.blockerDetails.map((b) => b.label).filter(Boolean) : [];
        return res.status(400).json({
          message: labels.length
            ? `Перед отправкой на модерацию исправьте: ${labels.join("; ")}`
            : "Перед отправкой на модерацию заполните обязательные поля и загрузите proof.",
          code: e.code,
          blockers: e?.blockers || [],
          blockerDetails: e?.blockerDetails || [],
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
