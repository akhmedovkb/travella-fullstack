// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");

console.log("=== BOT.JS LOADED ===");

// логируем токен полностью (временно!)
console.log("[tg-bot] CLIENT TOKEN RAW:", process.env.TELEGRAM_CLIENT_BOT_TOKEN);
console.log("[tg-bot] OLD TOKEN RAW:", process.env.TELEGRAM_BOT_TOKEN);

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || null;

if (!CLIENT_TOKEN) {
  console.log("🛑 CLIENT TOKEN IS EMPTY → EXPORTING bot=null");
  module.exports = { bot: null };
  return;
}

console.log("✅ CLIENT TOKEN OK, creating Telegraf instance");

const bot = new Telegraf(CLIENT_TOKEN);

bot.use(session());

bot.start((ctx) => ctx.reply("Бот работает 🚀"));

console.log("🟢 EXPORTING BOT INSTANCE");

module.exports = { bot };
