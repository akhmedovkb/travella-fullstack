// backend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const tbTemplatesRoutes = require("./routes/TBtemplatesRoutes");

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
  "https://india.travella.uz",                // ← ДОБАВИЛ ЭТУ СТРОКУ
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

const hotels = require("./controllers/hotelsController");
//app.get("/api/hotels/:id/inspections", hotels.listHotelInspections);
//app.post("/api/hotels/:id/inspections", hotels.createHotelInspection);
//app.post("/api/inspections/:id/like", hotels.likeInspection);

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

// Лайки инспекций отелей
const hotelInspectionRoutes = require("./routes/hotelInspectionRoutes");
app.use("/api/hotel-inspections", hotelInspectionRoutes);

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

//квота GeoNames
const monitorRoutes = require("./routes/monitorRoutes");
app.use("/api/monitor", monitorRoutes);

// ===== Leads (лендинги: /tours, /ayurveda, /checkup, /treatment, /b2b, /contacts)
const leadRoutes = require("./routes/leadRoutes");
app.use("/api/leads", leadRoutes);

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

/** ===================== Health ===================== */
app.get("/", (_req, res) => res.send("🚀 Travella API OK"));

/** ===================== Telegram Bot ===================== */
let bot = null;
try {
  ({ bot } = require("./telegram/bot"));
} catch (e) {
  console.warn(
    "[tg-bot] bot module not loaded:",
    e && (e.code || e.message || e)
  );
}

if (bot) {
  bot
    .launch()
    .then(() => {
      console.log("🤖 Telegram bot started");
    })
    .catch((e) => {
      const desc =
        (e && e.response && e.response.description) ||
        e?.description ||
        e?.message ||
        String(e);

      if (
        desc &&
        desc.includes(
          "Conflict: terminated by other getUpdates request"
        )
      ) {
        console.warn(
          "[tg-bot] 409 Conflict: другой процесс уже делает getUpdates этим токеном. " +
            "Этот экземпляр бота не будет получать обновления, но API продолжит работать.",
          desc
        );
        // НИЧЕГО не кидаем дальше — просто не запускаем polling
      } else {
        console.error(
          "[tg-bot] launch error — бот будет отключён, но API продолжит работать:",
          desc
        );
      }
    });

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
const providerServices = require('./routes/providerServices');
app.use(providerServices);

/** ===================== HotelsSeasons ===================== */
const hotelSeasonsRouter = require('./routes/hotelSeasons');
app.use('/api/hotels/:id/seasons', hotelSeasonsRouter);

/** ===================== TBtemplates ===================== */
app.use("/api/tour-templates", tbTemplatesRoutes);
app.use("/api/templates", tbTemplatesRoutes); // алиас для обратной совместимости

/** ===================== Подвал ===================== */
const cmsRoutes = require("./routes/cmsRoutes");
app.use("/api/cms", cmsRoutes);

/** ===================== Providers table for admin ===================== */
const adminProvidersRoutes = require("./routes/adminProvidersRoutes");
app.use("/api/admin", adminProvidersRoutes);

/** ===================== IndiaInside ===================== */
const insideRoutes = require("./routes/insideRoutes");
app.use("/api/inside", insideRoutes);
