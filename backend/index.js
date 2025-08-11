const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

const clientRoutes = require("./routes/clientRoutes");

// Разрешаем CORS
app.use(
  cors({
    origin: "https://travella-fullstack.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Увеличиваем лимит JSON-боди (для base64 изображений)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Подключаем роуты провайдеров
const providerRoutes = require("./routes/providerRoutes");
app.use("/api/providers", providerRoutes);

// Подключаем роуты клиентов
app.use("/api/clients", clientRoutes);

//Подключаем роуты отелей
const hotelRoutes = require("./routes/hotelRoutes");
app.use("/api/hotels", hotelRoutes);


// Подключаем marketplace (⚠️ обязательно после express.json())
const marketplaceRoutes = require("./routes/marketplaceRoutes");
app.use("/api/marketplace", marketplaceRoutes);

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
