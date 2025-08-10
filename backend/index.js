// index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

/* ---------- CORS (надёжно) ---------- */
// 1) перечисляем разрешённые фронтенды
const allowedOrigins = new Set([
  "https://travella-fullstack.vercel.app",  // Vercel
  "http://localhost:5173",                  // Vite dev
  process.env.FRONTEND_URL,                 // можно задать в Railway
].filter(Boolean));

// 2) динамическая проверка origin
const corsOptions = {
  origin(origin, cb) {
    // прямые запросы (Postman, curl) приходят без origin → разрешаем
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // вдруг когда-то будут cookie
  optionsSuccessStatus: 204, // чтобы не падали старые браузеры
};

// обязательно до роутов
app.use(cors(corsOptions));
// Явно обрабатываем preflight
app.options("*", cors(corsOptions));

/* ---------- размеры JSON (base64) ---------- */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ---------- ваши роуты ниже ---------- */
// const providerRoutes = require("./routes/providerRoutes");
// app.use("/api/providers", providerRoutes);
// ...
