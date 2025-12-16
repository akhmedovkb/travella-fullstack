// backend/controllers/telegramClientController.js
const pool = require("../db");
const { tgSendToAdmins } = require("../utils/telegram");

/**
 * Технический bcrypt-хэш "левого" пароля (для соблюдения NOT NULL и bcrypt.compare).
 * Пользователь этот пароль не знает и не использует (до установки через веб).
 */
const TELEGRAM_DUMMY_PASSWORD_HASH =
  process.env.TELEGRAM_DUMMY_PASSWORD_HASH ||
  "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu";

/** Нормализация телефона: только цифры */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

/** Ищем пользователя по телефону: providers -> clients */
async function findUserByPhone(normPhone) {
  // 1) Поставщик
  const prov = await pool.query(
    `
      SELECT id, name, phone, telegram_chat_id
        FROM providers
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       LIMIT 1
    `,
    [normPhone]
  );
  if (prov.rowCount > 0) {
    const row = prov.rows[0];
    return {
      role: "provider",
      id: row.id,
      name: row.name,
      telegram_chat_id: row.telegram_chat_id,
    };
  }

  // 2) Клиент
  const cli = await pool.query(
    `
      SELECT id, name, phone, telegram_chat_id
        FROM clients
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       LIMIT 1
    `,
    [normPhone]
  );
  if (cli.rowCount > 0) {
    const row = cli.rows[0];
    return {
      role: "client",
      id: row.id,
      name: row.name,
      telegram_chat_id: row.telegram_chat_id,
    };
  }

  return null;
}

function normalizeRequestedRole(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "client";
  // На уровне Telegram API роль часто приходит как "provider".
  // В БД же для турагента хотим хранить "agent".
  if (v === "provider") return "agent";
  return v;
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
      return res.status(400).json({ error: "phone and chatId are required" });
    }

    const requestedRole = normalizeRequestedRole(role || "client");
    const displayName = firstName || username || "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log(
      "[tg-link] normPhone:",
      normPhone,
      "requestedRole:",
      requestedRole
    );

    // 1) Уже есть в базе (providers/clients)?
    const found = await findUserByPhone(normPhone);

    if (found) {
      // ===== ПРОВАЙДЕР НАЙДЕН =====
      if (found.role === "provider") {
        // Всегда актуализируем telegram_chat_id и social (это важно для уведомлений)
        const upd = await pool.query(
          `
            UPDATE providers
               SET telegram_chat_id = $1,
                   social           = COALESCE($2, social)
             WHERE id = $3
             RETURNING id, name, phone, telegram_chat_id, social
          `,
          [chatId, username ? `@${username}` : null, found.id]
        );

        if (!upd.rowCount) {
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
          alreadyLinked: String(found.telegram_chat_id) === String(chatId),
        });
      }

      // ===== КЛИЕНТ НАЙДЕН =====
      if (found.role === "client") {
        const upd = await pool.query(
          `
            UPDATE clients
               SET telegram_chat_id = $1,
                   telegram        = COALESCE($2, telegram)
             WHERE id = $3
             RETURNING id, name, phone, telegram_chat_id
          `,
          [chatId, username || null, found.id]
        );

        if (!upd.rowCount) {
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
          alreadyLinked: String(found.telegram_chat_id) === String(chatId),
        });
      }
    }

    // ===== Телефон не найден: создаём нового =====

    // --- новый КЛИЕНТ ---
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

    // ===== новый ПОСТАВЩИК: создаём (или реюзаем) lead =====
    if (requestedRole === "agent") {
      // 1) если есть активный lead — обновляем telegram-поля, чтобы ничего не “пропадало”
      const existingLead = await pool.query(
        `
          SELECT id, telegram_chat_id
            FROM leads
           WHERE regexp_replace(phone,'\\D','','g') = $1
             AND status = 'new'
             AND decision IS NULL
           ORDER BY id DESC
           LIMIT 1
        `,
        [normPhone]
      );

      if (existingLead.rowCount > 0) {
        const leadId = existingLead.rows[0].id;
        const prevChat = existingLead.rows[0].telegram_chat_id || null;

        await pool.query(
          `
            UPDATE leads
               SET telegram_chat_id = $2,
                   telegram_username = $3,
                   telegram_first_name = $4,
                   name = COALESCE(NULLIF(name,''), $5)
             WHERE id = $1
          `,
          [leadId, chatId, username || null, firstName || null, displayName]
        );

        // уведомим админов, если это новая привязка/смена chatId (чтобы не было “тихо”)
        if (!prevChat || String(prevChat) !== String(chatId)) {
          try {
            await tgSendToAdmins(
              `🆕 Новый поставщик (Telegram)\n` +
                `ID лида: ${leadId}\n` +
                `Имя: ${displayName}\n` +
                `Телефон: ${phone}\n` +
                `Chat ID: ${chatId}\n` +
                `Источник: telegram_provider\n` +
                `Открыть: https://travella.uz/admin/leads`
            );
          } catch (e) {
            console.error("[tg-link] tgSendToAdmins failed:", e?.message || e);
          }
        }

        return res.json({
          success: true,
          role: "provider_lead",
          leadId,
          existed: true,
          created: null,
          requestedRole,
        });
      }

      // 2) иначе создаём новый lead
      const insertLead = await pool.query(
        `
          INSERT INTO leads (
            phone,
            name,
            source,
            status,
            created_at,
            telegram_chat_id,
            telegram_username,
            telegram_first_name,
            requested_role
          )
          VALUES ($1, $2, 'telegram_provider', 'new', NOW(), $3, $4, $5, 'agent')
          RETURNING id
        `,
        [phone, displayName, chatId, username || null, firstName || null]
      );

      const lead = insertLead.rows[0];
      console.log("[tg-link] created NEW PROVIDER LEAD from Telegram:", lead);

      try {
        await tgSendToAdmins(
          `🆕 Новый поставщик (Telegram)\n` +
            `ID лида: ${lead.id}\n` +
            `Имя: ${displayName}\n` +
            `Телефон: ${phone}\n` +
            `Chat ID: ${chatId}\n` +
            `Источник: telegram_provider\n` +
            `Открыть: https://travella.uz/admin/leads`
        );
      } catch (e) {
        console.error("[tg-link] tgSendToAdmins failed:", e?.message || e);
      }

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
    return res.status(500).json({ error: "Internal error" });
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
      role === "provider" ? "providers" : role === "client" ? "clients" : null;

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

    return res.json({ success: true, user: result.rows[0] });
  } catch (e) {
    console.error("GET /api/telegram/profile error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

/**
 * Старый простой поиск по категории (если где-то ещё используется)
 * GET /api/telegram/client/:chatId/search-category?type=refused_tour
 */
async function searchCategory(req, res) {
  const { chatId } = req.params; // формально
  const { type } = req.query || {};

  const allowed = [
    "refused_tour",
    "refused_hotel",
    "refused_flight",
    "refused_ticket",
  ];

  if (!type || !allowed.includes(type)) {
    return res.status(400).json({ error: "invalid type" });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          s.id,
          s.provider_id,
          s.title,
          s.category,
          s.price,
          s.details,
          s.images,
          p.name AS provider_name
        FROM services s
        JOIN providers p ON p.id = s.provider_id
       WHERE s.category = $1
         AND s.status = 'approved'
       ORDER BY s.created_at DESC
       LIMIT 30
      `,
      [type]
    );

    return res.json({
      success: true,
      items: result.rows,
      chatId,
      type,
    });
  } catch (e) {
    console.error(
      "GET /api/telegram/client/:chatId/search-category error:",
      e
    );
    return res.status(500).json({ error: "Internal error" });
  }
}

/**
 * Основной поиск для бота и inline-бота
 * GET /api/telegram/client/:chatId/search?category=refused_tour
 */
async function searchClientServices(req, res) {
  try {
    const { chatId } = req.params; // формально
    const { category } = req.query || {};

    if (!category) {
      return res
        .status(400)
        .json({ success: false, error: "category is required" });
    }

    console.log("[tg-api] searchClientServices", { chatId, category });

    const result = await pool.query(
      `
        SELECT
          s.id,
          s.provider_id,
          s.title,
          s.category,
          s.status,
          s.price,
          s.details,
          s.images,
          s.expiration_at,
          s.created_at,
          p.name   AS provider_name,
          p.social AS provider_telegram
        FROM services s
        LEFT JOIN providers p ON p.id = s.provider_id
        WHERE s.category = $1
          AND s.status IN ('approved', 'published', 'active')
          AND (
            s.details IS NULL
            OR (s.details::jsonb->>'isActive') IS NULL
            OR LOWER(s.details::jsonb->>'isActive') = 'true'
          )
          AND (
            s.expiration_at IS NULL
            OR s.expiration_at > NOW()
          )
          AND (
            (s.details::jsonb->>'expiration') IS NULL
            OR (s.details::jsonb->>'expiration')::timestamp > NOW()
          )
          AND (
            COALESCE(
              (s.details::jsonb->>'endFlightDate')::date,
              (s.details::jsonb->>'endDate')::date
            ) IS NULL
            OR COALESCE(
              (s.details::jsonb->>'endFlightDate')::date,
              (s.details::jsonb->>'endDate')::date
            ) >= CURRENT_DATE
          )
        ORDER BY s.created_at DESC
        LIMIT 50
      `,
      [category]
    );

    const items = result.rows || [];
    console.log("[tg-api] searchClientServices rows:", items.length);

    return res.json({ success: true, items });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/search error:", e);
    return res.status(500).json({
      success: false,
      error: "Internal error in searchClientServices",
    });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
  searchCategory,
  searchClientServices,
};
