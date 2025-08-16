// backend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
// ↑ где-то рядом с остальными require
const cors = require('cors');

// Разрешённые точные origin'ы
const WHITELIST = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'https://travella-fullstack.vercel.app',
  'https://travella-fullstack-q0ayptios-komil.vercel.app', // твой превью-хост из логов
]);

// Разрешаем все превью-хосты твоего проекта на Vercel вида travella-fullstack-*.vercel.app
function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/Postman/сервер-сервер
  try {
    const url = new URL(origin);
    const { hostname, protocol } = url;
    if (!/^https?:$/.test(protocol)) return false;

    if (WHITELIST.has(origin)) return true;

    // превью Vercel: travella-fullstack-abc123.vercel.app и т.п.
    const isVercelPreview =
      hostname.endsWith('.vercel.app') &&
      (hostname === 'travella-fullstack.vercel.app' ||
       hostname.startsWith('travella-fullstack-'));

    if (isVercelPreview) return true;

    return false;
  } catch {
    return false;
  }
}

// ВАЖНО: ставим до app.use('/api', .../роутов)
app.use(cors({
  origin(origin, cb) {
    const ok = isAllowedOrigin(origin);
    if (ok) return cb(null, true);
    console.warn('CORS blocked:', origin);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
}));

// Разрешаем preflight для любых путей
app.options('*', cors());


/** ===================== CORS ===================== */
const allowedOrigins = [
  "https://travella-fullstack.vercel.app",
  "https://travella-fullstack-8yle5am3l-komil.vercel.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin(origin, cb) {
      // Разрешаем postman/серверные запросы без origin
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Preflight
app.options(
  "*",
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

/** ===================== Body ===================== */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/** ===================== Routes ===================== */
const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);

const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

const clientRoutes = require("./routes/clientRoutes");
app.use("/api/clients", clientRoutes);

/**
 * requestRoutes может экспортировать:
 * 1) только router  -> module.exports = router
 * 2) объект { router, cleanupExpiredRequests, purgeExpiredRequests }
 * Поддержим оба варианта.
 */
const _requestRoutes = require("./routes/requestRoutes");
const requestRouter = _requestRoutes.router || _requestRoutes; // express.Router
const cleanupExpiredFn =
  _requestRoutes.cleanupExpiredRequests ||
  (async () => []); // no-op, чтобы не падать
const purgeExpiredFn =
  _requestRoutes.purgeExpiredRequests ||
  (async () => []); // no-op, чтобы не падать

app.use("/api/requests", requestRouter);

const bookingRoutes = require("./routes/bookingRoutes");
app.use("/api/bookings", bookingRoutes);

const notificationsRoutes = require("./routes/notificationsRoutes");
app.use("/api/notifications", notificationsRoutes);

// NEW: wishlist
const wishlistRoutes = require("./routes/wishlistRoutes");
app.use("/api/wishlist", wishlistRoutes);

// Reviews (отзывы)
const reviewRoutes = require("./routes/reviewRoutes");
app.use("/api/reviews", reviewRoutes);

/** ===================== Debug ===================== */
const authenticateToken = require("./middleware/authenticateToken");
app.get("/api/_debug/whoami", authenticateToken, (req, res) => res.json(req.user));

/** ===================== Aliases (Back-compat) ===================== */
/**
 * Эти пути дергает фронт. Чтобы не ловить 404 даже со старым фронтом,
 * даем алиасы тут. Если в requestRoutes есть реальные функции — вызываем их.
 */
app.post("/api/providers/cleanup-expired", authenticateToken, async (req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/providers/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired (providers alias)" });
  }
});

app.post("/api/provider/cleanup-expired", authenticateToken, async (req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/provider/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired (provider alias)" });
  }
});

// Старые алиасы из фронта
app.post("/api/requests/cleanup", authenticateToken, async (req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup error:", e);
    res.status(500).json({ error: "Failed to cleanup (alias)" });
  }
});

app.post("/api/requests/purgeExpired", authenticateToken, async (req, res) => {
  try {
    const removed = await purgeExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/purgeExpired error:", e);
    res.status(500).json({ error: "Failed to purge (alias)" });
  }
});

/** ===================== Health ===================== */
app.get("/", (_req, res) => res.send("🚀 Travella API OK"));

/** ===================== Start ===================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
