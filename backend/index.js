// backend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

/* -------------------- CORS (надёжная настройка) -------------------- */
// Разрешённые фронтенд-домены
const allowedOrigins = new Set(
  [
    "https://travella-fullstack.vercel.app", // Vercel
    "http://localhost:5173",                 // локальная разработка (Vite)
    process.env.FRONTEND_URL,                // можно задавать через Railway → Variables
  ].filter(Boolean)
);

// Опции CORS с динамической проверкой origin
const corsOptions = {
  origin(origin, cb) {
    // Запросы без Origin (Postman/cURL) — пропускаем
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Подключаем CORS ДО роутов
app.use(cors(corsOptions));
// Обрабатываем preflight явно
app.options("*", cors(corsOptions));

/* -------------------- Парсинг тела запроса -------------------- */
// Увеличиваем лимит JSON/URL-encoded (для base64 изображений)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* -------------------- Роуты -------------------- */
const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);

const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

// Простой health-check (удобно для дебага/uptime)
app.get("/", (_req, res) => res.send("OK"));

/* -------------------- Запуск сервера -------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
