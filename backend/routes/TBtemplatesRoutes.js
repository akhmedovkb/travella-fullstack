// backend/routes/TBtemplatesRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// нормализация входных данных
const norm = (t = {}) => {
  const obj = (t.program_i18n && typeof t.program_i18n === 'object') ? t.program_i18n : {};
  const fromFlat = (t.program == null ? {} : { ru: String(t.program).trim() });
  const fromRu = (t.program_ru == null ? {} : { ru: String(t.program_ru).trim() });
  const fromEn = (t.program_en == null ? {} : { en: String(t.program_en).trim() });
  const fromUz = (t.program_uz == null ? {} : { uz: String(t.program_uz).trim() });
  const program_i18n = Object.fromEntries(
    Object.entries({ ...obj, ...fromFlat, ...fromRu, ...fromEn, ...fromUz })
      .map(([k,v]) => [k, String(v || '').trim()])
      .filter(([,v]) => v.length)
  );
  return {
  id: t.id || null,
  title: String(t.title || "").trim(),
  days: Array.isArray(t.days)
    ? t.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city)
    : [],
  is_public: t.is_public !== false,
  program_i18n
}};

// ---- GET /public (mounted under /api/tour-templates and /api/templates) ----
router.get("/public", async (_req, res) => {
  try {
        const q = `SELECT id, title, days, program_i18n
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
        const q = `SELECT id, title, days, program_i18n
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
      // UPDATE по id
      const q = `
        UPDATE tour_templates
           SET title = $2,
               days = $3::jsonb,
               is_public = $4,
               program_i18n = $5::jsonb,
               updated_at = now()
         WHERE id = $1
       RETURNING id, title, days, program_i18n`;
      const { rows } = await pool.query(q, [
        t.id,
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        JSON.stringify(t.program_i18n || {})
      ]);
      if (rows.length) return res.json(rows[0]); // 200

      // INSERT с указанным id
      const qi = `
        INSERT INTO tour_templates (id, title, days, is_public, program_i18n)
        VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
        ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              days = EXCLUDED.days,
              is_public = EXCLUDED.is_public,
              program_i18n = EXCLUDED.program_i18n
        RETURNING id, title, days, program_i18n`;
      const ins = await pool.query(qi, [
        t.id,
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        JSON.stringify(t.program_i18n || {})
      ]);
      return res.status(201).json(ins.rows[0]);
    } else {
      // обычный INSERT
      const q = `
        INSERT INTO tour_templates (title, days, is_public, program_i18n)
        VALUES ($1, $2::jsonb, $3, $4::jsonb)
        RETURNING id, title, days, program_i18n`;
      const { rows } = await pool.query(q, [
        t.title,
        JSON.stringify(t.days),
        t.is_public,
        JSON.stringify(t.program_i18n || {})
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
