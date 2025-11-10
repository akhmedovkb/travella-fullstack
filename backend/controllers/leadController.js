// backend/controllers/leadController.js
const pool = require("../db");
const { notifyLeadNew } = require("../utils/telegram");

// POST /api/leads  (публично с лендингов)
exports.createLead = async (req, res) => {
  try {
    const {
      name = "",
      phone = "",
      city = "",
      pax = null,
      comment = "",
      page = "",
      lang = "",
      // может приходить из лендинга, в БД может и не быть такой колонки — в уведомлении пригодится
      service = ""
    } = req.body || {};

    const q = await pool.query(
      `INSERT INTO leads(name, phone, city, pax, comment, page, lang)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at, status`,
      [name, phone, city, pax, comment, page, lang]
    );
    // телеграм-уведомление админам (не влияет на ответ API)
    try {
      const lead = {
        id: q.rows[0]?.id,
        created_at: q.rows[0]?.created_at,
        status: q.rows[0]?.status,
        name, phone, city, pax, comment, page, lang, service,
      };
      await notifyLeadNew({ lead });
    } catch (e) {
      console.warn("[tg] lead notify failed:", e?.message || e);
    }

    return res.json({ ok: true, id: q.rows[0].id });
  } catch (e) {
    console.error("createLead error:", e);
    return res.status(500).json({ ok: false, error: "create_failed" });
  }
};

// GET /api/leads  (под админ/модератором)
exports.listLeads = async (req, res) => {
  try {
    const { status, q = "", page = "", lang = "" } = req.query || {};

    const where = [];
    const vals = [];
    let i = 1;

    if (status && status !== "all") {
      where.push(`status = $${i++}`);
      vals.push(status);
    }
    if (page && page !== "any") {
      where.push(`page = $${i++}`);
      vals.push(page);
    }
    if (lang) {
      // точное совпадение кода языка (ru/uz/en)
      where.push(`lang = $${i++}`);
      vals.push(lang);
    }
    if (q) {
      where.push(
        `(coalesce(name,'') ILIKE $${i} OR coalesce(phone,'') ILIKE $${i} OR coalesce(comment,'') ILIKE $${i} OR coalesce(page,'') ILIKE $${i})`
      );
      vals.push(`%${q}%`);
      i++;
    }

    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql =
      `SELECT id, created_at, name, phone, city, pax, comment, page, lang, status
         FROM leads
         ${sqlWhere}
        ORDER BY created_at DESC
        LIMIT 200`;

    const r = await pool.query(sql, vals);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error("listLeads error:", e);
    return res.status(500).json({ ok: false, error: "list_failed", items: [] });
  }
};

// PATCH /api/leads/:id  (смена статуса)
exports.updateLeadStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!Number.isFinite(id) || !status) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }

    await pool.query(`UPDATE leads SET status=$2 WHERE id=$1`, [id, status]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("updateLeadStatus error:", e);
    return res.status(500).json({ ok: false, error: "update_failed" });
  }
};

// GET /api/leads/pages  — список уникальных страниц с лидами
exports.listLeadPages = async (_req, res) => {
  try {
    const q = await pool.query(
      `SELECT page, COUNT(*)::int AS cnt
         FROM leads
        WHERE coalesce(page,'') <> ''
        GROUP BY page
        ORDER BY cnt DESC, page ASC
        LIMIT 500`
    );
    return res.json({ ok: true, items: q.rows });
  } catch (e) {
    console.error("listLeadPages error:", e);
    return res.status(500).json({ ok: false, items: [] });
  }
}
