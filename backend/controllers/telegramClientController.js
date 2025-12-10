// backend/controllers/telegramClientController.js

const pool = require("../db");

// Нормализация телефона: убираем всё, кроме цифр.
// "+998 97 716 37 15" → "998977163715"
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

/**
 * POST /api/telegram/link
 * body: { role: "client" | "provider", phone, chatId, username, firstName }
 *
 * Ищем клиента/поставщика по телефону и записываем telegram_chat_id.
 */
async function linkAccount(req, res) {
  try {
    const { role, phone, chatId, username } = req.body || {};
    const normPhone = normalizePhone(phone);

    if (!role || !normPhone || !chatId) {
      return res
        .status(400)
        .json({ error: "role, phone, chatId are required" });
    }

    // защита от инъекции — разрешаем только 2 таблицы
    const table =
      role === "provider" ? "providers" :
      role === "client"   ? "clients"   :
      null;

    if (!table) {
      return res.status(400).json({ error: "invalid role" });
    }

    console.log("[tg-link] body:", req.body);
    console.log("[tg-link] normPhone:", normPhone, "table:", table);

    // Ищем по цифрам: regexp_replace(phone, '\D','','g') = normPhone
    const result = await pool.query(
      `
      UPDATE ${table}
         SET telegram_chat_id = $1,
             telegram        = COALESCE($2, telegram)
       WHERE regexp_replace(phone, '\\\\D', '', 'g') = $3
       RETURNING id, name, phone
      `,
      [chatId, username || null, normPhone]
    );

    console.log("[tg-link] updated rows:", result.rowCount);

    if (result.rowCount === 0) {
      // не нашли — пусть сначала регаются на сайте
      return res.status(404).json({ notFound: true });
    }

    const row = result.rows[0];

    return res.json({
      success: true,
      id: row.id,
      name: row.name,
    });
  } catch (e) {
    console.error("POST /api/telegram/link error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * GET /api/telegram/profile/:role/:chatId
 * Быстрый способ понять, кто это в Телеге (клиент/поставщик).
 */
async function getProfileByChat(req, res) {
  try {
    const { role, chatId } = req.params;
    if (!role || !chatId) {
      return res.status(400).json({ error: "role & chatId required" });
    }

    const table =
      role === "provider" ? "providers" :
      role === "client"   ? "clients"   :
      null;

    if (!table) {
      return res.status(400).json({ error: "invalid role" });
    }

    const result = await pool.query(
      `
      SELECT id, name, phone, telegram_chat_id
        FROM ${table}
       WHERE telegram_chat_id = $1
       LIMIT 1
      `,
      [chatId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ notFound: true });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (e) {
    console.error("GET /api/telegram/profile error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
};
