require("dotenv").config();
const axios = require("axios");
const pool = require("../db");
const { ensureTelegramOperationsSchema, getAdminSummary } = require("../services/telegramOperationsService");

async function probeChat(api, role, chatId) {
  if (!chatId) throw new Error(`Missing TELEGRAM_E2E_${role.toUpperCase()}_CHAT_ID`);
  const chat = await axios.get(`${api}/getChat`, { params: { chat_id: chatId }, timeout: 10000 });
  if (!chat.data?.ok) throw new Error(`${role}: getChat failed`);
  const sent = await axios.post(`${api}/sendMessage`, { chat_id: chatId, text: `Travella E2E: ${role} support flow OK (${new Date().toISOString()})`, disable_notification: true }, { timeout: 10000 });
  if (!sent.data?.ok) throw new Error(`${role}: sendMessage failed`);
  await axios.post(`${api}/deleteMessage`, { chat_id: chatId, message_id: sent.data.result.message_id }, { timeout: 10000 }).catch(() => {});
  return { role, chat_id: String(chatId), username: chat.data.result?.username || null };
}

async function main() {
  const token = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
  if (!token) throw new Error("Missing TELEGRAM_CLIENT_BOT_TOKEN");
  const api = `https://api.telegram.org/bot${token}`;
  const me = await axios.get(`${api}/getMe`, { timeout: 10000 });
  if (!me.data?.ok) throw new Error("Telegram getMe failed");
  await ensureTelegramOperationsSchema();
  const chats = [];
  chats.push(await probeChat(api, "client", process.env.TELEGRAM_E2E_CLIENT_CHAT_ID));
  chats.push(await probeChat(api, "provider", process.env.TELEGRAM_E2E_PROVIDER_CHAT_ID));
  const summary = await getAdminSummary();
  console.log(JSON.stringify({ ok: true, bot: me.data.result.username, chats, summary }, null, 2));
}

main().catch((error) => { console.error("[telegram-support-e2e]", error.response?.data || error.message || error); process.exitCode = 1; }).finally(() => pool.end());
