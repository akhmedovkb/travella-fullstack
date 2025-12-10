// backend/controllers/telegramClientController.js
const pool = require("../db");

/**
 * Технический bcrypt-хэш какого-то "левого" пароля,
 * чтобы удовлетворить NOT NULL и формат для bcrypt.compare.
 * Пользователь этот пароль не знает, и он ему не нужен,
 * пока он не задаст себе нормальный пароль через веб.
 *
 * Это пример рабочего bcrypt-хэша для строки "password".
 * (взят из официальных примеров bcrypt)
 */
const TELEGRAM_DUMMY_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu";

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
 * Вспомогалка: получить client.id по telegram_chat_id.
 * Возвращает число или null.
 */
async function getClientIdByChat(chatId) {
  const res = await pool.query(
    `
      SELECT id
        FROM clients
       WHERE telegram_chat_id = $1
       LIMIT 1
    `,
    [String(chatId)]
  );

  if (res.rowCount === 0) return null;
  return res.rows[0].id;
}

/**
 * Ищем пользователя по телефону.
 * ВАЖНО: сначала ищем среди providers (приоритет поставщика),
 * потом среди clients.
 *
 * Если нашли — возвращаем { role: 'provider'|'client', id, name }.
 * Если не нашли — возвращаем null.
 */
async function findUserByPhone(normPhone) {
  // 1) Пытаемся найти поставщика
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

  // 2) Если поставщика нет — ищем клиента
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
 *
 * ЛОГИКА:
 * 1) Нормализуем телефон -> "998977163715"
 * 2) Ищем по телефону сначала provider, потом client:
 *    - если нашли provider → привязываем Telegram как к поставщику
 *    - если нашли client   → привязываем Telegram как к клиенту
 * 3) Если телефон нигде не найден:
 *    - если role === 'provider' → создаём LEAD нового поставщика
 *    - иначе (role отсутствует или 'client') → создаём нового клиента
 *
 * ВАЖНО: поставщик НЕ становится клиентом автоматически.
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

    const requestedRole = role || "client"; // что выбрал пользователь в боте
    const displayName =
      firstName ||
      username ||
      "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log("[tg-link] normPhone:", normPhone, "requestedRole:", requestedRole);

    // 1) Пытаемся найти уже существующего пользователя по телефону
    const found = await findUserByPhone(normPhone);

    if (found) {
      // ---- Телефон уже есть в базе ----
      const foundRole = found.role; // 'provider' или 'client'

      // Если телефон принадлежит ПОСТАВЩИКУ — считаем его поставщиком,
      // даже если он нажимал "я клиент" в боте.
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
          // полезно знать боту: пользователь мог нажать "клиент", но он уже поставщик
          requestedRole,
        });
      }

      // Если телефон принадлежит клиенту
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

    // ---- Телефон нигде не найден: создаём нового ----
    // requestedRole влияет только здесь.

    // === Новый КЛИЕНТ из Telegram ===
    if (!requestedRole || requestedRole === "client") {
      // email NOT NULL -> генерируем техничный email на основе телефона
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

    // === Новый ПОСТАВЩИК: создаём lead, а не provider ===
    if (requestedRole === "provider") {
      // предполагаем, что есть таблица leads с полями (phone, name, source, status, created_at)
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

/**
 * GET /api/telegram/client/:chatId/favorites
 * Клиентские избранные услуги.
 *
 * Возвращает:
 * { success: true, clientId, items: [ ... ] }
 */
async function getClientFavorites(req, res) {
  try {
    const { chatId } = req.params;
    const clientId = await getClientIdByChat(chatId);

    if (!clientId) {
      return res.status(404).json({ notFound: true, reason: "client_not_found" });
    }

    // Берём последние избранные услуги клиента.
    // Таблица предполагается wishlist (как в API избранного).
    const favRes = await pool.query(
      `
        SELECT *
          FROM wishlist
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 50
      `,
      [clientId]
    );

    res.json({
      success: true,
      clientId,
      items: favRes.rows,
    });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/favorites error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * GET /api/telegram/client/:chatId/bookings
 * Брони клиента.
 *
 * Возвращает:
 * { success: true, clientId, items: [ ... ] }
 */
async function getClientBookings(req, res) {
  try {
    const { chatId } = req.params;
    const clientId = await getClientIdByChat(chatId);

    if (!clientId) {
      return res.status(404).json({ notFound: true, reason: "client_not_found" });
    }

    // Очень аккуратно: не завязываемся на названия колонок кроме id и client_id
    const bookingsRes = await pool.query(
      `
        SELECT *
          FROM bookings
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 50
      `,
      [clientId]
    );

    res.json({
      success: true,
      clientId,
      items: bookingsRes.rows,
    });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/bookings error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * GET /api/telegram/client/:chatId/requests
 * Заявки клиента (обычно "запросы на бронирование").
 *
 * Возвращает:
 * { success: true, clientId, items: [ ... ] }
 */
async function getClientRequests(req, res) {
  try {
    const { chatId } = req.params;
    const clientId = await getClientIdByChat(chatId);

    if (!clientId) {
      return res.status(404).json({ notFound: true, reason: "client_not_found" });
    }

    const reqRes = await pool.query(
      `
        SELECT *
          FROM requests
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 50
      `,
      [clientId]
    );

    res.json({
      success: true,
      clientId,
      items: reqRes.rows,
    });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/requests error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
  getClientFavorites,
  getClientBookings,
  getClientRequests,
};
