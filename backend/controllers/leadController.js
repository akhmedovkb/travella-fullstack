//backend/controllers/leadController.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");

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

    // если уже принято решение — не даём повторно
    if (lead.decision) {
      await db.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "already_decided" });
    }

    const name = lead.name || "Telegram user";
    const phone = lead.phone || "";
    const chatId = lead.telegram_chat_id || null;
    const username = lead.telegram_username || null;

    // нормализация телефона для поиска дублей
    const phoneDigits = String(phone).replace(/\D/g, "");

    if (decision === "approved_client") {
      // проверим, нет ли уже такого клиента
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
      }
    }

    if (decision === "approved_provider") {
      // проверим, нет ли уже такого провайдера
      const exists = await db.query(
        `SELECT id FROM providers
          WHERE regexp_replace(phone,'\\D','','g') = $1
          LIMIT 1`,
        [phoneDigits]
      );

      if (!exists.rowCount) {
        const email = `tg_${phoneDigits || Date.now()}@telegram.local`;

        await db.query(
          `INSERT INTO providers (name, type, phone, email, password, social, telegram_chat_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            name,
            "provider",                  // type NOT NULL
            phone,
            email,                       // email NOT NULL
            "telegram",                  // password NOT NULL (у тебя поле password)
            username ? `@${username}` : null,
            chatId,
          ]
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

    // уведомление в Telegram
    if (chatId) {
      if (decision === "approved_provider") {
        await tgSend(chatId, "✅ Ваша заявка одобрена! Вы зарегистрированы как поставщик Travella.\n\n👉 https://travella.uz/dashboard");
      } else if (decision === "approved_client") {
        await tgSend(chatId, "✅ Ваша заявка одобрена! Добро пожаловать в Travella.\n\n👉 https://travella.uz");
      } else {
        await tgSend(chatId, "❌ К сожалению, ваша заявка была отклонена.");
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


/* ================= EXPORT ================= */
module.exports = {
  createLead,
  listLeads,
  updateLeadStatus,
  listLeadPages,
  decideLead,
};
