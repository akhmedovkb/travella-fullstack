// backend/controllers/telegramClientController.js
const pool = require("../db");

/**
 * Технический bcrypt-хэш какого-то "левого" пароля,
 * чтобы удовлетворить NOT NULL и формат для bcrypt.compare.
 * Пользователь этот пароль не знает, и он ему не нужен,
 * пока он не задаст себе нормальный пароль через веб.
 *
 * Это пример рабочего bcrypt-хэша для строки "password".
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
 * Ищем пользователя по телефону.
 * Сначала среди providers, потом среди clients.
 */
async function findUserByPhone(normPhone) {
  // 1) Поставщик
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

  // 2) Клиент
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
    const displayName = firstName || username || "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log(
      "[tg-link] normPhone:",
      normPhone,
      "requestedRole:",
      requestedRole
    );

    // 1) Уже есть в базе?
    const found = await findUserByPhone(normPhone);

    if (found) {
      const foundRole = found.role; // 'provider' | 'client'

      // ----- ПРОВАЙДЕР -----
      if (foundRole === "provider") {
        const upd = await pool.query(
          `
            UPDATE providers
               SET telegram_chat_id = $1,
                   social           = COALESCE($2, social)
             WHERE regexp_replace(phone, '\\D', '', 'g') = $3
             RETURNING id, name, phone, social
          `,
          [chatId, username ? `@${username}` : null, normPhone]
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

      // ----- КЛИЕНТ -----
      if (foundRole === "client") {
        const upd = await pool.query(
          `
            UPDATE clients
               SET telegram_chat_id = $1,
                   telegram        = COALESCE($2, telegram)
             WHERE regexp_replace(phone, '\\D', '', 'g') = $3
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

// --- новый ПОСТАВЩИК: создаём lead ---
if (requestedRole === "provider") {
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
      VALUES ($1, $2, 'telegram_provider', 'new', NOW(), $3, $4, $5, 'provider')
      RETURNING id
    `,
    [phone, displayName, chatId, username || null, firstName || null]
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
      role === "provider"
        ? "providers"
        : role === "client"
        ? "clients"
        : null;

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
 * Старый простой поиск по категории (если где-то ещё используется)
 * GET /api/telegram/client/:chatId/search-category?type=refused_tour
 */
async function searchCategory(req, res) {
  const { chatId } = req.params; // пока не используем
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

    console.log("[tg-api] searchClientServices", {
      chatId,
      category,
    });

    const result = await pool.query(
      `
        SELECT
          s.id,
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
          -- 1) Явно снятые с продажи услуги (isActive=false) НЕ показываем
          AND (
            s.details IS NULL
            OR (s.details::jsonb->>'isActive') IS NULL
            OR LOWER(s.details::jsonb->>'isActive') = 'true'
          )
          -- 2) Тайм-лимит: expiration_at в таблице services
          AND (
            s.expiration_at IS NULL
            OR s.expiration_at > NOW()
          )
          -- 3) Тайм-лимит: expiration в JSON details (старый формат)
          AND (
            (s.details::jsonb->>'expiration') IS NULL
            OR (s.details::jsonb->>'expiration')::timestamp > NOW()
          )
          -- 4) Даты тура/перелёта: если тур уже закончился, не показываем
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

    return res.json({
      success: true,
      items,
    });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/search error:", e);
    return res.status(500).json({
      success: false,
      error: "Internal error in searchClientServices",
    });
  }
}

/* ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПРОВАЙДЕРСКОЙ ПАНЕЛИ В БОТЕ ===== */

function parseDetails(details) {
  if (!details) return {};
  if (typeof details === "object") return { ...details };
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
}

function formatDateYYYYMMDD(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadProviderServiceByChat(serviceId, chatId) {
  const q = `
    SELECT
      s.id,
      s.title,
      s.category,
      s.status,
      s.details,
      s.images,
      s.expiration,
      s.created_at,
      p.name   AS provider_name,
      p.social AS provider_telegram
    FROM services s
    JOIN providers p ON p.id = s.provider_id
   WHERE s.id = $1
     AND p.telegram_chat_id = $2
   LIMIT 1
  `;
  const { rows } = await pool.query(q, [serviceId, chatId]);
  return rows[0] || null;
}

/**
 * GET /api/telegram/provider/:chatId/services
 * Список маркетплейс-услуг (отказные туры/отели/авиабилеты/билеты)
 * для поставщика, привязанного к telegram_chat_id = :chatId
 */
async function getProviderServices(req, res) {
  const { chatId } = req.params;

  try {
    const refusedCategories = [
      "refused_tour",
      "refused_hotel",
      "refused_flight",
      "refused_ticket",
    ];

    const q = `
      SELECT
        s.id,
        s.title,
        s.category,
        s.status,
        s.details,
        s.images,
        s.expiration_at AS expiration,
        s.created_at,
        p.name   AS provider_name,
        p.social AS provider_telegram
      FROM services s
      JOIN providers p ON p.id = s.provider_id
     WHERE p.telegram_chat_id = $1
       AND s.category = ANY($2)
     ORDER BY s.created_at DESC
    `;

    const { rows } = await pool.query(q, [chatId, refusedCategories]);

    return res.json({
      success: true,
      items: rows || [],
    });
  } catch (e) {
    console.error("[telegram] getProviderServices error:", e);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

/**
 * POST /api/telegram/provider/service/:serviceId/toggle-active
 * body: { chatId }
 * Переключаем details.isActive (true/false)
 */
async function toggleProviderServiceActive(req, res) {
  const serviceId = Number(req.params.serviceId);
  const chatId = String(req.body.chatId || "");

  if (!serviceId || !chatId) {
    return res.status(400).json({ success: false, error: "BAD_INPUT" });
  }

  try {
    const row = await loadProviderServiceByChat(serviceId, chatId);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "NOT_FOUND_OR_FORBIDDEN" });
    }

    const details = parseDetails(row.details);
    const currentActive = details.isActive !== false; // по умолчанию true
    details.isActive = !currentActive;

    await pool.query(`UPDATE services SET details = $1 WHERE id = $2`, [
      JSON.stringify(details),
      serviceId,
    ]);

    const updated = await loadProviderServiceByChat(serviceId, chatId);

    return res.json({
      success: true,
      service: updated,
    });
  } catch (e) {
    console.error("[telegram] toggleProviderServiceActive error:", e);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

/**
 * POST /api/telegram/provider/service/:serviceId/extend-7
 * body: { chatId }
 * Продлеваем expiration ещё на 7 дней
 */
async function extendProviderServiceExpiration7(req, res) {
  const serviceId = Number(req.params.serviceId);
  const chatId = String(req.body.chatId || "");

  if (!serviceId || !chatId) {
    return res.status(400).json({ success: false, error: "BAD_INPUT" });
  }

  try {
    const row = await loadProviderServiceByChat(serviceId, chatId);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "NOT_FOUND_OR_FORBIDDEN" });
    }

    const details = parseDetails(row.details);

    let baseDate = null;
    if (details.expiration) {
      const d = new Date(details.expiration);
      if (!Number.isNaN(d.getTime())) baseDate = d;
    }
    if (!baseDate && row.expiration) {
      const d = new Date(row.expiration);
      if (!Number.isNaN(d.getTime())) baseDate = d;
    }
    if (!baseDate) {
      baseDate = new Date();
    }

    const newDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const newExpiration = formatDateYYYYMMDD(newDate);

    details.expiration = newExpiration;

    await pool.query(
      `UPDATE services SET details = $1, expiration = $2 WHERE id = $3`,
      [JSON.stringify(details), newExpiration, serviceId]
    );

    const updated = await loadProviderServiceByChat(serviceId, chatId);

    return res.json({
      success: true,
      service: updated,
    });
  } catch (e) {
    console.error(
      "[telegram] extendProviderServiceExpiration7 error:",
      e
    );
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

/**
 * POST /api/telegram/provider/service/:serviceId/archive
 * body: { chatId }
 * Переводим статус в archived + isActive = false
 */
async function archiveProviderService(req, res) {
  const serviceId = Number(req.params.serviceId);
  const chatId = String(req.body.chatId || "");

  if (!serviceId || !chatId) {
    return res.status(400).json({ success: false, error: "BAD_INPUT" });
  }

  try {
    const row = await loadProviderServiceByChat(serviceId, chatId);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "NOT_FOUND_OR_FORBIDDEN" });
    }

    const details = parseDetails(row.details);
    details.isActive = false;

    await pool.query(
      `UPDATE services SET details = $1, status = $2 WHERE id = $3`,
      [JSON.stringify(details), "archived", serviceId]
    );

    const updated = await loadProviderServiceByChat(serviceId, chatId);

    return res.json({
      success: true,
      service: updated,
    });
  } catch (e) {
    console.error("[telegram] archiveProviderService error:", e);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
  searchCategory,
  searchClientServices,
  // новое:
  getProviderServices,
  toggleProviderServiceActive,
  extendProviderServiceExpiration7,
  archiveProviderService,
};
