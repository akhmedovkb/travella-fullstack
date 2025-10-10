// backend/routes/TBtemplatesRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// нормализация входных данных
const norm = (t = {}) => ({
  id: t.id || null,
  title: String(t.title || "").trim(),
  days: Array.isArray(t.days)
    ? t.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city)
    : [],
    is_public: t.is_public !== false,
  program: (t.program === null || t.program === undefined)
    ? null
    : String(t.program).trim()
});

// ---- GET /public (mounted under /api/tour-templates and /api/templates) ----
router.get("/public", async (_req, res) => {
  try {
        const q = `SELECT id, title, days, program
               FROM tour_templates
               WHERE is_public = TRUE
               ORDER BY title ASC`;
    const { rows } = await pool.query(q);
    // фронт понимает и массив, и {items:[]}; вернём просто массив
    res.json(rows);
  } catch (e) {
    console.error("GET /templates/public", e);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// ---- GET / (список публичных по умолчанию) ----
router.get("/", async (_req, res) => {
  try {
        const q = `SELECT id, title, days, program
               FROM tour_templates
               WHERE is_public = TRUE
               ORDER BY title ASC`;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (e) {
    console.error("GET /templates", e);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// ---- POST / (upsert) ----
router.post("/", async (req, res) => {
  try {
    const t = norm(req.body || {});
    if (!t.title || t.days.length === 0) {
      return res.status(400).json({ error: "title and non-empty days[] required" });
    }

    if (t.id) {
      // попытка обновить по id
      const q = `
        UPDATE tour_templates
           SET title = $2,
               days = $3::jsonb,
               is_public = $4,
               program = NULLIF($5,''),
               updated_at = now()
         WHERE id = $1
       RETURNING id, title, days, program`;
      const { rows } = await pool.query(q, [
        t.id,
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        t.program ?? null
      ]);
      if (rows.length) return res.json(rows[0]); // 200
      // если не нашли — создаём новый с указанным id
      const qi = `
        INSERT INTO tour_templates (id, title, days, is_public, program)
        VALUES ($1, $2, $3::jsonb, $4, NULLIF($5,''))
        ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              days = EXCLUDED.days,
              is_public = EXCLUDED.is_public,
              program = EXCLUDED.program
        RETURNING id, title, days, program`;
      const ins = await pool.query(qi, [
        t.id,
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        t.program ?? null
      ]);
      return res.status(201).json(ins.rows[0]);
    } else {
      // без id — обычный insert
      const q = `
        INSERT INTO tour_templates (title, days, is_public, program)
        VALUES ($1, $2::jsonb, $3, NULLIF($4,''))
        RETURNING id, title, days, program`;
      const { rows } = await pool.query(q, [
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        t.program ?? null
      ]);
      return res.status(201).json(rows[0]);
    }
  } catch (e) {
    console.error("POST /tour-templates", e);
    res.status(500).json({ error: "Failed to upsert template" });
  }
});

// ---- DELETE /:id ----
router.delete("/:id", async (req, res) => {
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
