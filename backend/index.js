// backend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

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
  "https://travella-fullstack.vercel.app",
  "https://travella-fullstack-q0ayptios-komil.vercel.app", // из логов
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
  credentials: true,              // оставил, если используются cookie
  optionsSuccessStatus: 204,      // корректный код для preflight
};

// ВАЖНО: CORS должен стоять ПЕРЕД ЛЮБЫМИ РОУТАМИ
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
/** ===================== /CORS ===================== */

/** ===================== Body ===================== */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/** ===================== Routes ===================== */
const availabilityRoutes = require("./routes/availabilityRoutes");
app.use("/api/availability", availabilityRoutes);

const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);

const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

const clientRoutes = require("./routes/clientRoutes");
app.use("/api/clients", clientRoutes);

const profileRoutes = require("./routes/profileRoutes");
app.use("/api/profile", profileRoutes); 

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

// NEW: wishlist
const wishlistRoutes = require("./routes/wishlistRoutes");
app.use("/api/wishlist", wishlistRoutes);

// Reviews (отзывы)
const reviewRoutes = require("./routes/reviewRoutes");
app.use("/api/reviews", reviewRoutes);

// Telegram bot
const telegramRoutes = require("./routes/telegramRoutes");
app.use("/api/telegram", express.json({ limit: "2mb" }), telegramRoutes);

//языки
const metaRoutes = require("./routes/metaRoutes");
app.use("/api/meta", metaRoutes);

//модерация админом
const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

//секции маркетплэйса
const marketplaceSectionsRoutes = require("./routes/marketplaceSectionsRoutes");
app.use("/api/marketplace/sections", marketplaceSectionsRoutes);

const moderationRoutes = require("./routes/moderationRoutes");
app.use("/api/moderation", moderationRoutes);


/** ===================== Debug ===================== */
const authenticateToken = require("./middleware/authenticateToken");
app.get("/api/_debug/whoami", authenticateToken, (req, res) => res.json(req.user));

/** ===================== Aliases (Back-compat) ===================== */
app.post("/api/providers/cleanup-expired", authenticateToken, async (_req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/providers/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired (providers alias)" });
  }
});

app.post("/api/provider/cleanup-expired", authenticateToken, async (_req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/provider/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired (provider alias)" });
  }
});

// Старые алиасы из фронта
app.post("/api/requests/cleanup", authenticateToken, async (_req, res) => {
  try {
    const removed = await cleanupExpiredFn();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup error:", e);
    res.status(500).json({ error: "Failed to cleanup (alias)" });
  }
});

app.post("/api/requests/purgeExpired", authenticateToken, async (_req, res) => {
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
  console.log("[CORS] allowed:", Array.from(WHITELIST));
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
