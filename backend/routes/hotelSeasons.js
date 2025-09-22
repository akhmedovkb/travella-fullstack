import express from 'express';
import { sql } from '../db.js'; // используйте свой helper для pg
import { authProviderOrAdmin } from '../middlewares/auth.js';

const r = express.Router({ mergeParams: true });

// Все сезоны отеля
r.get('/', async (req, res, next) => {
  try {
    const { id: hotelId } = req.params;
    const rows = await sql`
      SELECT id, hotel_id, label, start_date, end_date
      FROM hotel_seasons
      WHERE hotel_id = ${hotelId}
      ORDER BY start_date ASC
    `;
    res.json(rows);
  } catch (e) { next(e); }
});

// Создать
r.post('/', authProviderOrAdmin, async (req, res, next) => {
  try {
    const { id: hotelId } = req.params;
    const { label, start_date, end_date } = req.body;
    const row = await sql`
      INSERT INTO hotel_seasons (hotel_id, label, start_date, end_date)
      VALUES (${hotelId}, ${label}, ${start_date}, ${end_date})
      RETURNING id, hotel_id, label, start_date, end_date
    `;
    res.json(row[0]);
  } catch (e) { next(e); }
});

// Обновить
r.put('/:seasonId', authProviderOrAdmin, async (req, res, next) => {
  try {
    const { id: hotelId, seasonId } = req.params;
    const { label, start_date, end_date } = req.body;
    const row = await sql`
      UPDATE hotel_seasons
      SET label=${label}, start_date=${start_date}, end_date=${end_date}, updated_at=now()
      WHERE id=${seasonId} AND hotel_id=${hotelId}
      RETURNING id, hotel_id, label, start_date, end_date
    `;
    if (!row.length) return res.status(404).json({ error: 'Not found' });
    res.json(row[0]);
  } catch (e) { next(e); }
});

// Удалить
r.delete('/:seasonId', authProviderOrAdmin, async (req, res, next) => {
  try {
    const { id: hotelId, seasonId } = req.params;
    await sql`DELETE FROM hotel_seasons WHERE id=${seasonId} AND hotel_id=${hotelId}`;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
