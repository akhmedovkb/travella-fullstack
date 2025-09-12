// routes/marketplaceSectionsRoutes.js
const express = require('express');
const router = express.Router();

// Ожидаем, что у тебя есть пул PG в ../db
//   module.exports = { pool }  // pool = new Pool({ ... })
const { pool } = require('../db'); // поправь путь, если отличается

/* ===== helpers (идентичны фронтовой логике) ===== */

function parseMaybeJSON(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
  return {};
}
function parseDetails(svc) {
  return parseMaybeJSON(svc?.details);
}
function resolveExpireAt(service) {
  const s = service || {};
  const d = parseDetails(s);
  const cand = [
    s.expires_at, s.expire_at, s.expireAt,
    d.expires_at, d.expire_at, d.expiresAt,
    d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs,
  ].find((v) => v !== undefined && v !== null && String(v).trim?.() !== '');
  let ts = null;
  if (cand !== undefined && cand !== null) {
    if (typeof cand === 'number') ts = cand > 1e12 ? cand : cand * 1000;
    else {
      const parsed = Date.parse(String(cand));
      if (!Number.isNaN(parsed)) ts = parsed;
    }
  }
  if (!ts) {
    const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? null;
    if (ttl && Number(ttl) > 0 && s.created_at) {
      const created = Date.parse(s.created_at);
      if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
    }
  }
  return ts;
}
function pickStartDate(s) {
  const d = parseDetails(s);
  const bag = { ...d, ...s };
  const left =
    bag.hotel_check_in ?? bag.checkIn ?? bag.startDate ??
    bag.start_flight_date ?? bag.startFlightDate ?? bag.departureFlightDate;
  if (!left) return null;
  const parsed = Date.parse(String(left));
  return Number.isNaN(parsed) ? null : parsed;
}

/* ===== /api/marketplace/sections/:section ===== */
router.get('/:section', async (req, res) => {
  const { section } = req.params; // top | new | upcoming
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 48);
  const category = (req.query.category || '').trim();

  try {
    const params = [];
    let where = `WHERE status = 'published'`;

    if (category) {
      params.push(category);
      // Пытаемся матчить и по колонке category, и по JSONB details->>'category'
      where += ` AND (category = $${params.length} OR (details->>'category') = $${params.length})`;
    }

    // Берём побольше, потому что дальше сортируем/фильтруем в JS (логика видимости и upcoming сложная)
    const sql = `
      SELECT id, title, status, details, created_at, provider_id, mod_points, category
      FROM services
      ${where}
      ORDER BY created_at DESC
      LIMIT 500
    `;
    const { rows } = await pool.query(sql, params);

    const now = Date.now();
    // Фильтрация видимости (isActive/expire)
    const filtered = rows
      .map(r => ({ ...r, details: parseMaybeJSON(r.details) }))
      .filter(svc => {
        const d = parseDetails(svc);
        if (d.isActive === false) return false;
        const exp = resolveExpireAt(svc);
        return exp ? now <= exp : true;
      });

    // Сортировка по секции
    let sorted = filtered;
    if (section === 'top') {
      sorted = [...filtered].sort((a, b) =>
        (Number(b.mod_points || 0) - Number(a.mod_points || 0)) ||
        (new Date(b.created_at) - new Date(a.created_at))
      );
    } else if (section === 'new') {
      sorted = [...filtered].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
    } else if (section === 'upcoming') {
      sorted = [...filtered].sort((a, b) => {
        const sa = pickStartDate(a) ?? Infinity;
        const sb = pickStartDate(b) ?? Infinity;
        return sa - sb;
      });
    } else {
      return res.json({ items: [], total: 0, page });
    }

    // Пагинация
    const total = sorted.length;
    const start = (page - 1) * limit;
    const slice = sorted.slice(start, start + limit);

    // Формат, который ждёт фронт (каждый элемент как { service: ... })
    const items = slice.map(service => ({ service }));

    res.json({ items, total, page });
  } catch (e) {
    console.error('sections error:', e);
    res.status(500).json({ error: 'sections_failed' });
  }
});

module.exports = router;
