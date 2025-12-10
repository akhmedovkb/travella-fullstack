// backend/controllers/telegramClientController.js

const pool = require("../db");

/**
 * Нормализация телефона: оставляем только цифры.
 * "+998 97 716 37 15" -> "998977163715"
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

/**
 * Авто-определение: есть ли такой телефон среди клиентов/поставщиков.
 * Возвращает либо { role: 'client'|'provider', id, name }, либо null.
 */
async function findUserByPhone(normPhone) {
  const sql = `
    SELECT 'client' AS role, id, name
      FROM clients
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
    UNION ALL
    SELECT 'provider' AS role, id, name
      FROM providers
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
    LIMIT 1
  `;
  const r = await pool.query(sql, [normPhone]);
  return r.rows[0] || null;
}

/**
 * POST /api/telegram/link
 * body: { role: "client" | "provider", phone, chatId, username, firstName }
 *
 * ЛОГИКА:
 * 1) Нормализуем телефон -> "998977163715"
 * 2) Ищем в clients+providers:
 *    - если нашли -> обновляем telegram_chat_id и telegram, возвращаем { success, role, existed: true }
 * 3) Если НЕ нашли:
 *    - если role === 'client' (или role отсутствует) -> создаём НОВОГО клиента в clients
 *    - если role === 'provider' -> создаём lead в таблице leads
 */
async function linkAccount(req, res) {
  try {
    const { role, phone, chatId, username, firstName } = req.body || {};
    const normPhone = normalizePhone(phone);

    if (!normPhone || !chatId) {
      return res
        .status(400)
        .json({ error: "phone and chatId are required" });
    }

    const displayName =
      firstName ||
      username ||
      "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log("[tg-link] normPhone:", normPhone);

    // 1) Пытаемся найти уже существующего клиента/поставщика по телефону
    const found = await findUserByPhone(normPhone);

    // ---- 1.1. Телефон уже есть в базе: обновляем telegram_* и выходим ----
    if (found) {
      const foundRole = found.role; // 'client' | 'provider'
      const table = foundRole === "provider" ? "providers" : "clients";

      const upd = await pool.query(
        `
        UPDATE ${table}
           SET telegram_chat_id = $1,
               telegram        = COALESCE($2, telegram)
         WHERE regexp_replace(phone, '\\\\D', '', 'g') = $3
         RETURNING id, name, phone
        `,
        [chatId, username || null, normPhone]
      );

      console.log("[tg-link] updated existing user rows:", upd.rowCount);

      if (upd.rowCount === 0) {
        // теоретически не должно случиться, но на всякий случай
        return res.status(404).json({ notFound: true });
      }

      const row = upd.rows[0];
      return res.json({
        success: true,
        role: foundRole,
        id: row.id,
        name: row.name,
        existed: true,
      });
    }

    // ---- 1.2. Телефон НЕ найден в базе ни среди клиентов, ни среди поставщиков ----
    // Дальше решаем по присланной "role"

    // === Новый клиент из Telegram ===
    if (!role || role === "client") {
      const insertClient = await pool.query(
        `
        INSERT INTO clients (name, email, phone, telegram_chat_id, telegram)
        VALUES ($1, NULL, $2, $3, $4)
        RETURNING id, name
        `,
        [displayName, phone, chatId, username || null]
      );

      const row = insertClient.rows[0];
      console.log("[tg-link] created NEW client from Telegram:", row);

      return res.json({
        success: true,
        role: "client",
        id: row.id,
        name: row.name,
        existed: false,
        created: "client",
      });
    }

    // === Новый поставщик: не создаём сразу аккаунт, а заводим LEAD ===
    if (role === "provider") {
      // таблица leads уже используется в telegramRoutes -> buildLeadKB
      const insertLead = await pool.query(
        `
        INSERT INTO leads (phone, name, source, status, created_at)
        VALUES ($1, $2, 'telegram_provider', 'new', NOW())
        RETURNING id
        `,
        [phone, displayName]
      );

      const lead = insertLead.rows[0];
      console.log("[tg-link] created NEW PROVIDER lead from Telegram:", lead);

      return res.json({
        success: true,
        role: "provider_lead",
        leadId: lead.id,
        existed: false,
        created: "provider_lead",
      });
    }

    // На всякий случай — неизвестная роль
    return res.status(400).json({ error: "invalid role" });
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
