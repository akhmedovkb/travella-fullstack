// backend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Разрешаем CORS
// ✅ добавил localhost и OPTIONS, чтобы проходил preflight с Authorization
const allowedOrigins = [
  "https://travella-fullstack.vercel.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // для Postman и сервер-сервер
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"], // ✅ добавил OPTIONS
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
// ✅ Явный ответ на preflight
app.options("*", cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Увеличиваем лимит JSON-боди (для base64 изображений)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ----------------- РОУТЫ -----------------

// Подключаем роуты провайдеров
const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

// Подключаем роуты отелей
const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);

// Подключаем marketplace (⚠️ обязательно после express.json())
const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

// ✅ Новые роуты клиента (регистрация/логин/профиль)
const clientRoutes = require("./routes/clientRoutes");
app.use("/api/clients", clientRoutes);

// ✅ Новые роуты для запросов на изменения (клиент↔провайдер)
const requestRoutes = require("./routes/requestRoutes");
app.use("/api/requests", requestRoutes);

// ✅ Новые роуты для бронирований
const bookingRoutes = require("./routes/bookingRoutes");
app.use("/api/bookings", bookingRoutes);

// ✅ Роут для счётчиков уведомлений в шапке
const notificationsRoutes = require("./routes/notificationsRoutes");
app.use("/api/notifications", notificationsRoutes);

// Простой пинг
app.get("/", (req, res) => {
  res.send("🚀 Travella API OK");
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
