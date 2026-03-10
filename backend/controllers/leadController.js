// backend/controllers/leadController.js

const pool = require("../db");
const { tgSend, tgSendToAdmins } = require("../utils/telegram");

const TELEGRAM_DUMMY_PASSWORD_HASH =
  process.env.TELEGRAM_DUMMY_PASSWORD_HASH ||
  "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu";

/* ================= CREATE LEAD ================= */
async function createLead(req, res) {
  try {
    const {
      name = "",
      phone = "",
      city = "",
      pax = null,
      comment = "",
      page = "",
      lang = "",
      service = "",
    } = req.body || {};

    const q = await pool.query(
      `INSERT INTO leads(name, phone, city, pax, comment, page, lang, service)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at, status`,
      [name, phone, city, pax, comment, page, lang, service]
    );

    // ✅ уведомление админам (без риска сломать создание лида)
    try {
      await tgSendToAdmins(
        `🆕 Новый лид (сайт)\n` +
          `ID: ${q.rows[0].id}\n` +
          `Имя: ${name || "—"}\n` +
          `Телефон: ${phone || "—"}\n` +
          `Город/даты: ${city || "—"}\n` +
          `Страница: ${page || "—"}\n` +
          `Язык: ${lang || "—"}\n` +
          `Открыть: https://travella.uz/admin/leads`
      );
    } catch (e) {
      console.error("[lead] tgSendToAdmins failed:", e?.message || e);
    }

    return res.json({ ok: true, id: q.rows[0].id });
  } catch (e) {
    console.error("createLead error:", e);
    return res.status(500).json({ ok: false });
  }
}

/* ================= LIST LEADS ================= */
async function listLeads(req, res) {
  try {
    const {
      status = "",
      lang = "",
      page = "",
      q = "",
      limit = "200",
    } = req.query || {};

    const where = [];
    const params = [];
    let i = 1;

    if (String(status).trim()) {
      where.push(`l.status = $${i++}`);
      params.push(String(status).trim());
    }

    if (String(lang).trim()) {
      where.push(`l.lang = $${i++}`);
      params.push(String(lang).trim());
    }

    if (String(page).trim()) {
      where.push(`l.page = $${i++}`);
      params.push(String(page).trim());
    }

    if (String(q).trim()) {
      const needle = `%${String(q).trim()}%`;

      where.push(`
        (
          COALESCE(l.name, '') ILIKE $${i}
          OR COALESCE(l.phone, '') ILIKE $${i}
          OR COALESCE(l.city, '') ILIKE $${i}
          OR COALESCE(l.comment, '') ILIKE $${i}
          OR COALESCE(l.page, '') ILIKE $${i}
          OR COALESCE(l.lang, '') ILIKE $${i}
          OR COALESCE(l.status, '') ILIKE $${i}
          OR COALESCE(l.service, '') ILIKE $${i}
          OR COALESCE(l.source, '') ILIKE $${i}
          OR COALESCE(l.requested_role, '') ILIKE $${i}
          OR COALESCE(l.decision, '') ILIKE $${i}
          OR COALESCE(l.telegram_username, '') ILIKE $${i}
          OR COALESCE(l.telegram_first_name, '') ILIKE $${i}
          OR COALESCE(CAST(l.telegram_chat_id AS TEXT), '') ILIKE $${i}

          OR COALESCE(cm.name, '') ILIKE $${i}
          OR COALESCE(cm.email, '') ILIKE $${i}
          OR COALESCE(cm.phone, '') ILIKE $${i}
          OR COALESCE(cm.telegram, '') ILIKE $${i}
          OR COALESCE(CAST(cm.telegram_chat_id AS TEXT), '') ILIKE $${i}

          OR COALESCE(pm.name, '') ILIKE $${i}
          OR COALESCE(pm.email, '') ILIKE $${i}
          OR COALESCE(pm.phone, '') ILIKE $${i}
          OR COALESCE(pm.type, '') ILIKE $${i}
          OR COALESCE(pm.social, '') ILIKE $${i}
          OR COALESCE(CAST(pm.telegram_chat_id AS TEXT), '') ILIKE $${i}
        )
      `);

      params.push(needle);
      i++;
    }

    const safeLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 200, 1),
      1000
    );

    params.push(safeLimit);

    const sql = `
      SELECT
        l.*,

        cm.id AS client_match_id,
        cm.name AS client_match_name,
        cm.email AS client_match_email,
        cm.phone AS client_match_phone,
        cm.telegram AS client_match_telegram,
        cm.telegram_chat_id AS client_match_chat_id,

        pm.id AS provider_match_id,
        pm.name AS provider_match_name,
        pm.email AS provider_match_email,
        pm.phone AS provider_match_phone,
        pm.type AS provider_match_type,
        pm.social AS provider_match_social,
        pm.telegram_chat_id AS provider_match_chat_id

      FROM leads l

      LEFT JOIN LATERAL (
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.telegram,
          c.telegram_chat_id
        FROM clients c
        WHERE
          (
            l.telegram_chat_id IS NOT NULL
            AND c.telegram_chat_id IS NOT NULL
            AND c.telegram_chat_id::text = l.telegram_chat_id::text
          )
          OR
          (
            NULLIF(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g'), '') IS NOT NULL
            AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')
                = regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g')
          )
          OR
          (
            NULLIF(TRIM(COALESCE(l.telegram_username, '')), '') IS NOT NULL
            AND LOWER(TRIM(BOTH '@' FROM COALESCE(c.telegram, '')))
                = LOWER(TRIM(BOTH '@' FROM COALESCE(l.telegram_username, '')))
          )
        ORDER BY
          CASE
            WHEN l.telegram_chat_id IS NOT NULL
             AND c.telegram_chat_id IS NOT NULL
             AND c.telegram_chat_id::text = l.telegram_chat_id::text THEN 1
            WHEN NULLIF(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g'), '') IS NOT NULL
             AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')
                 = regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') THEN 2
            WHEN NULLIF(TRIM(COALESCE(l.telegram_username, '')), '') IS NOT NULL
             AND LOWER(TRIM(BOTH '@' FROM COALESCE(c.telegram, '')))
                 = LOWER(TRIM(BOTH '@' FROM COALESCE(l.telegram_username, ''))) THEN 3
            ELSE 99
          END,
          c.id DESC
        LIMIT 1
      ) cm ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.name,
          p.email,
          p.phone,
          p.type,
          p.social,
          p.telegram_chat_id
        FROM providers p
        WHERE
          (
            l.telegram_chat_id IS NOT NULL
            AND p.telegram_chat_id IS NOT NULL
            AND p.telegram_chat_id::text = l.telegram_chat_id::text
          )
          OR
          (
            NULLIF(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g'), '') IS NOT NULL
            AND regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g')
                = regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g')
          )
          OR
          (
            NULLIF(TRIM(COALESCE(l.telegram_username, '')), '') IS NOT NULL
            AND LOWER(TRIM(BOTH '@' FROM COALESCE(p.social, '')))
                LIKE '%' || LOWER(TRIM(BOTH '@' FROM COALESCE(l.telegram_username, ''))) || '%'
          )
        ORDER BY
          CASE
            WHEN l.telegram_chat_id IS NOT NULL
             AND p.telegram_chat_id IS NOT NULL
             AND p.telegram_chat_id::text = l.telegram_chat_id::text THEN 1
            WHEN NULLIF(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g'), '') IS NOT NULL
             AND regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g')
                 = regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') THEN 2
            WHEN NULLIF(TRIM(COALESCE(l.telegram_username, '')), '') IS NOT NULL
             AND LOWER(TRIM(BOTH '@' FROM COALESCE(p.social, '')))
                 LIKE '%' || LOWER(TRIM(BOTH '@' FROM COALESCE(l.telegram_username, ''))) || '%' THEN 3
            ELSE 99
          END,
          p.id DESC
        LIMIT 1
      ) pm ON TRUE

      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY l.created_at DESC
      LIMIT $${i}
    `;

    const r = await pool.query(sql, params);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error("listLeads error:", e);
    return res.status(500).json({ ok: false });
  }
}

/* ================= UPDATE STATUS ================= */
async function updateLeadStatus(req, res) {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  if (!id || !status) {
    return res.status(400).json({ ok: false });
  }

  await pool.query(`UPDATE leads SET status=$2 WHERE id=$1`, [id, status]);
  return res.json({ ok: true });
}

/* ================= LIST PAGES ================= */
async function listLeadPages(req, res) {
  const q = await pool.query(
    `SELECT page, COUNT(*)::int AS cnt
       FROM leads
      WHERE page IS NOT NULL
      GROUP BY page`
  );
  res.json({ ok: true, items: q.rows });
}

/* ================= DECIDE LEAD ================= */
async function decideLead(req, res) {
  const id = Number(req.params.id);
  const { decision } = req.body || {};

  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  if (!["approved_provider", "approved_client", "rejected"].includes(decision)) {
    return res.status(400).json({ ok: false, error: "bad_decision" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(
      `SELECT * FROM leads WHERE id=$1 FOR UPDATE`,
      [id]
    );

    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "lead_not_found" });
    }

    const lead = leadRes.rows[0];

    if (lead.decision) {
      await db.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "already_decided" });
    }

    const name = lead.name || "Telegram user";
    const phone = lead.phone || "";
    const chatId = lead.telegram_chat_id || null;
    const username = lead.telegram_username || null;

    const phoneDigits = String(phone).replace(/\D/g, "");
    const leadSource = String(lead.source || "").toLowerCase();
    const isRefusedProviderBot = leadSource === "telegram_provider";


    function normalizeProviderType(raw) {
      const v = String(raw || "").trim().toLowerCase();
      if (!v) return "agent";
      // исторически в лидах могло храниться "provider" — приводим к "agent"
      if (v === "provider") return "agent";
      return v;
    }

      if (decision === "approved_client") {
        const exists = await db.query(
          `SELECT id FROM clients
            WHERE regexp_replace(phone,'\\D','','g') = $1
            LIMIT 1`,
          [phoneDigits]
        );
      
        if (!exists.rowCount) {
          const email = `tg_${phoneDigits || Date.now()}@telegram.local`;
      
          await db.query(
            `INSERT INTO clients (name, email, phone, password_hash, telegram_chat_id, telegram)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              name,
              email,
              phone,
              TELEGRAM_DUMMY_PASSWORD_HASH,
              chatId,
              username,
            ]
          );
        } else {
          // ✅ ВОТ СЮДА: если клиент уже существует — привязываем Telegram после модерации
          await db.query(
            `UPDATE clients
                SET telegram_chat_id = $2,
                    telegram = COALESCE($3, telegram)
              WHERE id = $1`,
            [exists.rows[0].id, chatId, username]
          );
        }
      }

      if (decision === "approved_provider") {
        const exists = await db.query(
          `SELECT id FROM providers
            WHERE regexp_replace(phone,'\\D','','g') = $1
            LIMIT 1`,
          [phoneDigits]
        );
      
        if (!exists.rowCount) {
          const email = `tg_${phoneDigits || Date.now()}@telegram.local`;
      
          // requested_role в lead (например: agent/guide/transport/hotel)
          // Важно: для турагентов хотим хранить type="agent" (а не "provider")
          const providerType = normalizeProviderType(lead.requested_role);
      
          await db.query(
            `INSERT INTO providers (name, type, phone, email, password, social, telegram_chat_id, tg_chat_id, telegram_refused_chat_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
            [
              name,
              providerType,
              phone,
              email,
              "telegram",
              username ? `@${username}` : null,
              chatId,
              isRefusedProviderBot ? chatId : null,
            ]
          );

        } else {
          // ✅ ВОТ СЮДА: если провайдер уже существует — привязываем Telegram после модерации
          // ВАЖНО: из-за trg_providers_tg_sync ставим оба поля
          await db.query(
            `UPDATE providers
                SET telegram_chat_id = $2,
                    tg_chat_id = $2,
                    telegram_refused_chat_id = CASE WHEN $4 THEN $2 ELSE telegram_refused_chat_id END,
                    social = COALESCE($3, social)
              WHERE id = $1`,
            [exists.rows[0].id, chatId, username ? `@${username}` : null, isRefusedProviderBot]
          );
        }
      }

    await db.query(
      `UPDATE leads
          SET decision=$2, decided_at=NOW(), status='closed'
        WHERE id=$1`,
      [id, decision]
    );
    if (chatId) {
      await db.query(
        `
          UPDATE leads
             SET decision  = COALESCE(decision, $2),
                 decided_at = COALESCE(decided_at, NOW()),
                 status    = 'closed'
           WHERE telegram_chat_id = $1
             AND status = 'new'
             AND decision IS NULL
        `,
        [chatId, decision]
      );
    }
    await db.query("COMMIT");

    // ✅ уведомляем пользователя в Telegram (если есть chatId)
  if (chatId) {
    // Reply keyboard (нижнее меню) — без URL
    const providerMenu = {
      keyboard: [
        ["🔍 Найти услугу", "🧳 Мои услуги"],
        ["📦 Бронирования", "🧾 Заявки"],
        ["👤 Профиль"],
      ],
      resize_keyboard: true,
    };
  
    const clientMenu = {
      keyboard: [
        ["🔍 Найти услугу"],
        ["📦 Бронирования", "👤 Профиль"],
      ],
      resize_keyboard: true,
    };
  
    if (decision === "approved_provider") {
      await tgSend(
        chatId,
        "✅ Ваша заявка одобрена!\n\nВы зарегистрированы как поставщик Travella.\nВыберите раздел в меню ниже 👇",
        { reply_markup: providerMenu }
      );
    } else if (decision === "approved_client") {
      await tgSend(
        chatId,
        "✅ Ваша заявка одобрена!\n\nДобро пожаловать в Travella.\nВыберите раздел в меню ниже 👇",
        { reply_markup: clientMenu }
      );
    } else {
      await tgSend(chatId, "❌ К сожалению, ваша заявка была отклонена.", {
        reply_markup: { remove_keyboard: true },
      });
    }
  }

    return res.json({ ok: true });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("decideLead error:", e);
    return res.status(500).json({ ok: false, error: "decide_failed" });
  } finally {
    db.release();
  }
}

/* ================= DELETE LEAD + USER (HARD RESET) ================= */
// DELETE /api/admin/leads/:id
async function deleteLeadFully(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(
      `SELECT id, phone, telegram_chat_id, telegram_username
         FROM leads
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );

    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "lead_not_found" });
    }

    const lead = leadRes.rows[0];
    const phoneDigits = String(lead.phone || "").replace(/\D/g, "");
    const chatId = lead.telegram_chat_id || null;
    const username = lead.telegram_username || null;

    // --- 1) Если есть provider по телефону — удаляем безопасно (FK)
    const provRes = await db.query(
      `SELECT id FROM providers
        WHERE regexp_replace(phone,'\\D','','g') = $1
        LIMIT 1`,
      [phoneDigits]
    );

    if (provRes.rowCount) {
      const providerId = provRes.rows[0].id;

      // blocked_dates -> NO ACTION, надо удалить вручную
      await db.query(`DELETE FROM blocked_dates WHERE provider_id = $1`, [
        providerId,
      ]);

      // leads.assignee_provider_id -> NO ACTION, надо обнулить
      await db.query(
        `UPDATE leads
            SET assignee_provider_id = NULL
          WHERE assignee_provider_id = $1`,
        [providerId]
      );

      // остальное (bookings/services/...) у тебя CASCADE/SET NULL — пусть отработает по FK
      await db.query(`DELETE FROM providers WHERE id = $1`, [providerId]);
    }

    // --- 2) Клиент по телефону
    await db.query(
      `DELETE FROM clients
        WHERE regexp_replace(phone,'\\D','','g') = $1`,
      [phoneDigits]
    );

    // --- 3) Удаляем все лиды по этому идентификатору (чтобы не оставалось хвостов)
    // (и сам текущий lead тоже уйдёт)
    if (chatId) {
      await db.query(`DELETE FROM leads WHERE telegram_chat_id = $1`, [chatId]);
    } else {
      await db.query(
        `DELETE FROM leads WHERE regexp_replace(phone,'\\D','','g') = $1`,
        [phoneDigits]
      );
    }

    await db.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("deleteLeadFully error:", e);
    return res.status(500).json({ ok: false, error: "delete_failed" });
  } finally {
    db.release();
  }
}


/* ================= EXPORT ================= */
module.exports = {
  createLead,
  listLeads,
  updateLeadStatus,
  listLeadPages,
  decideLead,
  deleteLeadFully,
};
