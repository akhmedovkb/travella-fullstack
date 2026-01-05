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
    const r = await pool.query(
      `SELECT * FROM leads ORDER BY created_at DESC LIMIT 200`
    );
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
            `INSERT INTO providers (name, type, phone, email, password, social, telegram_chat_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              name,
              providerType,
              phone,
              email,
              "telegram",
              username ? `@${username}` : null,
              chatId,
            ]
          );
        } else {
          // ✅ ВОТ СЮДА: если провайдер уже существует — привязываем Telegram после модерации
          // ВАЖНО: из-за trg_providers_tg_sync ставим оба поля
          await db.query(
            `UPDATE providers
                SET telegram_chat_id = $2,
                    tg_chat_id = $2,
                    social = COALESCE($3, social)
              WHERE id = $1`,
            [exists.rows[0].id, chatId, username ? `@${username}` : null]
          );
        }
      }

    await db.query(
      `UPDATE leads
          SET decision=$2, decided_at=NOW(), status='closed'
        WHERE id=$1`,
      [id, decision]
    );

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
