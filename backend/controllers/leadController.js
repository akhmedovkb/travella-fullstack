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

  if (!["approved_provider", "approved_client", "rejected"].includes(decision)) {
    return res.status(400).json({ ok: false });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const leadRes = await client.query(
      `SELECT * FROM leads WHERE id=$1 FOR UPDATE`,
      [id]
    );

    if (!leadRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false });
    }

    const lead = leadRes.rows[0];

    if (decision === "approved_client") {
      await client.query(
        `INSERT INTO clients(name, phone, password_hash, telegram_chat_id)
         VALUES($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [
          lead.name || "Telegram user",
          lead.phone,
          TELEGRAM_DUMMY_PASSWORD_HASH,
          lead.telegram_chat_id,
        ]
      );
    }

    if (decision === "approved_provider") {
      await client.query(
        `INSERT INTO providers(name, phone, password, telegram_chat_id)
         VALUES($1,$2,'telegram',$3)
         ON CONFLICT DO NOTHING`,
        [
          lead.name || "Telegram user",
          lead.phone,
          lead.telegram_chat_id,
        ]
      );
    }

    await client.query(
      `UPDATE leads
          SET decision=$2, decided_at=NOW(), status='closed'
        WHERE id=$1`,
      [id, decision]
    );

    await client.query("COMMIT");

    if (lead.telegram_chat_id) {
      await tgSend(
        lead.telegram_chat_id,
        decision === "rejected"
          ? "❌ Ваша заявка отклонена."
          : "✅ Ваша заявка одобрена! Добро пожаловать в Travella."
      );
    }

    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("decideLead error:", e);
    res.status(500).json({ ok: false });
  } finally {
    client.release();
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
