const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const requireAdmin = require('../middleware/requireAdmin');
const { createStore } = require('../utils/donasKnowledgeStore');
const { KINDS, invalid } = require('../utils/donasKnowledgeValidation');
function createRouter(store, authenticate, authorize) {
  const router = express.Router();
  router.use(authenticate, authorize);
  router.param('kind', (req, res, next, kind) => KINDS.includes(kind) ? next() : res.status(404).json({ error: 'Модуль не найден' }));
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (e.code === '42P01') return res.status(503).json({ error: 'Требуется миграция базы данных для Business Concept / Product Bible' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error('[donas-knowledge]', e.code || e.message);
      res.status(500).json({ error: 'Не удалось выполнить операцию с документом' });
    }
  };
  function positive(value) {
    if (value === undefined) return undefined;
    if (!/^[1-9]\d*$/.test(String(value)) || Number(value)>2147483647) throw invalid('Некорректная ревизия');
    return Number(value);
  }
  const actor = req => String(req.user.id ?? req.user.provider_id ?? 'admin');
  router.get('/:kind', wrap(async (req,res) => res.json({ document: await store.get(req.params.kind, positive(req.query.revision)) })));
  router.get('/:kind/history', wrap(async (req,res) => {
    const items = await store.history(req.params.kind, positive(req.query.before));
    res.json({ items, nextBefore: items.length === 50 ? items[49].revision : null });
  }));
  router.post('/:kind/initialize', wrap(async (req,res) => res.status(201).json({ document: await store.initialize(req.params.kind, actor(req)) })));
  router.post('/:kind/versions', wrap(async (req,res) => res.status(201).json({ document: await store.save(req.params.kind, req.body, actor(req)) })));
  return router;
}
module.exports = createRouter(createStore(pool), authenticateToken, requireAdmin);
module.exports.createRouter = createRouter;
