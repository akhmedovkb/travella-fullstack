// backend/routes/TBtemplatesRoutes.js
const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL // или ваши env
});

// нормализация входных данных
const norm = (t = {}) => ({
  id: t.id || null,
  title: String(t.title || "").trim(),
  days: Array.isArray(t.days)
    ? t.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city)
    : [],
  is_public: t.is_public !== false
});

// ---- GET /api/templates/public ----
router.get(["/api/templates/public", "/api/tour-templates/public", "/api/templates", "/api/tour-templates"], async (_req, res) => {
  try {
    const q = `SELECT id, title, days FROM tour_templates WHERE is_public = TRUE ORDER BY title ASC`;
    const { rows } = await pool.query(q);
    // фронт понимает и массив, и {items:[]}; вернём просто массив
    res.json(rows);
  } catch (e) {
    console.error("GET /templates/public", e);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// ---- POST /api/tour-templates (upsert) ----
router.post(["/api/tour-templates", "/api/templates"], async (req, res) => {
  try {
    const t = norm(req.body || {});
    if (!t.title || t.days.length === 0) {
      return res.status(400).json({ error: "title and non-empty days[] required" });
    }

    if (t.id) {
      // попытка обновить по id
      const q = `
        UPDATE tour_templates
           SET title = $2, days = $3::jsonb, is_public = $4, updated_at = now()
         WHERE id = $1
       RETURNING id, title, days`;
      const { rows } = await pool.query(q, [t.id, t.title, JSON.stringify(t.days), t.is_public]);
      if (rows.length) return res.json(rows[0]); // 200
      // если не нашли — создаём новый с указанным id
      const qi = `
        INSERT INTO tour_templates (id, title, days, is_public)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title, days = EXCLUDED.days, is_public = EXCLUDED.is_public
        RETURNING id, title, days`;
      const ins = await pool.query(qi, [t.id, t.title, JSON.stringify(t.days), t.is_public]);
      return res.status(201).json(ins.rows[0]);
    } else {
      // без id — обычный insert
      const q = `
        INSERT INTO tour_templates (title, days, is_public)
        VALUES ($1, $2::jsonb, $3)
        RETURNING id, title, days`;
      const { rows } = await pool.query(q, [t.title, JSON.stringify(t.days), t.is_public]);
      return res.status(201).json(rows[0]);
    }
  } catch (e) {
    console.error("POST /tour-templates", e);
    res.status(500).json({ error: "Failed to upsert template" });
  }
});

// ---- DELETE /api/tour-templates/:id ----
router.delete(["/api/tour-templates/:id", "/api/templates/:id"], async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM tour_templates WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /tour-templates/:id", e);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

module.exports = router;
