// backend/index.js
const pool = require("./db");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { askActualReminder } = require("./jobs/askActualReminder");
const tbTemplatesRoutes = require("./routes/TBtemplatesRoutes");
const { getTelegramHealth } = require("./utils/telegram");
const path = require("path");
const adminDonasShiftRoutes = require("./routes/adminDonasShiftRoutes");
const adminDonasPurchasesRoutes = require("./routes/adminDonasPurchasesRoutes");
const adminDonasRecipeRoutes = require("./routes/adminDonasRecipeRoutes");
const adminDonasCogsRoutes = require("./routes/adminDonasCogsRoutes");
const adminDonasMenuItemsRoutes = require("./routes/adminDonasMenuItemsRoutes");
const adminDonasIngredientsRoutes = require("./routes/adminDonasIngredientsRoutes");
const donasPublicMenuRoutes = require("./routes/donasPublicMenuRoutes");
const adminDonasOpexRoutes = require("./routes/adminDonasOpexRoutes");
const adminDonasFinanceMonthsRoutes = require("./routes/adminDonasFinanceMonthsRoutes");
const adminDonasSalesRoutes = require("./routes/adminDonasSalesRoutes");

dotenv.config();

const app = express();

// Telegram health (passive) on boot — no network calls
getTelegramHealth({ probe: false })
  .then((h) => {
    const oldOk = h?.env?.has_old_bot_token ? "ON" : "OFF";
    const clientOk = h?.env?.has_client_bot_token ? "ON" : "OFF";
    const admins = h?.env?.admin_chat_ids_count ?? 0;
    console.log(
      `[tg-health] old:${oldOk} client:${clientOk} admins:${admins} tz:${h?.env?.tz || ""}`
    );
  })
  .catch((e) => console.warn("[tg-health] failed:", e?.message || e));

/** ===================== CORS (унифицированный) ===================== */
/**
 * 1) Базовый список (локалка, прод-варианты фронта)
 * 2) Плюс домены из ENV CORS_ORIGINS (через запятую, без пробелов)
 * 3) Поддержка превью на Vercel для проекта travella-fullstack
 */
const BASE_WHITELIST = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://travella.uz",
  "https://www.travella.uz",
  "https://india.travella.uz", // India Inside
  "https://travella-fullstack.vercel.app",
  "https://travella-fullstack-q0ayptios-komil.vercel.app", // превью из логов
  "https://travella-fullstack-8yle5am3l-komil.vercel.app", // старое превью
  process.env.FRONTEND_URL || "",
];

// добираем из ENV (если задано)
const ENV_WHITELIST = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const WHITELIST = new Set([...BASE_WHITELIST, ...ENV_WHITELIST]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/Postman/сервер-сервер

  try {
    const url = new URL(origin);
    const { hostname, protocol } = url;

    if (!/^https?:$/.test(protocol)) return false;

    // Точный матч
    if (WHITELIST.has(origin)) return true;

    // Любые превью Vercel для проекта "travella-fullstack"
    const isVercelPreview =
      hostname.endsWith(".vercel.app") &&
      (hostname === "travella-fullstack.vercel.app" ||
        hostname.startsWith("travella-fullstack-"));

    return isVercelPreview;
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, cb) {
    const ok = isAllowedOrigin(origin);
    if (ok) return cb(null, true);
    console.warn("CORS blocked:", origin);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

// ВАЖНО: CORS должен стоять ПЕРЕД ЛЮБЫМИ РОУТАМИ
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
/** ===================== /CORS ===================== */

/** ===================== Body ===================== */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ static для /api (в т.ч. /api/telegram/placeholder/*.png если нужно отдавать файлы из public)
app.use("/api", express.static(path.join(__dirname, "public")));

/** ===================== Routes (основные) ===================== */
const availabilityRoutes = require("./routes/availabilityRoutes");
app.use("/api/availability", availabilityRoutes);

const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);

const hotels = require("./controllers/hotelsController");
// app.get("/api/hotels/:id/inspections", hotels.listHotelInspections);
// app.post("/api/hotels/:id/inspections", hotels.createHotelInspection);
// app.post("/api/inspections/:id/like", hotels.likeInspection);

const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

const clientRoutes = require("./routes/clientRoutes");
app.use("/api/clients", clientRoutes);

const profileRoutes = require("./routes/profileRoutes");
app.use("/api/profile", profileRoutes);

// ✅ Dona's Dosas finance model (save/load versions)
const financeModelRoutes = require("./routes/financeModelRoutes");
app.use("/api/finance-models", financeModelRoutes);

/**
 * requestRoutes может экспортировать:
 * 1) только router  -> module.exports = router
 * 2) объект { router, cleanupExpiredRequests, purgeExpiredRequests }
 */
const _requestRoutes = require("./routes/requestRoutes");
const requestRouter = _requestRoutes.router || _requestRoutes; // express.Router
const cleanupExpiredFn =
  _requestRoutes.cleanupExpiredRequests || (async () => []); // no-op
const purgeExpiredFn =
  _requestRoutes.purgeExpiredRequests || (async () => []); // no-op

app.use("/api/requests", requestRouter);

const bookingRoutes = require("./routes/bookingRoutes");
app.use("/api/bookings", bookingRoutes);

const notificationsRoutes = require("./routes/notificationsRoutes");
app.use("/api/notifications", notificationsRoutes);

// NEW: wishlist (избранное)
const wishlistRoutes = require("./routes/wishlistRoutes");
app.use("/api/wishlist", wishlistRoutes);

// Reviews (отзывы)
const reviewRoutes = require("./routes/reviewRoutes");
app.use("/api/reviews", reviewRoutes);

// Лайки инспекций отелей
const hotelInspectionRoutes = require("./routes/hotelInspectionRoutes");
app.use("/api/hotel-inspections", hotelInspectionRoutes);

// Telegram webhook-роуты (СТАРЫЙ бот по токену TELEGRAM_BOT_TOKEN)
const telegramRoutes = require("./routes/telegramRoutes");
app.use("/api/telegram", express.json({ limit: "2mb" }), telegramRoutes);

// Языки
const metaRoutes = require("./routes/metaRoutes");
app.use("/api/meta", metaRoutes);

// Модерация админом
const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

// ✅ NEW: Admin reset tools (reset client/provider telegram binding, etc.)
const adminResetRoutes = require("./routes/adminResetRoutes");
app.use("/api/admin", adminResetRoutes);

// Секции маркетплейса
const marketplaceSectionsRoutes = require("./routes/marketplaceSectionsRoutes");
app.use("/api/marketplace/sections", marketplaceSectionsRoutes);

const moderationRoutes = require("./routes/moderationRoutes");
app.use("/api/moderation", moderationRoutes);

// Квота GeoNames
const monitorRoutes = require("./routes/monitorRoutes");
app.use("/api/monitor", monitorRoutes);

// Leads (лендинги: /tours, /ayurveda, /checkup, /treatment, /b2b, /contacts)
const leadRoutes = require("./routes/leadRoutes");
app.use("/api/leads", leadRoutes);

/** ===================== Debug ===================== */
const authenticateToken = require("./middleware/authenticateToken");
app.get("/api/_debug/whoami", authenticateToken, (req, res) =>
  res.json(req.user)
);

// ✅ Telegram health-check (protected by ADMIN_JOB_TOKEN)
try {
  const telegramHealthRoutes = require("./routes/telegramHealthRoutes");
  app.use("/api/_debug", telegramHealthRoutes);
} catch (e) {
  console.warn("[tg-health] routes not mounted:", e?.message || e);
}

/** ===================== Aliases (Back-compat) ===================== */
app.post(
  "/api/providers/cleanup-expired",
  authenticateToken,
  async (_req, res) => {
    try {
      const removed = await cleanupExpiredFn();
      res.json({ success: true, removed });
    } catch (e) {
      console.error("POST /api/providers/cleanup-expired error:", e);
      res
        .status(500)
        .json({ error: "Failed to cleanup expired (providers alias)" });
    }
  }
);

app.post(
  "/api/provider/cleanup-expired",
  authenticateToken,
  async (_req, res) => {
    try {
      const removed = await cleanupExpiredFn();
      res.json({ success: true, removed });
    } catch (e) {
      console.error("POST /api/provider/cleanup-expired error:", e);
      res
        .status(500)
        .json({ error: "Failed to cleanup expired (provider alias)" });
    }
  }
);

// Старые алиасы из фронта
app.post(
  "/api/requests/cleanup",
  authenticateToken,
  async (_req, res) => {
    try {
      const removed = await cleanupExpiredFn();
      res.json({ success: true, removed });
    } catch (e) {
      console.error("POST /api/requests/cleanup error:", e);
      res.status(500).json({ error: "Failed to cleanup (alias)" });
    }
  }
);

app.post(
  "/api/requests/purgeExpired",
  authenticateToken,
  async (_req, res) => {
    try {
      const removed = await purgeExpiredFn();
      res.json({ success: true, removed });
    } catch (e) {
      console.error("POST /api/requests/purgeExpired error:", e);
      res.status(500).json({ error: "Failed to purge (alias)" });
    }
  }
);

/** ===================== Health ===================== */
app.get("/", (_req, res) => res.send("🚀 Travella API OK"));

/** ===================== Donas Dosas: Public Investor/Bank Summary ===================== */
app.get("/api/public/donas/summary", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!process.env.DONAS_PUBLIC_KEY || key !== process.env.DONAS_PUBLIC_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const month = String(req.query.month || "");
    const SLUG = "donas-dosas";

    const settingsQ = await pool.query(
      `select * from donas_finance_settings order by id asc limit 1`
    );
    const s = settingsQ.rows[0] || {};

    const revenueQ = await pool.query(
      `select coalesce(sum(revenue),0) as v
       from donas_shifts
       where slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const cogsQ = await pool.query(
      `select coalesce(sum(total),0) as v
       from donas_purchases
       where type='purchase'
         and slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const payrollQ = await pool.query(
      `select coalesce(sum(total_pay),0) as v
       from donas_shifts
       where slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const R = Number(revenueQ.rows[0]?.v || 0);
    const C = Number(cogsQ.rows[0]?.v || 0);
    const payroll = Number(payrollQ.rows[0]?.v || 0);

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);
    const loan = Number(s.loan_payment_month || 0);

    // one-off expenses (opex/capex) for month
    const expQ = await pool.query(
      `
      select
        coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
        coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1 and to_char(date,'YYYY-MM')=$2
      `,
      [SLUG, month]
    );
    const opexExtra = Number(expQ.rows[0]?.opex_extra || 0);
    const capex = Number(expQ.rows[0]?.capex || 0);

    const opex = fixedOpex + variableOpex + payroll + opexExtra;
    const netOperating = R - C - opex;
    const cashFlow = netOperating - loan - capex;

    // для банка: dscr только если netOperating > 0
    const dscr = loan > 0 && netOperating > 0 ? netOperating / loan : null;

    return res.json({
      month,
      revenue: Math.round(R),
      cogs: Math.round(C),
      payroll: Math.round(payroll),
      fixedOpex: Math.round(fixedOpex),
      variableOpex: Math.round(variableOpex),
      opex: Math.round(opex),
      opexExtra: Math.round(opexExtra),
      capex: Math.round(capex),
      loan: Math.round(loan),
      netOperating: Math.round(netOperating),
      cashFlow: Math.round(cashFlow),
      dscr: dscr == null ? null : Number(dscr.toFixed(2)),
    });
  } catch (e) {
    console.error("GET /api/public/donas/summary error:", e);
    return res.status(500).json({ error: "Failed" });
  }
});

const crypto = require("crypto");

/** ===================== Donas Dosas: Share Tokens (no key in URL) ===================== */

// простая проверка "админ ли"
function isAdminUser(u) {
  const user = u || {};
  const roles = []
    .concat(user.role || [])
    .concat(user.roles || [])
    .flatMap((r) => String(r).split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const perms = []
    .concat(user.permissions || user.perms || [])
    .flatMap((p) => String(p).split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return (
    user.role === "admin" ||
    user.is_admin === true ||
    user.admin === true ||
    roles.includes("admin") ||
    roles.includes("root") ||
    roles.includes("super") ||
    perms.includes("moderation") ||
    perms.includes("admin:moderation")
  );
}

// base64url helpers
function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecodeToString(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

function getShareSecret() {
  // отдельный секрет лучше, но чтобы не ломать — есть fallback на DONAS_PUBLIC_KEY
  return (
    process.env.DONAS_PUBLIC_TOKEN_SECRET ||
    process.env.DONAS_PUBLIC_KEY ||
    "donas-dev-secret"
  );
}

function signShareToken(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const body = b64urlEncode(json);
  const sig = b64urlEncode(
    crypto.createHmac("sha256", getShareSecret()).update(body).digest()
  );
  return `${body}.${sig}`;
}

function verifyShareToken(token) {
  const t = String(token || "");
  const [body, sig] = t.split(".");
  if (!body || !sig) return { ok: false, error: "bad_format" };

  const expected = b64urlEncode(
    crypto.createHmac("sha256", getShareSecret()).update(body).digest()
  );
  // constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_sig" };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(body));
  } catch {
    return { ok: false, error: "bad_payload" };
  }

  const now = Date.now();
  const exp = Number(payload?.exp || 0);
  if (!exp || now > exp) return { ok: false, error: "expired" };

  if (payload?.scope !== "donas_investor_range") {
    return { ok: false, error: "bad_scope" };
  }

  return { ok: true, payload };
}

/**
 * ADMIN: выдаём share-token (TTL по умолчанию 7 дней)
 * POST /api/admin/donas/share-token
 * body: { months?: number, end?: "YYYY-MM", ttl_days?: number }
 */
app.post("/api/admin/donas/share-token", authenticateToken, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const months = Math.max(1, Math.min(60, Number(req.body?.months || 12)));
    const end = String(req.body?.end || "").trim() || getTzYearMonth("Asia/Tashkent");
    if (!/^\d{4}-\d{2}$/.test(end)) return res.status(400).json({ error: "Invalid end (use YYYY-MM)" });

    const ttlDays = Math.max(1, Math.min(60, Number(req.body?.ttl_days || 7)));
    const exp = Date.now() + ttlDays * 24 * 60 * 60 * 1000;

    const token = signShareToken({ scope: "donas_investor_range", months, end, exp });

    // ссылка на фронт (если есть), иначе относительная
    const base =
      process.env.FRONTEND_URL ||
      "https://travella.uz";

    const url = `${base}/public/donas/investor?t=${encodeURIComponent(token)}`;

    return res.json({ ok: true, token, url, exp });
  } catch (e) {
    console.error("POST /api/admin/donas/share-token error:", e);
    return res.status(500).json({ error: "Failed" });
  }
});

/**
 * PUBLIC: summary-range по share-token (без key)
 * GET /api/public/donas/summary-range-token?t=TOKEN
 * Возвращает тот же формат, что /api/public/donas/summary-range
 */
app.get("/api/public/donas/summary-range-token", async (req, res) => {
  try {
    const t = String(req.query.t || "");
    const v = verifyShareToken(t);
    if (!v.ok) return res.status(401).json({ error: "Unauthorized", reason: v.error });

    const months = Math.max(1, Math.min(60, Number(v.payload.months || 12)));
    const endYM = String(v.payload.end || "").trim();
    const endDate = ymToFirstDay(endYM);
    if (!endDate) return res.status(400).json({ error: "Invalid end (use YYYY-MM)" });
    const SLUG = "donas-dosas";

    // settings как в summary-range
    const settingsQ = await pool.query(
      `select * from donas_finance_settings order by id asc limit 1`
    );
    const s = settingsQ.rows[0] || {};
    const currency = String(s.currency || "UZS");

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);
    const loan = Number(s.loan_payment_month || 0);

    // тот же SQL, что в /api/public/donas/summary-range
    const q = await pool.query(
      `
      WITH params AS (
        SELECT
          date_trunc('month', $1::date) AS end_month,
          date_trunc('month', $1::date) - (($2::int - 1) || ' months')::interval AS start_month
      ),
      months AS (
        SELECT generate_series(
          (SELECT start_month FROM params),
          (SELECT end_month FROM params),
          interval '1 month'
        )::date AS month
      ),
      shifts AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(revenue),0)::numeric AS revenue,
          coalesce(sum(total_pay),0)::numeric AS payroll
        FROM donas_shifts
        WHERE date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      ),
      cogs AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(total),0)::numeric AS cogs
        FROM donas_purchases
        WHERE type='purchase'
          AND slug=$3
          AND date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      ),
      expenses AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(case when kind='opex' then amount else 0 end),0)::numeric AS opex_extra,
          coalesce(sum(case when kind='capex' then amount else 0 end),0)::numeric AS capex
        FROM donas_expenses
        WHERE slug=$3
          AND date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      )
      SELECT
        to_char(m.month,'YYYY-MM') AS month,
        coalesce(s.revenue,0) AS revenue,
        coalesce(c.cogs,0) AS cogs,
        coalesce(s.payroll,0) AS payroll,
        coalesce(e.opex_extra,0) AS opex_extra,
        coalesce(e.capex,0) AS capex
      FROM months m
      LEFT JOIN shifts s ON s.month = m.month
      LEFT JOIN cogs c ON c.month = m.month
      LEFT JOIN expenses e ON e.month = m.month
      ORDER BY m.month;
      `,
      [endDate, months, SLUG]
    );

    const monthsRows = q.rows || [];

    let tRevenue = 0, tCogs = 0, tPayroll = 0, tOpex = 0, tOpexExtra = 0, tCapex = 0, tNetOperating = 0, tCashFlow = 0;
    const dscrValues = [];

    const outMonths = monthsRows.map((r) => {
      const R = Number(r.revenue || 0);
      const C = Number(r.cogs || 0);
      const payroll = Number(r.payroll || 0);
      const opexExtra = Number(r.opex_extra || 0);
      const capex = Number(r.capex || 0);
      const opex = fixedOpex + variableOpex + payroll + opexExtra;
      const netOperating = R - C - opex;
      const cashFlow = netOperating - loan - capex;

      const dscr = loan > 0 && netOperating > 0 ? netOperating / loan : null;

      tRevenue += R; tCogs += C; tPayroll += payroll; tOpex += opex;
      tOpexExtra += opexExtra; tCapex += capex;
      tNetOperating += netOperating; tCashFlow += cashFlow;

      if (dscr != null && Number.isFinite(dscr)) dscrValues.push(dscr);

      return {
        month: String(r.month),
        revenue: Math.round(R),
        cogs: Math.round(C),
        payroll: Math.round(payroll),
        fixedOpex: Math.round(fixedOpex),
        variableOpex: Math.round(variableOpex),
        opex: Math.round(opex),
        opexExtra: Math.round(opexExtra),
        capex: Math.round(capex),
        loan: Math.round(loan),
        netOperating: Math.round(netOperating),
        cashFlow: Math.round(cashFlow),
        dscr: dscr == null ? null : Number(dscr.toFixed(2)),
      };
    });

    const fromYM = outMonths[0]?.month || null;
    const toYM = outMonths[outMonths.length - 1]?.month || null;

    const avgDscr = dscrValues.length ? dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length : null;
    const minDscr = dscrValues.length ? Math.min(...dscrValues) : null;

    return res.json({
      meta: { from: fromYM, to: toYM, months, currency },
      months: outMonths,
      totals: {
        revenue: Math.round(tRevenue),
        cogs: Math.round(tCogs),
        payroll: Math.round(tPayroll),
        opex: Math.round(tOpex),
        loan: Math.round(loan * months),
        netOperating: Math.round(tNetOperating),
        cashFlow: Math.round(tCashFlow),
        avgDscr: avgDscr == null ? null : Number(avgDscr.toFixed(2)),
        minDscr: minDscr == null ? null : Number(minDscr.toFixed(2)),
      },
    });
  } catch (e) {
    console.error("GET /api/public/donas/summary-range-token error:", e);
    return res.status(500).json({ error: "Failed" });
  }
});

/** ===================== Donas Dosas: Public Investor/Bank Summary RANGE ===================== */
/**
 * GET /api/public/donas/summary-range?key=...&months=12&end=YYYY-MM
 * - months: default 12
 * - end: YYYY-MM (default текущий месяц Asia/Tashkent)
 * Возвращает 12 месяцев (включая пустые) + totals
 */
function getTzYearMonth(timeZone = "Asia/Tashkent", d = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const parts = dtf.formatToParts(d);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return `${map.year}-${map.month}`;
}

function clampInt(n, def, min, max) {
  const x = Number.parseInt(String(n || ""), 10);
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, x));
}

function ymToFirstDay(ym) {
  // ym: YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(String(ym))) return null;
  return `${ym}-01`;
}

app.get("/api/public/donas/summary-range", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!process.env.DONAS_PUBLIC_KEY || key !== process.env.DONAS_PUBLIC_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const months = clampInt(req.query.months, 12, 1, 60);
    const endYM = String(req.query.end || "").trim() || getTzYearMonth("Asia/Tashkent");
    const endDate = ymToFirstDay(endYM);
    if (!endDate) return res.status(400).json({ error: "Invalid end (use YYYY-MM)" });

    // settings (как в public summary)
    const settingsQ = await pool.query(
      `select * from donas_finance_settings order by id asc limit 1`
    );
    const s = settingsQ.rows[0] || {};
    const currency = String(s.currency || "UZS");

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);
    const loan = Number(s.loan_payment_month || 0);

    // Возвращаем 12 месяцев всегда (generate_series), даже если данных нет
    const q = await pool.query(
      `
      WITH params AS (
        SELECT
          date_trunc('month', $1::date) AS end_month,
          date_trunc('month', $1::date) - (($2::int - 1) || ' months')::interval AS start_month
      ),
      months AS (
        SELECT generate_series(
          (SELECT start_month FROM params),
          (SELECT end_month FROM params),
          interval '1 month'
        )::date AS month
      ),
      shifts AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(revenue),0)::numeric AS revenue,
          coalesce(sum(total_pay),0)::numeric AS payroll
        FROM donas_shifts
        WHERE date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      ),
      cogs AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(total),0)::numeric AS cogs
        FROM donas_purchases
        WHERE type='purchase'
        AND slug=$3
          AND date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      ),
      expenses AS (
        SELECT
          date_trunc('month', date)::date AS month,
          coalesce(sum(case when kind='opex' then amount else 0 end),0)::numeric AS opex_extra,
          coalesce(sum(case when kind='capex' then amount else 0 end),0)::numeric AS capex
        FROM donas_expenses
        WHERE slug=$3
          AND date >= (SELECT start_month FROM params)
          AND date <  (SELECT end_month FROM params) + interval '1 month'
        GROUP BY 1
      )
      SELECT
        to_char(m.month,'YYYY-MM') AS month,
        coalesce(s.revenue,0) AS revenue,
        coalesce(c.cogs,0) AS cogs,
        coalesce(s.payroll,0) AS payroll,
        coalesce(e.opex_extra,0) AS opex_extra,
        coalesce(e.capex,0) AS capex
      FROM months m
      LEFT JOIN shifts s ON s.month = m.month
      LEFT JOIN cogs c ON c.month = m.month
      LEFT JOIN expenses e ON e.month = m.month
      ORDER BY m.month;
      `,
      [endDate, months, SLUG]
    );

    const monthsRows = q.rows || [];

    let tRevenue = 0;
    let tCogs = 0;
    let tPayroll = 0;
    let tOpex = 0;
    let tOpexExtra = 0;
    let tCapex = 0;
    let tNetOperating = 0;
    let tCashFlow = 0;

    const dscrValues = [];

    const outMonths = monthsRows.map((r) => {
      const R = Number(r.revenue || 0);
      const C = Number(r.cogs || 0);
      const payroll = Number(r.payroll || 0);
      const opexExtra = Number(r.opex_extra || 0);
      const capex = Number(r.capex || 0);
      const opex = fixedOpex + variableOpex + payroll + opexExtra;
      const netOperating = R - C - opex;
      const cashFlow = netOperating - loan - capex;
      
      // как у тебя в /api/public/donas/summary: dscr только если netOperating > 0
      const dscr = loan > 0 && netOperating > 0 ? netOperating / loan : null;

      tRevenue += R;
      tCogs += C;
      tPayroll += payroll;
      tOpex += opex;
      tOpexExtra += opexExtra;
      tCapex += capex;
      tNetOperating += netOperating;
      tCashFlow += cashFlow;

      if (dscr != null && Number.isFinite(dscr)) dscrValues.push(dscr);

      return {
        month: String(r.month),
        revenue: Math.round(R),
        cogs: Math.round(C),
        payroll: Math.round(payroll),
        fixedOpex: Math.round(fixedOpex),
        variableOpex: Math.round(variableOpex),
        opex: Math.round(opex),
        opexExtra: Math.round(opexExtra),
        capex: Math.round(capex),
        loan: Math.round(loan),
        netOperating: Math.round(netOperating),
        cashFlow: Math.round(cashFlow),
        dscr: dscr == null ? null : Number(dscr.toFixed(2)),
      };
    });

    const fromYM = outMonths[0]?.month || null;
    const toYM = outMonths[outMonths.length - 1]?.month || null;

    const avgDscr =
      dscrValues.length ? dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length : null;
    const minDscr = dscrValues.length ? Math.min(...dscrValues) : null;

    return res.json({
      meta: {
        from: fromYM,
        to: toYM,
        months,
        currency,
      },
      months: outMonths,
      totals: {
        revenue: Math.round(tRevenue),
        cogs: Math.round(tCogs),
        payroll: Math.round(tPayroll),
        opex: Math.round(tOpex),
        opexExtra: Math.round(tOpexExtra),
        capex: Math.round(tCapex),
        opexExtra: Math.round(tOpexExtra),
        capex: Math.round(tCapex),
        loan: Math.round(loan * months), // справочно, фикс. платёж * кол-во месяцев
        netOperating: Math.round(tNetOperating),
        cashFlow: Math.round(tCashFlow),
        avgDscr: avgDscr == null ? null : Number(avgDscr.toFixed(2)),
        minDscr: minDscr == null ? null : Number(minDscr.toFixed(2)),
      },
    });
  } catch (e) {
    console.error("GET /api/public/donas/summary-range error:", e);
    return res.status(500).json({ error: "Failed" });
  }
});

/** ===================== Telegram Bot (НОВЫЙ клиентский) ===================== */
/**
 * Здесь подключается backend/telegram/bot.js,
 * который использует TELEGRAM_CLIENT_BOT_TOKEN.
 * Старый бот по webhook'ам живёт в routes/telegramRoutes и
 * использует TELEGRAM_BOT_TOKEN — мы его не трогаем.
 */
let bot = null;
try {
  ({ bot } = require("./telegram/bot"));
  console.log("[tg-bot] index.js: bot module loaded =", !!bot);
} catch (e) {
  console.warn(
    "[tg-bot] bot module not loaded:",
    (e && (e.code || e.message)) || e
  );
}

/** ===================== Ask Actual Reminder Scheduler ===================== */
// 10:00 / 14:00 / 18:00 по Ташкенту, без cron
const REM_TZ = "Asia/Tashkent";
const REM_HOURS = new Set([10, 14, 18]);
let lastReminderKey = null; // чтобы не запускать дважды в одну минуту на одном инстансе

function getTZParts(date = new Date(), timeZone = REM_TZ) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const ymd = `${map.year}-${map.month}-${map.day}`;
  return {
    ymd,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function startAskActualReminderScheduler() {
  console.log(
    "[askActualReminder] scheduler enabled: 10:00 / 14:00 / 18:00 Asia/Tashkent"
  );

  // Пингуем часто, но job запускаем строго в нужные часы и только 1 раз на слот
  setInterval(async () => {
    try {
      const { ymd, hour, minute } = getTZParts(new Date(), REM_TZ);

      if (!REM_HOURS.has(hour)) return;

      // чтобы не промахнуться из-за дрейфа таймера/нагрузки:
      // считаем "окно запуска" первые 3 минуты нужного часа
      if (minute > 2) return;

      const slotKey = `${ymd}:${hour}`; // один запуск на часовой слот на инстанс
      if (lastReminderKey === slotKey) return;

      lastReminderKey = slotKey;

      await askActualReminder();
    } catch (e) {
      console.error("[askActualReminder] tick error:", e?.message || e);
    }
  }, 30 * 1000); // каждые 30 секунд
}

/** ===================== /Ask Actual Reminder Scheduler ===================== */

// ✅ Запускаем планировщик напоминаний (не зависит от polling — отправка идёт через tgSend в job)
  try {
    startAskActualReminderScheduler();
  } catch (e) {
    console.warn("[askActualReminder] scheduler start failed:", e?.message || e);
  }

if (bot) {
  console.log("[tg-bot] index.js: starting bot (polling) ...");



  (async () => {
    try {
      // 🔥 критично: выключаем webhook у CLIENT-бота перед polling
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log("[tg-bot] webhook deleted (drop pending updates)");

      await bot.launch();
      console.log("🤖 Telegram bot started (polling)");
    } catch (e) {
      const desc =
        (e && e.response && e.response.description) ||
        e?.description ||
        e?.message ||
        String(e);

      if (desc && desc.includes("Conflict: terminated by other getUpdates request")) {
        console.warn(
          "[tg-bot] 409 Conflict: другой процесс уже делает getUpdates этим токеном. " +
            "Этот экземпляр бота не будет получать обновления, но API продолжит работать.",
          desc
        );
      } else {
        console.error(
          "[tg-bot] start error — бот будет отключён, но API продолжит работать:",
          desc
        );
      }
    }
  })();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  console.log(
    "⚠️ Telegram bot is disabled — no module or no TELEGRAM_CLIENT_BOT_TOKEN"
  );
}

/** ===================== EntryFees ===================== */
// публичные
const entryFeesRoutes = require("./routes/entryFeesRoutes");
app.use("/api/entry-fees", entryFeesRoutes);

// админ-CRUD
const entryFeesAdminRoutes = require("./routes/entryFeesAdminRoutes");
app.use("/api/admin/entry-fees", entryFeesAdminRoutes);

/** ===================== Provider Services ===================== */
const providerServices = require("./routes/providerServices");
app.use(providerServices);

// ✅ Массовая рассылка (админ) через Bot Otkaznyx Turov
const adminBroadcastRoutes = require("./routes/adminBroadcastRoutes");
app.use("/api/admin/broadcast", adminBroadcastRoutes);

/** ===================== HotelsSeasons ===================== */
const hotelSeasonsRouter = require("./routes/hotelSeasons");
app.use("/api/hotels/:id/seasons", hotelSeasonsRouter);

/** ===================== TBtemplates ===================== */
app.use("/api/tour-templates", tbTemplatesRoutes);
app.use("/api/templates", tbTemplatesRoutes); // алиас для обратной совместимости

/** ===================== Подвал ===================== */
const cmsRoutes = require("./routes/cmsRoutes");
app.use("/api/cms", cmsRoutes);

/** ===================== Providers table for admin ===================== */
const adminProvidersRoutes = require("./routes/adminProvidersRoutes");
app.use("/api/admin", adminProvidersRoutes);

/** ===================== Admin: Actual Refused ===================== */
const adminRefusedRoutes = require("./routes/adminRefusedRoutes");
app.use("/api/admin", adminRefusedRoutes);

/** ===================== IndiaInside ===================== */
const insideRoutes = require("./routes/insideRoutes");
app.use("/api/inside", insideRoutes);

/** ===================== принудительно спросить сейчас об актуальности отказа в боте ===================== */
const adminJobsRoutes = require("./routes/adminJobsRoutes");
app.use("/api/admin", adminJobsRoutes);

/** ===================== Donas Dosas ===================== */
app.use("/api/admin/donas", adminDonasShiftRoutes);
app.use("/api/admin/donas", adminDonasPurchasesRoutes);
app.use("/api/admin/donas", adminDonasRecipeRoutes);
app.use("/api/admin/donas", adminDonasCogsRoutes);
app.use("/api/admin/donas", adminDonasMenuItemsRoutes);
app.use("/api/admin/donas", adminDonasIngredientsRoutes);
app.use(donasPublicMenuRoutes);
app.use("/api/admin/donas/opex", adminDonasOpexRoutes);
app.use("/api/admin/donas/finance", adminDonasFinanceMonthsRoutes);
app.use("/api/admin/donas", adminDonasSalesRoutes);

/** ===================== Start (в самом конце) ===================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("[CORS] allowed:", Array.from(WHITELIST));
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
