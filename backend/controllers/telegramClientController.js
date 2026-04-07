// backend/controllers/telegramClientController.js

const pool = require("../db");
const { tgSendToAdmins } = require("../utils/telegram");

const SITE_PUBLIC_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ||
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  ""
).replace(/\/+$/, "");

function publicBase() {
  return SITE_PUBLIC_URL || API_PUBLIC_URL || "https://travella.uz";
}

/**
 * Технический bcrypt-хэш "левого" пароля (для соблюдения NOT NULL и bcrypt.compare).
 * Пользователь этот пароль не знает и не использует (до установки через веб).
 */
const TELEGRAM_DUMMY_PASSWORD_HASH =
  process.env.TELEGRAM_DUMMY_PASSWORD_HASH ||
  "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu";

// 🔐 SAFE DATE PARSER (never throws)
function safeParseDate(val) {
  if (!val || typeof val !== "string") return null;

  // expected YYYY-MM-DD
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  let [, y, a, b] = m;
  let mm = Number(a);
  let dd = Number(b);

  // 🔁 swap if month > 12 (e.g. 2026-16-01)
  if (mm > 12 && dd <= 12) {
    [mm, dd] = [dd, mm];
  }

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  return new Date(`${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
}

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
    SELECT id, name, phone, telegram_chat_id, tg_chat_id
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
    tg_chat_id: row.tg_chat_id,
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

/** Ищем пользователя по chatId (сначала providers, потом clients) */
async function findUserByChat(chatId) {
  // providers: telegram_chat_id OR tg_chat_id
  const prov = await pool.query(
    `
      SELECT id, name, phone, telegram_chat_id, tg_chat_id
        FROM providers
       WHERE telegram_chat_id = $1 OR tg_chat_id = $1
       LIMIT 1
    `,
    [chatId]
  );
  if (prov.rowCount) {
    const row = prov.rows[0];
    return { role: "provider", ...row };
  }

  const cli = await pool.query(
    `
      SELECT id, name, phone, telegram_chat_id
        FROM clients
       WHERE telegram_chat_id = $1
       LIMIT 1
    `,
    [chatId]
  );
  if (cli.rowCount) {
    const row = cli.rows[0];
    return { role: "client", ...row };
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
/**
 * POST /api/telegram/link
 * body: { role: "client" | "provider", phone, chatId, username, firstName }
 *
 * ЖЕЛЕЗОБЕТОН:
 * - До модерации НЕ привязываем chatId к clients/providers.
 * - Всегда создаём lead(status='new', decision NULL) и возвращаем *_lead
 * - Исключение: если chatId уже привязан к существующему аккаунту — пускаем сразу.
 */
async function linkAccount(req, res) {
  try {
    const { role, phone, chatId, username, firstName } = req.body || {};
    const normPhone = normalizePhone(phone);

    if (!normPhone || !chatId) {
      return res.status(400).json({ error: "phone and chatId are required" });
    }

    const requestedRole = normalizeRequestedRole(role || "client"); // provider -> agent
    const displayName = firstName || username || "Telegram user";

    console.log("[tg-link] body:", req.body);
    console.log("[tg-link] normPhone:", normPhone, "requestedRole:", requestedRole);

    // helper: pending lead by chat
    async function findPendingLeadByChat() {
      const q = await pool.query(
        `
          SELECT id, phone, source, requested_role
            FROM leads
           WHERE telegram_chat_id = $1
             AND status = 'new'
             AND decision IS NULL
           ORDER BY id DESC
           LIMIT 1
        `,
        [chatId]
      );
      return q.rowCount ? q.rows[0] : null;
    }

    // helper: upsert pending lead (dedupe по chatId, потом по телефону)
    async function upsertPendingLead({ source, requested_role }) {
      // 1) уже есть pending по chatId
      const pending = await findPendingLeadByChat();
      if (pending) {
        await pool.query(
          `
            UPDATE leads
               SET phone = $2,
                   name = $3,
                   source = $4,
                   requested_role = $5,
                   telegram_username = $6,
                   telegram_first_name = $7
             WHERE id = $1
          `,
          [
            pending.id,
            phone,
            displayName,
            source,
            requested_role,
            username || null,
            firstName || null,
          ]
        );
        return pending.id;
      }

      // 2) pending по телефону
      const byPhone = await pool.query(
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

      if (byPhone.rowCount) {
        const leadId = byPhone.rows[0].id;
        const prevChat = byPhone.rows[0].telegram_chat_id || null;

        await pool.query(
          `
            UPDATE leads
               SET telegram_chat_id = $2,
                   telegram_username = $3,
                   telegram_first_name = $4,
                   name = COALESCE(NULLIF(name,''), $5),
                   phone = COALESCE(NULLIF(phone,''), $6),
                   source = COALESCE(NULLIF(source,''), $7),
                   requested_role = COALESCE(NULLIF(requested_role,''), $8)
             WHERE id = $1
          `,
          [
            leadId,
            chatId,
            username || null,
            firstName || null,
            displayName,
            phone,
            source,
            requested_role,
          ]
        );

        // уведомим админов только если сменился chatId (чтобы не спамить)
        if (!prevChat || String(prevChat) !== String(chatId)) {
          try {
            await tgSendToAdmins(
              `🆕 Заявка из Telegram (обновление)\n` +
                `ID лида: ${leadId}\n` +
                `Имя: ${displayName}\n` +
                `Телефон: ${phone}\n` +
                `Chat ID: ${chatId}\n` +
                `Источник: ${source}\n` +
                `Роль: ${requested_role}\n` +
                `Открыть: https://travella.uz/admin/leads`
            );
          } catch (e) {
            console.error("[tg-link] tgSendToAdmins failed:", e?.message || e);
          }
        }

        return leadId;
      }

      // 3) создать новый lead
      const ins = await pool.query(
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
          VALUES ($1,$2,$3,'new',NOW(),$4,$5,$6,$7)
          RETURNING id
        `,
        [
          phone,
          displayName,
          source,
          chatId,
          username || null,
          firstName || null,
          requested_role,
        ]
      );

      const leadId = ins.rows[0].id;

      try {
        await tgSendToAdmins(
          `🆕 Новая заявка из Telegram\n` +
            `ID лида: ${leadId}\n` +
            `Имя: ${displayName}\n` +
            `Телефон: ${phone}\n` +
            `Chat ID: ${chatId}\n` +
            `Источник: ${source}\n` +
            `Роль: ${requested_role}\n` +
            `Открыть: https://travella.uz/admin/leads`
        );
      } catch (e) {
        console.error("[tg-link] tgSendToAdmins failed:", e?.message || e);
      }

      return leadId;
    }

    // 0) если chatId уже привязан к аккаунту — пускаем сразу (важнее любых pending lead)
const byChat = await findUserByChat(chatId);
if (byChat?.role === "provider") {
  await pool.query(
    `UPDATE providers SET social = COALESCE($1, social) WHERE id = $2`,
    [username ? `@${username}` : null, byChat.id]
  );
  return res.json({
    success: true,
    role: "provider",
    id: byChat.id,
    name: byChat.name,
    existed: true,
    requestedRole,
    alreadyLinked: true,
    byChat: true,
  });
}

if (byChat?.role === "client") {
  await pool.query(
    `UPDATE clients SET telegram = COALESCE($1, telegram) WHERE id = $2`,
    [username || null, byChat.id]
  );
  return res.json({
    success: true,
    role: "client",
    id: byChat.id,
    name: byChat.name,
    existed: true,
    requestedRole,
    alreadyLinked: true,
    byChat: true,
  });
}

    
    // 0) если уже есть pending по chatId — возвращаем lead
    const pendingByChat = await findPendingLeadByChat();
    if (pendingByChat) {
      return res.json({
        success: true,
        role:
          pendingByChat.source === "telegram_provider"
            ? "provider_lead"
            : "client_lead",
        leadId: pendingByChat.id,
        existed: true,
        created: null,
        requestedRole,
        pending: true,
      });
    }

    // 1) проверяем пользователя по телефону
    const found = await findUserByPhone(normPhone);

    // ===== ПРОВАЙДЕР НАЙДЕН =====
    if (found && found.role === "provider") {
      const alreadyLinked =
        String(found.telegram_chat_id || "") === String(chatId) ||
        String(found.tg_chat_id || "") === String(chatId);

      // ✅ если уже привязан — пускаем
      if (alreadyLinked) {
        // можно мягко обновить social, это не влияет на доступ
        await pool.query(
          `UPDATE providers SET social = COALESCE($1, social) WHERE id = $2`,
          [username ? `@${username}` : null, found.id]
        );

        return res.json({
          success: true,
          role: "provider",
          id: found.id,
          name: found.name,
          existed: true,
          requestedRole,
          alreadyLinked: true,
        });
      }

      // ❌ иначе — только lead на модерацию (не трогаем providers)
      const leadId = await upsertPendingLead({
        source: "telegram_provider",
        requested_role: requestedRole === "client" ? "agent" : requestedRole,
      });

      return res.json({
        success: true,
        role: "provider_lead",
        leadId,
        existed: true,
        created: null,
        requestedRole,
        alreadyLinked: false,
      });
    }

    // ===== КЛИЕНТ НАЙДЕН =====
    if (found && found.role === "client") {
      const alreadyLinked = String(found.telegram_chat_id || "") === String(chatId);

      // ✅ если уже привязан — пускаем
      if (alreadyLinked) {
        await pool.query(
          `UPDATE clients SET telegram = COALESCE($1, telegram) WHERE id = $2`,
          [username || null, found.id]
        );

        return res.json({
          success: true,
          role: "client",
          id: found.id,
          name: found.name,
          existed: true,
          requestedRole,
          alreadyLinked: true,
        });
      }

      // ❌ иначе — lead на модерацию (не трогаем clients)
      const leadId = await upsertPendingLead({
        source: "telegram_client",
        requested_role: "client",
      });

      return res.json({
        success: true,
        role: "client_lead",
        leadId,
        existed: true,
        created: null,
        requestedRole,
        alreadyLinked: false,
      });
    }

    // ===== ТЕЛЕФОН НЕ НАЙДЕН: ВСЕГДА lead =====
    if (!requestedRole || requestedRole === "client") {
      const leadId = await upsertPendingLead({
        source: "telegram_client",
        requested_role: "client",
      });

      return res.json({
        success: true,
        role: "client_lead",
        leadId,
        existed: false,
        created: "client_lead",
        requestedRole,
      });
    }

    // любые provider-типы: agent/guide/transport/hotel — всё через lead
    const leadId = await upsertPendingLead({
      source: "telegram_provider",
      requested_role: requestedRole,
    });

    return res.json({
      success: true,
      role: "provider_lead",
      leadId,
      existed: false,
      created: "provider_lead",
      requestedRole,
    });
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
      table === "providers"
        ? `
            SELECT id, name, phone, telegram_chat_id
              FROM providers
             WHERE telegram_chat_id = $1 OR tg_chat_id = $1
             LIMIT 1
          `
        : `
            SELECT id, name, phone, telegram_chat_id
              FROM clients
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
          AND s.deleted_at IS NULL
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
        ORDER BY
          s.created_at DESC
        LIMIT 200
      `,
      [category]
    );

    const items = result.rows || [];
    console.log("[tg-api] searchClientServices rows:", items.length);

    const base = publicBase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const PLACEHOLDER = `${base}/api/telegram/placeholder.png`;

    const normalized = items
      .filter((row) => {
        const det = row.details || {};

        const cat = String(row.category || "").toLowerCase();
        const isRefused = cat.startsWith("refused_") || cat === "author_tour";

        const start =
          safeParseDate(det.departureFlightDate) ||
          safeParseDate(det.departureDate) ||
          safeParseDate(det.startFlightDate) ||
          safeParseDate(det.startDate) ||
          safeParseDate(det.checkInDate) ||
          safeParseDate(det.eventDate);

        const end =
          safeParseDate(det.returnFlightDate) ||
          safeParseDate(det.endFlightDate) ||
          safeParseDate(det.endDate) ||
          safeParseDate(det.checkOutDate);

        if (isRefused) {
          if (start) return start >= today;
          if (end) return end >= today;
          return true;
        }

        if (!end) return true;
        return end >= today;
      })
      .map((row) => {
        let imgs = row.images;

        if (!imgs) imgs = [];
        if (typeof imgs === "string") {
          try {
            imgs = JSON.parse(imgs);
          } catch {
            imgs = [imgs];
          }
        }
        if (!Array.isArray(imgs)) imgs = [];

        const hasAny = imgs.some((x) => typeof x === "string" && x.trim());

        const imageUrl = hasAny
          ? `${base}/api/telegram/service-image/${row.id}`
          : PLACEHOLDER;

        return {
          ...row,
          images: imgs,
          imageUrl,
        };
      });

    return res.json({ success: true, items: normalized });
  } catch (e) {
    console.error("GET /api/telegram/client/:chatId/search error:", e);
    return res.status(500).json({
      success: false,
      error: "Internal error in searchClientServices",
    });
  }
}
async function createQuickRequestFromTelegram(req, res) {
  try {
    const { serviceId, chatId, message, username, firstName, lastName } = req.body || {};
    if (!serviceId || !chatId || !message) {
      return res.status(400).json({ success: false });
    }

    // client по telegram_chat_id
    const c = await pool.query(
      "SELECT id FROM clients WHERE telegram_chat_id = $1 LIMIT 1",
      [String(chatId)]
    );
    if (!c.rowCount) {
      return res.status(403).json({ success: false, reason: "client_not_linked" });
    }

    const clientId = c.rows[0].id;

    // услуга
    const s = await pool.query(
      "SELECT provider_id FROM services WHERE id = $1 LIMIT 1",
      [serviceId]
    );
    if (!s.rowCount) {
      return res.status(404).json({ success: false, reason: "service_not_found" });
    }

    // создаём request
    const ins = await pool.query(
      `INSERT INTO requests (service_id, client_id, message, status, created_at)
       VALUES ($1, $2, $3, 'new', NOW())
       RETURNING id`,
      [serviceId, clientId, message]
    );

    const requestId = ins.rows[0].id;

    // уведомляем владельца (через уже существующую логику)
    try {
      await notifyReqNew({ requestId });
    } catch (_) {}

    return res.json({ success: true, requestId });
  } catch (e) {
    console.error("createQuickRequestFromTelegram error:", e);
    return res.status(500).json({ success: false });
  }
}

module.exports = {
  linkAccount,
  getProfileByChat,
  searchCategory,
  createQuickRequestFromTelegram,
  searchClientServices,
};
