// backend/routes/providerServices.js - файл для услуг поставщика для tourbuilder

const express = require('express');
const router = express.Router();
const db = require('../db'); // ваш pool из pg
const authenticateToken = require('../middleware/authenticateToken');

// Транспортные категории — только в них допускаем details.seats
const TRANSPORT_CATS = new Set([
  'city_tour_transport',
  'mountain_tour_transport',
  'one_way_transfer',
  'dinner_transfer',
  'border_transfer',
]);

function isTransportCategory(cat) {
  return TRANSPORT_CATS.has(String(cat || ''));
}

function toNumberInt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v) : NaN;
}

// Нормализация details c учётом категории
function normalizeDetails(details, category) {
  let d = {};
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    d = { ...details };
  }

  // seats — допускаем только у транспорта, и только целое > 0
  if ('seats' in d) {
    if (isTransportCategory(category)) {
      const n = toNumberInt(d.seats);
      if (Number.isFinite(n) && n > 0) d.seats = n;
      else delete d.seats;
    } else {
      delete d.seats;
    }
  }

  return d;
}

function ensureSelfOrAdmin(req, res) {
  const pid = Number(req.params.pid);
  if (!req.user || !req.user.id) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  if (req.user.is_admin === true) return true;
  if (pid !== Number(req.user.id)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

/* ========================= LIST ========================= */
router.get('/api/providers/:pid/services', authenticateToken, async (req, res) => {
  if (!ensureSelfOrAdmin(req, res)) return;
  try {
    const { pid } = req.params;
    const onlyActive = String(req.query.only_active || '').toLowerCase();
    const onlyActiveSQL = (onlyActive === '1' || onlyActive === 'true') ? 'AND is_active = TRUE' : '';

    const q = `
      SELECT id, provider_id, category, title, price, currency, is_active, COALESCE(details, '{}'::jsonb) AS details
      FROM provider_services
      WHERE provider_id = $1
        ${onlyActiveSQL}
      ORDER BY category, price NULLS LAST, id
    `;
    const { rows } = await db.query(q, [pid]);
    res.json(rows);
  } catch (e) {
    console.error('GET provider services error:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

/* ========================= PUBLIC LIST (без токена) ========================= */
router.get('/api/providers/:pid/services/public', async (req, res) => {
  try {
    const { pid } = req.params;
    const q = `
      SELECT id, provider_id, category, title, price, currency, is_active,
             COALESCE(details, '{}'::jsonb) AS details
      FROM provider_services
      WHERE provider_id = $1
        AND is_active = TRUE
      ORDER BY category, price NULLS LAST, id
    `;
    const { rows } = await db.query(q, [pid]);
    res.json(rows);
  } catch (e) {
    console.error('GET provider services PUBLIC error:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

/* ========================= CREATE ========================= */
router.post('/api/providers/:pid/services', authenticateToken, async (req, res) => {
  if (!ensureSelfOrAdmin(req, res)) return;
  try {
    const { pid } = req.params;
    const {
      category,
      title,
      price,
      currency = 'USD',
      is_active = true,
      details = undefined, // может прийти { seats: N }
    } = req.body || {};

    if (!category) return res.status(400).json({ error: 'category required' });

    const priceNum = Number(price) || 0;
    const detailsNorm = normalizeDetails(details, category);

    const q = `
      INSERT INTO provider_services (provider_id, category, title, price, currency, is_active, details)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING id, provider_id, category, title, price, currency, is_active, COALESCE(details, '{}'::jsonb) AS details
    `;
    const { rows } = await db.query(q, [
      pid,
      category,
      title || null,
      priceNum,
      currency,
      !!is_active,
      JSON.stringify(detailsNorm),
    ]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('POST provider service error:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

/* ========================= PATCH (partial) ========================= */
router.patch('/api/providers/:pid/services/:sid', authenticateToken, async (req, res) => {
  if (!ensureSelfOrAdmin(req, res)) return;
  try {
    const { pid, sid } = req.params;

    // Сначала узнаем текущую категорию/детали (нам нужно знать категорию для нормализации seats)
    const curQ = await db.query(
      `SELECT category, COALESCE(details, '{}'::jsonb) AS details
         FROM provider_services
        WHERE id=$1 AND provider_id=$2`,
      [sid, pid]
    );
    if (!curQ.rowCount) return res.sendStatus(404);

    const current = curQ.rows[0];
    const nextCategory = req.body.hasOwnProperty('category')
      ? String(req.body.category || '')
      : current.category;

    const set = [];
    const vals = [];
    let idx = 1;

    // category
    if (req.body.hasOwnProperty('category')) {
      set.push(`category = $${idx++}`);
      vals.push(nextCategory);
    }
    // title
    if (req.body.hasOwnProperty('title')) {
      set.push(`title = $${idx++}`);
      vals.push(req.body.title || null);
    }
    // price
    if (req.body.hasOwnProperty('price')) {
      set.push(`price = $${idx++}`);
      vals.push(Number(req.body.price) || 0);
    }
    // currency
    if (req.body.hasOwnProperty('currency')) {
      set.push(`currency = $${idx++}`);
      vals.push(req.body.currency || 'USD');
    }
    // is_active
    if (req.body.hasOwnProperty('is_active')) {
      set.push(`is_active = $${idx++}`);
      vals.push(!!req.body.is_active);
    }
    // details (целиком перезаписываем нормализованным объектом)
    if (req.body.hasOwnProperty('details')) {
      const normalized = normalizeDetails(req.body.details, nextCategory);
      set.push(`details = $${idx++}::jsonb`);
      vals.push(JSON.stringify(normalized));
    }

    if (!set.length) return res.status(400).json({ error: 'no fields' });

    const q = `
      UPDATE provider_services
         SET ${set.join(', ')}, updated_at = now()
       WHERE id = $${idx++} AND provider_id = $${idx++}
       RETURNING id, provider_id, category, title, price, currency, is_active, COALESCE(details, '{}'::jsonb) AS details
    `;
    vals.push(sid, pid);

    const { rows } = await db.query(q, vals);
    if (!rows.length) return res.sendStatus(404);
    res.json(rows[0]);
  } catch (e) {
    console.error('PATCH provider service error:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

/* ========================= DELETE ========================= */
router.delete('/api/providers/:pid/services/:sid', authenticateToken, async (req, res) => {
  if (!ensureSelfOrAdmin(req, res)) return;
  try {
    const { pid, sid } = req.params;
    await db.query(
      `DELETE FROM provider_services WHERE id = $1 AND provider_id = $2`,
      [sid, pid]
    );
    res.sendStatus(204);
  } catch (e) {
    console.error('DELETE provider service error:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;

/* ========================= BULK INSERT (same table) ========================= */
router.post('/api/providers/:pid/services/bulk', authenticateToken, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.is_admin !== true && pid !== Number(req.user.id)) return res.status(403).json({ error: 'forbidden' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items[] required' });

  const TRANSPORT = new Set(['city_tour_transport','mountain_tour_transport','one_way_transfer','dinner_transfer','border_transfer']);
  const norm = (it) => {
    const category = String(it.category || '').trim();
    if (!category) return null;
    const title = it.title ? String(it.title).trim() : null;
    const price = Number(it.price) || 0;
    const currency = (it.currency || 'USD').toUpperCase();
    let details = {};
    if (it.details && typeof it.details === 'object') details = { ...it.details };
    if ('seats' in details) {
      const n = Number(details.seats);
      if (!(TRANSPORT.has(category) && Number.isInteger(n) && n > 0)) delete details.seats;
    }
    return { category, title, price, currency, details };
  };

  const values = [];
  const rows = [];
  let i = 1;
  for (const it of items) {
    const n = norm(it);
    if (!n) continue;
    rows.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, TRUE, $${i++}::jsonb)`);
    values.push(pid, n.category, n.title, n.price, n.currency, JSON.stringify(n.details || {}));
  }
  if (!rows.length) return res.status(400).json({ error: 'no valid items' });

  const sql = `
    INSERT INTO provider_services (provider_id, category, title, price, currency, is_active, details)
    VALUES ${rows.join(',')}
    RETURNING id, provider_id, category, title, price, currency, is_active, details
  `;
  const r = await db.query(sql, values);
  res.status(201).json({ items: r.rows });
});
