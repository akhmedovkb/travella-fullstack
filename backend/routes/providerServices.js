// server/routes/providerServices.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // ваш pool из pg

// список услуг провайдера
router.get('/api/providers/:pid/services', async (req, res) => {
  const { pid } = req.params;
  const { only_active } = req.query;
  const q = `
    SELECT id, provider_id, category, title, price, currency, is_active
    FROM provider_services
    WHERE provider_id = $1
      ${only_active ? 'AND is_active = TRUE' : ''}
    ORDER BY category, price NULLS LAST, id
  `;
  const { rows } = await db.query(q, [pid]);
  res.json(rows);
});

// создать услугу
router.post('/api/providers/:pid/services', async (req, res) => {
  const { pid } = req.params;
  const { category, title, price, currency = 'USD', is_active = true } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category required' });

  const q = `
    INSERT INTO provider_services (provider_id, category, title, price, currency, is_active)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id, provider_id, category, title, price, currency, is_active
  `;
  const { rows } = await db.query(q, [pid, category, title || null, price || 0, currency, !!is_active]);
  res.status(201).json(rows[0]);
});

// правка / включение-выключение
router.patch('/api/providers/:pid/services/:sid', async (req, res) => {
  const { pid, sid } = req.params;
  const fields = ['category','title','price','currency','is_active'];
  const set = [];
  const vals = [];
  fields.forEach((f) => {
    if (req.body.hasOwnProperty(f)) {
      set.push(`${f} = $${set.length + 1}`);
      vals.push(req.body[f]);
    }
  });
  if (!set.length) return res.status(400).json({ error: 'no fields' });

  const q = `
    UPDATE provider_services
       SET ${set.join(', ')}, updated_at = now()
     WHERE id = $${set.length + 1} AND provider_id = $${set.length + 2}
     RETURNING id, provider_id, category, title, price, currency, is_active
  `;
  vals.push(sid, pid);
  const { rows } = await db.query(q, vals);
  if (!rows.length) return res.sendStatus(404);
  res.json(rows[0]);
});

// (опционально) удалить
router.delete('/api/providers/:pid/services/:sid', async (req, res) => {
  const { pid, sid } = req.params;
  await db.query(`DELETE FROM provider_services WHERE id = $1 AND provider_id = $2`, [sid, pid]);
  res.sendStatus(204);
});

module.exports = router;
