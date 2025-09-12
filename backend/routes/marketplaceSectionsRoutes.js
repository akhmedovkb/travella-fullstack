// routes/marketplaceSectionsRoutes.js
const express = require('express');
const router = express.Router();

// /api/marketplace/sections/:section?page=&limit=&category=
router.get('/:section', async (req, res) => {
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 48);

  // TODO: заменить на реальную выборку из БД
  return res.json({ items: [], total: 0, page });
});

module.exports = router;
