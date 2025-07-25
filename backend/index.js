const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Подключаем marketplace
const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

// Разрешаем CORS
app.use(
  cors({
    origin: "https://travella-fullstack.vercel.app", // 👈 твой frontend
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Позволяем читать application/x-www-form-urlencoded (нужно для form-data)
app.use(express.urlencoded({ extended: true }));

// Увеличиваем лимит JSON-боди (для base64 изображений)
app.use(express.json({ limit: "10mb" }));

// Подключаем роуты провайдеров
const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
