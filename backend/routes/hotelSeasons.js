// routes/hotelSeasons.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db'); // ваш pg helper/pool
const authenticateToken = require('../middleware/authenticateToken');

/** Мягкая авторизация для GET (публично, но можно знать юзера) */
function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

/** Разрешить только указанным ролям (админ/модер всегда ок) */
function allowRoles(...roles) {
  const want = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    authenticateToken(req, res, () => {
      const u = req.user || {};
      const pool = new Set(
        [u.role, u.type, ...(Array.isArray(u.roles) ? u.roles : [])]
          .filter(Boolean)
          .map((r) => String(r).toLowerCase())
      );
      const ok =
        pool.has('admin') ||
        pool.has('moderator') ||
        want.some((r) => pool.has(r));
      if (!ok) return res.status(403).json({ error: 'forbidden' });
      next();
    });
  };
}

const canWrite = allowRoles('provider', 'tour_agent', 'agency', 'supplier');

// утилиты
function iso(d) {
  // принимает 'YYYY-MM-DD' или Date и нормализует к 'YYYY-MM-DD'
  const x = (typeof d === 'string') ? new Date(d + 'T00:00:00Z') : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}
async function hasOverlap({ hotelId, start, end, exceptId = null }) {
  const params = [hotelId, start, end];
  let sql = `
    SELECT id
      FROM hotel_seasons
     WHERE hotel_id = $1
       AND start_date <= $3::date
       AND end_date   >= $2::date
  `;
  if (exceptId) { params.push(exceptId); sql += ` AND id <> $4`; }
  const { rows } = await db.query(sql, params);
  return rows.length > 0;
}

/* ==================== СХЕМА (мягкая миграция) ==================== */
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_seasons (
      id         SERIAL PRIMARY KEY,
      hotel_id   INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      label      TEXT NOT NULL, -- 'low' | 'high' | произвольный тег
      start_date DATE NOT NULL,
      end_date   DATE NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      CHECK (start_date <= end_date)
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_seasons_hotel ON hotel_seasons(hotel_id, start_date, end_date)`);
}

/* ==================== READ ==================== */
// список сезонов отеля (публичный)
router.get('/', tryAuth, async (req, res, next) => {
  try {
    await ensureTable();
    const { id: hotelId } = req.params;
    const { rows } = await db.query(
      `SELECT id, hotel_id, label, start_date, end_date
         FROM hotel_seasons
        WHERE hotel_id=$1
        ORDER BY start_date ASC, id ASC`,
      [hotelId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

/* ==================== CREATE ==================== */
router.post('/', canWrite, async (req, res, next) => {
  try {
    await ensureTable();
    const { id: hotelId } = req.params;
    const { label = 'low', start_date, end_date } = req.body || {};

    const start = iso(start_date);
    const end = iso(end_date);
    if (!start || !end) return res.status(400).json({ error: 'bad_dates' });
    if (start > end)     return res.status(400).json({ error: 'start_after_end' });

    if (await hasOverlap({ hotelId, start, end })) {
      return res.status(409).json({ error: 'overlap' });
    }

    const { rows } = await db.query(
      `INSERT INTO hotel_seasons (hotel_id, label, start_date, end_date, created_at, updated_at)
       VALUES ($1,$2,$3,$4, NOW(), NOW())
       RETURNING id, hotel_id, label, start_date, end_date`,
      [hotelId, String(label).trim() || 'low', start, end]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ==================== UPDATE ==================== */
router.put('/:seasonId', canWrite, async (req, res, next) => {
  try {
    await ensureTable();
    const { id: hotelId, seasonId } = req.params;
    const { label = 'low', start_date, end_date } = req.body || {};

    const start = iso(start_date);
    const end = iso(end_date);
    if (!start || !end) return res.status(400).json({ error: 'bad_dates' });
    if (start > end)     return res.status(400).json({ error: 'start_after_end' });

    if (await hasOverlap({ hotelId, start, end, exceptId: seasonId })) {
      return res.status(409).json({ error: 'overlap' });
    }

    const { rows } = await db.query(
      `UPDATE hotel_seasons
          SET label=$1, start_date=$2, end_date=$3, updated_at=NOW()
        WHERE id=$4 AND hotel_id=$5
      RETURNING id, hotel_id, label, start_date, end_date`,
      [String(label).trim() || 'low', start, end, seasonId, hotelId]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ==================== DELETE ==================== */
router.delete('/:seasonId', canWrite, async (req, res, next) => {
  try {
    await ensureTable();
    const { id: hotelId, seasonId } = req.params;
    const r = await db.query(
      `DELETE FROM hotel_seasons WHERE id=$1 AND hotel_id=$2`,
      [seasonId, hotelId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================== BULK REPLACE ==================== */
/**
 * PUT /api/hotels/:id/seasons/bulk
 * body: { items: [{label,start_date,end_date}, ...] }
 * Полностью заменяет сезоны у отеля.
 */
router.put('/bulk', canWrite, async (req, res, next) => {
  const client = await db.connect();
  try {
    await ensureTable();
    const { id: hotelId } = req.params;
    const list = Array.isArray(req.body?.items) ? req.body.items : [];

    // нормализуем и проверяем
    const items = list.map((x) => {
      const start = iso(x.start_date);
      const end = iso(x.end_date);
      return { label: (x.label || 'low').trim() || 'low', start, end };
    });

    if (items.some(it => !it.start || !it.end || it.start > it.end)) {
      return res.status(400).json({ error: 'bad_dates' });
    }

    // проверка перекрытий внутри присланного набора
    const sorted = [...items].sort((a,b) => a.start.localeCompare(b.start));
    for (let i=1;i<sorted.length;i++){
      if (sorted[i].start <= sorted[i-1].end) {
        return res.status(409).json({ error: 'overlap_in_payload' });
      }
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM hotel_seasons WHERE hotel_id=$1`, [hotelId]);

    const values = [];
    for (const it of sorted) {
      values.push(client.query(
        `INSERT INTO hotel_seasons (hotel_id, label, start_date, end_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())`,
        [hotelId, it.label, it.start, it.end]
      ));
    }
    await Promise.all(values);
    await client.query('COMMIT');

    const { rows } = await db.query(
      `SELECT id, hotel_id, label, start_date, end_date
         FROM hotel_seasons
        WHERE hotel_id=$1
        ORDER BY start_date ASC, id ASC`,
      [hotelId]
    );
    res.json({ items: rows });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
