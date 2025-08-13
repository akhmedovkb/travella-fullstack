// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const providerRoutes = require("./routes/providerRoutes");
const clientRoutes = require("./routes/clientRoutes");
const marketplaceRoutes = require("./routes/marketplaceRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const requestRoutes = require("./routes/requestRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const hotelRoutes = require("./routes/hotelRoutes");
const notificationsRoutes = require("./routes/notificationsRoutes");

const app = express();

// доверяем прокси (Railway/Vercel)
app.set("trust proxy", 1);

// CORS: перечисли фронтовые домены через запятую в CORS_ORIGIN
// пример: CORS_ORIGIN=https://travella-fullstack.vercel.app,http://localhost:5173
const allowlist = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // для curl/health
      if (allowlist.length === 0 || allowlist.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "15mb" }));
app.use(morgan("dev"));

// health
app.get("/", (req, res) =>
  res.json({
    ok: true,
    service: "travella-backend",
    env: process.env.NODE_ENV || "development",
  })
);
app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ================== API ================== */
app.use("/api/providers", providerRoutes);        // профили, услуги, календарь, и т.д.
app.use("/api/clients", clientRoutes);            // клиенты
app.use("/api/marketplace", marketplaceRoutes);   // поиск/витрина (POST /search и др.)
app.use("/api/bookings", bookingRoutes);          // бронирования
app.use("/api/requests", requestRoutes);          // быстрые запросы/контакты
app.use("/api/reviews", reviewRoutes);            // отзывы/рейтинги
app.use("/api/wishlist", wishlistRoutes);         // избранное
app.use("/api/hotels", hotelRoutes);              // поиск отелей (autocomplete)
app.use("/api/notifications", notificationsRoutes);

/* ================ 404 + errors ================ */
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal Server Error" });
});

/* ================== START ================== */
const PORT = process.env.PORT || 3000;
// Railway сам выставляет HOST/PORT; слушаем на 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on :${PORT}`);
});
