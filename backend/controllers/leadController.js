// backend/controllers/leadController.js

const pool = require("../db");
const fetch = (...args) => import("node-fetch").then(({default: f}) => f(...args));

async function notifyTelegram({ name, phone, city, pax, comment, page, lang }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text =
    `🆕 Новый лид\n` +
    `Имя: ${name || "-"}\n` +
    `Телефон: ${phone || "-"}\n` +
    `Город: ${city || "-"}\n` +
    `PAX: ${pax || "-"}\n` +
    `Стр.: ${page || "-"} | Яз.: ${lang || "-"}\n` +
    `Комментарий: ${comment || "-"}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("Telegram notify error:", e.message);
  }
}

exports.createLead = async (req, res) => {
  try {
    const { name, phone, city, pax, comment, page, lang } = req.body || {};

    // простая валидация
    if (!phone || String(phone).trim().length < 5) {
      return res.status(400).json({ error: "PHONE_REQUIRED" });
    }

    const q = `
      INSERT INTO leads (name, phone, city, pax, comment, page, lang)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *;
    `;
    const vals = [
      name || null,
      phone || null,
      city || null,
      pax ? Number(pax) : null,
      comment || null,
      page || req.headers["x-source"] || null,
      (lang || req.headers["x-lang"] || "ru").toLowerCase(),
    ];

    const { rows } = await pool.query(q, vals);
    const lead = rows[0];

    // async fire-and-forget
    notifyTelegram(lead);

    return res.json({ ok: true, lead });
  } catch (e) {
    console.error("createLead error:", e);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
};

exports.listLeads = async (req, res) => {
  try {
    const { status } = req.query;
    const rows = status
      ? (await pool.query(
          `SELECT * FROM leads WHERE status = $1 ORDER BY created_at DESC LIMIT 500`,
          [status]
        )).rows
      : (await pool.query(
          `SELECT * FROM leads ORDER BY created_at DESC LIMIT 500`
        )).rows;

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("listLeads error:", e);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
};

exports.updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["new", "working", "closed"].includes(String(status))) {
      return res.status(400).json({ error: "BAD_STATUS" });
    }
    const { rows } = await pool.query(
      `UPDATE leads SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ ok: true, lead: rows[0] });
  } catch (e) {
    console.error("updateLeadStatus error:", e);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
};
