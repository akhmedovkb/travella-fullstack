//backend/routes/cmsRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
// middleware экспортируется функцией, без именованных экспортов
const authenticateToken = require("../middleware/authenticateToken");

// helper: выбрать поля под язык
function pickLang(row, lang = "ru") {
  const safe = (s) => (s && String(s)) || "";
  const t = { ru: "ru", uz: "uz", en: "en" }[String(lang).toLowerCase()] || "ru";
  return {
    slug: row.slug,
    title: safe(row[`title_${t}`]),
    body:  safe(row[`body_${t}`]),
    updated_at: row.updated_at,
    published: !!row.published,
  };
}

// Публично: список для подвала (только заголовки)
router.get("/pages", async (req, res) => {
  const lang = req.query.lang || "ru";
  const q = await pool.query(
    "SELECT slug, title_ru, title_uz, title_en, published, updated_at FROM cms_pages WHERE published = TRUE ORDER BY slug"
  );
  res.json(q.rows.map(r => pickLang(r, lang)));
});

// Публично: конкретная страница
router.get("/pages/:slug", async (req, res) => {
  const { slug } = req.params;
  const lang = req.query.lang || "ru";
  const q = await pool.query("SELECT * FROM cms_pages WHERE slug = $1 LIMIT 1", [slug]);
  if (!q.rowCount) return res.status(404).json({ error: "Not found" });
  res.json(pickLang(q.rows[0], lang));
});

// --- Админ/модератор/пермишен cms:edit
function canEditCms(user) {
  if (!user) return false;
  if (user.is_admin || user.is_moderator) return true;
  const perms = (user.permissions || []).map((x) => String(x).toLowerCase());
  return perms.includes('cms:edit');
}

// создать/обновить
router.put("/pages/:slug", authenticateToken, async (req, res) => {
  const { slug } = req.params;
  if (!canEditCms(req.user)) return res.status(403).json({ error: "forbidden" });

  const {
    title_ru, title_uz, title_en,
    body_ru, body_uz, body_en,
    published = true
  } = req.body || {};

  const q = await pool.query(
    `INSERT INTO cms_pages (slug, title_ru, title_uz, title_en, body_ru, body_uz, body_en, published, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (slug) DO UPDATE SET
       title_ru = COALESCE($2, cms_pages.title_ru),
       title_uz = COALESCE($3, cms_pages.title_uz),
       title_en = COALESCE($4, cms_pages.title_en),
       body_ru  = COALESCE($5, cms_pages.body_ru),
       body_uz  = COALESCE($6, cms_pages.body_uz),
       body_en  = COALESCE($7, cms_pages.body_en),
       published= COALESCE($8, cms_pages.published),
       updated_by = $9,
       updated_at = NOW()
     RETURNING *`,
    [slug, title_ru, title_uz, title_en, body_ru, body_uz, body_en, published, req.user.id]
  );
  res.json(q.rows[0]);
});

// переключить публикацию
router.patch("/pages/:slug/publish", authenticateToken, async (req, res) => {
  if (!canEditCms(req.user)) return res.status(403).json({ error: "forbidden" });
  const { slug } = req.params;
  const { published } = req.body;
  const q = await pool.query(
    "UPDATE cms_pages SET published = $2, updated_by = $3, updated_at = NOW() WHERE slug = $1 RETURNING *",
    [slug, !!published, req.user.id]
  );
  res.json(q.rows[0] || null);
});

module.exports = router;
