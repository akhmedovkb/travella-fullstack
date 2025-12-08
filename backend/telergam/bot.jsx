import { Telegraf, session, Markup } from "telegraf";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = process.env.API_BASE_URL;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN не найден в .env");
  process.exit(1);
}

export const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Команда /start
bot.start((ctx) => {
  ctx.reply(
    "Добро пожаловать в Travella!\nВыберите действие:",
    Markup.keyboard([
      ["🔍 Найти услугу"],
      ["📝 Регистрация"],
    ]).resize()
  );
});

// Хэндлинг текстов
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  if (text === "🔍 Найти услугу") {
    return ctx.reply("Введите название города, страны или услуги:");
  }

  if (text === "📝 Регистрация") {
    return ctx.reply(
      "Кого регистрируем?",
      Markup.keyboard([["Клиент", "Поставщик"], ["⬅️ Назад"]]).resize()
    );
  }

  // Поиск услуг
  if (!text.startsWith("/")) {
    try {
      const res = await axios.post(`${API}/marketplace/search`, {
        q: text,
      });

      const items = res.data?.results || [];

      if (!items.length) {
        return ctx.reply("Ничего не найдено 😔");
      }

      for (const item of items.slice(0, 10)) {
        await ctx.replyWithPhoto(item.images?.[0] || null, {
          caption: `🏷 ${item.title}\nЦена: ${item.price}\n\nПодробнее: https://travella.uz/service/${item.id}`,
        });
      }
    } catch (err) {
      console.log(err);
      ctx.reply("Ошибка поиска");
    }
  }
});

// Запуск
export function launchBot() {
  bot.launch();
  console.log("🤖 Telegram Bot запущен");
}
