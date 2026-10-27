const express = require("express");
const axios = require("axios");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { tgSend } = require("../utils/telegram");
const {
  listAdminTickets,
  getTicket,
  assignTicket,
  updateTicketStatus,
  addTicketMessage,
  getAdminSummary,
  getLearningAnalytics,
} = require("../services/telegramOperationsService");

router.use(authenticateToken, requireAdmin);

router.get("/", async (req, res) => {
  try {
    const items = await listAdminTickets(req.query);
    res.json({ items });
  } catch (error) {
    console.error("[telegram-support] list", error);
    res.status(500).json({ message: "Не удалось загрузить обращения" });
  }
});

router.get("/summary", async (_req, res) => {
  try { res.json(await getAdminSummary()); }
  catch (error) { res.status(500).json({ message: "Не удалось загрузить сводку" }); }
});

router.get("/learning-analytics", async (_req, res) => {
  try { res.json(await getLearningAnalytics()); }
  catch (error) { console.error("[telegram-support] analytics", error); res.status(500).json({ message: "Не удалось загрузить аналитику" }); }
});

router.get("/:ticketId/messages/:messageId/attachments/:index", async (req, res) => {
  try {
    const ticket = await getTicket(req.params.ticketId);
    const message = ticket?.messages?.find((item) => Number(item.id) === Number(req.params.messageId));
    const file = message?.attachments?.[Number(req.params.index)];
    if (!file?.file_id) return res.status(404).json({ message: "Вложение не найдено" });
    const token = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
    const metadata = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: file.file_id }, timeout: 10000 });
    const filePath = metadata.data?.result?.file_path;
    if (!filePath) return res.status(404).json({ message: "Файл недоступен" });
    const download = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, { responseType: "stream", timeout: 20000 });
    res.setHeader("Content-Type", file.mime_type || download.headers["content-type"] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${String(file.name || `attachment-${message.id}`).replace(/["\\\r\n]/g, "_")}"`);
    download.data.pipe(res);
  } catch (error) { console.error("[telegram-support] attachment", error?.message || error); res.status(502).json({ message: "Не удалось загрузить вложение" }); }
});

router.get("/:id", async (req, res) => {
  try {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Обращение не найдено" });
    res.json(ticket);
  } catch (error) { res.status(500).json({ message: "Не удалось загрузить обращение" }); }
});

router.post("/:id/assign", async (req, res) => {
  try {
    const ticket = await assignTicket(req.params.id, req.user.id || req.user.provider_id);
    if (!ticket) return res.status(404).json({ message: "Обращение не найдено" });
    await tgSend(ticket.chat_id, `👩‍💻 Обращение #${ticket.id} взято в работу.`).catch(() => {});
    res.json(ticket);
  } catch (error) { res.status(500).json({ message: "Не удалось назначить обращение" }); }
});

router.post("/:id/status", async (req, res) => {
  try {
    const status = String(req.body.status || "");
    const ticket = await updateTicketStatus(req.params.id, status, req.body.note || null);
    if (!ticket) return res.status(404).json({ message: "Обращение не найдено" });
    if (["resolved", "closed"].includes(status)) await tgSend(ticket.chat_id, `✅ Обращение #${ticket.id} решено. Если вопрос остался, создайте новое обращение.`).catch(() => {});
    res.json(ticket);
  } catch (error) { res.status(400).json({ message: error.message === "invalid_status" ? "Недопустимый статус" : "Не удалось изменить статус" }); }
});

router.post("/:id/messages", async (req, res) => {
  try {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Обращение не найдено" });
    const text = String(req.body.message || "").trim();
    const row = await addTicketMessage({ ticketId: ticket.id, senderRole: "admin", senderId: req.user.id || req.user.provider_id, message: text });
    await tgSend(ticket.chat_id, `💬 <b>Ответ поддержки по обращению #${ticket.id}</b>\n\n${text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))}`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Ответить", callback_data: `support:reply:${ticket.id}` }]] } });
    res.status(201).json(row);
  } catch (error) { res.status(400).json({ message: error.message === "empty_message" ? "Введите сообщение" : "Не удалось отправить ответ" }); }
});

module.exports = router;
