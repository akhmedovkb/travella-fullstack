const pool = require("../db");
const { bot } = require("./botInstance");
const { Markup } = require("telegraf");

function escapeMarkdown(text = "") {
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function buildServiceText(service) {
  const d = service.details || {};

  const title = escapeMarkdown(service.title || "Новый отказ");
  const country = escapeMarkdown(d.directionCountry || "");
  const hotel = escapeMarkdown(d.hotel || d.hotelName || "");
  const dates =
    d.startDate && d.endDate
      ? `📅 ${escapeMarkdown(d.startDate)} — ${escapeMarkdown(d.endDate)}`
      : "";
  const price =
    d.netPrice
      ? `💰 Цена (нетто): *${escapeMarkdown(String(d.netPrice))} ${escapeMarkdown(d.currency || "USD")}*`
      : "";

  return (
    `🔥 *Новый отказной тур!*\n\n` +
    `🏝 *${title}*\n` +
    (country ? `🌍 ${country}\n` : "") +
    (hotel ? `🏨 ${hotel}\n` : "") +
    (dates ? `${dates}\n` : "") +
    (price ? `${price}\n` : "") +
    `\n⏳ Количество ограничено — кто успел, тот забрал`
  );
}

async function broadcastApprovedService(serviceId) {
  const svcRes = await pool.query(
    "SELECT id, title, details FROM services WHERE id = $1",
    [serviceId]
  );
  const service = svcRes.rows[0];
  if (!service) return;

  const usersRes = await pool.query(
    "SELECT DISTINCT telegram_chat_id FROM telegram_users WHERE telegram_chat_id IS NOT NULL"
  );

  const text = buildServiceText(service);
  const url = `https://t.me/${process.env.BOT_USERNAME}?start=service_${service.id}`;

  const keyboard = Markup.inlineKeyboard([
    Markup.button.url("🔍 Открыть в боте", url),
  ]);

  for (const u of usersRes.rows) {
    try {
      await bot.telegram.sendMessage(u.telegram_chat_id, text, {
        parse_mode: "Markdown",
        ...keyboard,
      });
    } catch (e) {
      console.error("[broadcast] failed for chatId", u.telegram_chat_id);
    }
  }
}

module.exports = { broadcastApprovedService };
