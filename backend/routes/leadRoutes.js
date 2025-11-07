// backend/routes/leadRoutes.js
const router = require('express').Router();
router.post('/leads', async (req, res) => {
  const { name, phone, service, comment, ...rest } = req.body || {};
  // TODO: сохранить в БД + уведомить Telegram
  res.json({ ok: true });
});
module.exports = router;

// backend/index.js
app.use('/api', require('./routes/leadRoutes'));
