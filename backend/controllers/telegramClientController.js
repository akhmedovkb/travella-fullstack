// backend/controllers/telegramClientController.js

const pool = require("../db");

/**
 * Технический bcrypt-хэш какого-то "левого" пароля,
 * чтобы удовлетворить NOT NULL и формат для bcrypt.compare.
 */
const TELEGRAM_DUMMY_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu";

/**
 * Нормализация телефона: оставляем только цифры.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

/**
 * Ищем пользователя по телефону.
 * Сначала providers, потом clients.
 */
async function findUserByPhone(normPhone) {
  // 1) provider
  const prov = await pool.query(
    `
      SELECT id, name, phone
        FROM providers
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       LIMIT 1
    `,
    [normPhone]
  );

  if (prov.rowCount > 0) {
    const row = prov.rows[0];
    return { role: "provider", id: row.id, name: row.name };
  }

  // 2) client
  const cli = await pool.query(
    `
      SELECT id, name, phone
        FROM clients
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       LIMIT 1
    `,
    [normPhone]
  );

  if (cli.rowCount > 0) {
    const row = cli.rows[0];
    return { role: "client", id: row.id, name: row.name };
  }

  return null;
}

/**
 * POST /api/telegram/link
 * body: { role: "client" | "provider", phone, chatId, username, firstName }
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

    const requestedRole = role || "client";
    const displayName =
      firstName ||
      username ||
      "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log("[tg-link] normPhone:", normPhone, "requestedRole:", requestedRole);

    const found = await findUserByPhone(normPhone);

    if (found) {
      const foundRole = found.role;

      if (foundRole === "provider") {
        const upd = await pool.query(
          `
            UPDATE providers
               SET telegram_chat_id = $1,
                   telegram        = COALESCE($2, telegram)
             WHERE regexp_replace(phone, '\\\\D', '', 'g') = $3
             RETURNING id, name, phone
          `,
          [chatId, username || null, normPhone]
        );

        console.log("[tg-link] updated existing PROVIDER rows:", upd.rowCount);

        if (upd.rowCount === 0) {
          return res.status(404).json({ notFound: true });
        }

        const row = upd.rows[0];
        return res.json({
          success: true,
          role: "provider",
          id: row.id,
          name: row.name,
          existed: true,
          requestedRole,
        });
      }

      if (foundRole === "client") {
        const upd = await pool.query(
          `
            UPDATE clients
               SET telegram_chat_id = $1,
                   telegram        = COALESCE($2, telegram)
             WHERE regexp_replace(phone, '\\\\D', '', 'g') = $3
             RETURNING id, name, phone
          `,
          [chatId, username || null, normPhone]
        );

        console.log("[tg-link] updated existing CLIENT rows:", upd.rowCount);

        if (upd.rowCount === 0) {
          return res.status(404).json({ notFound: true });
        }

        const row = upd.rows[0];
        return res.json({
          success: true,
          role: "client",
          id: row.id,
          name: row.name,
          existed: true,
          requestedRole,
        });
      }
    }

    // Новый клиент
    if (!requestedRole || requestedRole === "client") {
      const email = `tg_${normPhone}@telegram.local`;

      const insertClient = await pool.query(
        `
          INSERT INTO clients (name, email, phone, password_hash, telegram_chat_id, telegram)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name
        `,
        [
          displayName,
          email,
          phone,
          TELEGRAM_DUMMY_PASSWORD_HASH,
          chatId,
          username || null,
        ]
      );

      const row = insertClient.rows[0];
      console.log("[tg-link] created NEW CLIENT from Telegram:", row);

      return res.json({
        success: true,
        role: "client",
        id: row.id,
        name: row.name,
        existed: false,
        created: "client",
        requestedRole,
      });
    }

    // Новый поставщик → лид
    if (requestedRole === "provider") {
      const insertLead = await pool.query(
        `
          INSERT INTO leads (phone, name, source, status, created_at)
          VALUES ($1, $2, 'telegram_provider', 'new', NOW())
          RETURNING id
        `,
        [phone, displayName]
      );

      const lead = insertLead.rows[0];
      console.log("[tg-link] created NEW PROVIDER LEAD from Telegram:", lead);

      return res.json({
        success: true,
        role: "provider_lead",
        leadId: lead.id,
        existed: false,
        created: "provider_lead",
        requestedRole,
      });
    }

    return res.status(400).json({ error: "invalid role" });
  } catch (e) {
    console.error("POST /api/telegram/link error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * GET /api/telegram/profile/:role/:chatId
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

/**
 * POST /api/telegram/client/:chatId/search
 * Поиск всех отказных услуг для бота:
 * - refused_tour
 * - refused_hotel
 * - refused_flight
 * - refused_event
 */
async function searchRefusedServices(req, res) {
  try {
    const { chatId } = req.params;
    const { query, type } = req.body || {};

    const q = (query || "").trim();
    if (!q) {
      return res.json({ success: true, items: [] });
    }

    // категории отказных услуг
    let categories;
    if (!type || type === "all") {
      categories = [
        "refused_tour",
        "refused_hotel",
        "refused_flight",
        "refused_event",
      ];
    } else {
      categories = [`refused_${type}`];
    }

    const like = `%${q.toLowerCase()}%`;

    console.log("[tg-search] chatId:", chatId, "q:", q, "categories:", categories);

    const sql = `
      SELECT
        s.id,
        s.category,
        s.title,
        s.details,
        s.price_from,
        s.currency,
        s.status,
        s.created_at,
        p.name AS provider_name
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.category = ANY($1)
        AND s.status = 'approved'
        AND (
          LOWER(COALESCE(s.title, '')) LIKE $2
          OR LOWER(COALESCE(s.details::text, '')) LIKE $2
        )
      ORDER BY s.created_at DESC
      LIMIT 30
    `;

    const result = await pool.query(sql, [categories, like]);

    const items = result.rows.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      details: row.details,
      price_from: row.price_from,
      currency: row.currency,
      provider_name: row.provider_name,
    }));

    return res.json({ success: true, items });
  } catch (e) {
    console.error("POST /api/telegram/client/:chatId/search error:", e);
    return res.status(500).json({ success: false, error: "internal_error" });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
  searchRefusedServices,
};
