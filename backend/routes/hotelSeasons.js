// routes/hotelSeasons.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db'); // ваш pg helper/pool

// список сезонов отеля
router.get('/', async (req, res, next) => {
  try {
    const { id: hotelId } = req.params;
    const { rows } = await db.query(
      `SELECT id, hotel_id, label, start_date, end_date
       FROM hotel_seasons
       WHERE hotel_id=$1
       ORDER BY start_date ASC`,
      [hotelId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// создать сезон
router.post('/', async (req, res, next) => {
  try {
    const { id: hotelId } = req.params;
    const { label, start_date, end_date } = req.body;
    const { rows } = await db.query(
      `INSERT INTO hotel_seasons (hotel_id, label, start_date, end_date)
       VALUES ($1,$2,$3,$4)
       RETURNING id, hotel_id, label, start_date, end_date`,
      [hotelId, label, start_date, end_date]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// обновить
router.put('/:seasonId', async (req, res, next) => {
  try {
    const { id: hotelId, seasonId } = req.params;
    const { label, start_date, end_date } = req.body;
    const { rows } = await db.query(
      `UPDATE hotel_seasons
       SET label=$1, start_date=$2, end_date=$3, updated_at=now()
       WHERE id=$4 AND hotel_id=$5
       RETURNING id, hotel_id, label, start_date, end_date`,
      [label, start_date, end_date, seasonId, hotelId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// удалить
router.delete('/:seasonId', async (req, res, next) => {
  try {
    const { id: hotelId, seasonId } = req.params;
    await db.query(`DELETE FROM hotel_seasons WHERE id=$1 AND hotel_id=$2`, [seasonId, hotelId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
