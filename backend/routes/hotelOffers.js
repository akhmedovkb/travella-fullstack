const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { ensureHotelOfferTables } = require('../utils/hotelOffersSchema');

const SUPPLIER_TYPES = new Set(['hotel', 'tour_operator', 'dmc', 'agency', 'supplier']);
const MEAL_PLANS = new Set(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);
const RESIDENCIES = new Set(['resident', 'non_resident', 'all']);
const OFFER_PROVIDER_TYPES = new Set(['hotel', 'agent', 'tour_agent', 'agency', 'supplier', 'tour_operator', 'dmc']);

function rolesOf(user = {}) {
  return [user.role, user.type, ...(Array.isArray(user.roles) ? user.roles : [])]
    .filter(Boolean)
    .map((role) => String(role).toLowerCase());
}

function isAdmin(user = {}) {
  const roles = rolesOf(user);
  return user.is_admin === true || String(user.is_admin).toLowerCase() === 'true'
    || roles.includes('admin') || roles.includes('moderator');
}

function canUseOffers(req, res, next) {
  authenticateToken(req, res, () => {
    const roles = rolesOf(req.user);
    if (isAdmin(req.user) || roles.some((role) => ['provider', 'tour_agent', 'agency', 'supplier', 'hotel'].includes(role))) {
      return next();
    }
    return res.status(403).json({ error: 'forbidden' });
  });
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

async function getOffer(offerId, hotelId) {
  const { rows } = await db.query(
    `SELECT o.*, p.name AS provider_name, p.type AS provider_type
       FROM hotel_offers o
       JOIN providers p ON p.id=o.provider_id
      WHERE o.id=$1 AND o.hotel_id=$2
      LIMIT 1`,
    [offerId, hotelId]
  );
  return rows[0] || null;
}

function canEditOffer(req, offer) {
  return isAdmin(req.user) || Number(offer?.provider_id) === Number(req.user?.id);
}

function actorRole(req) {
  return isAdmin(req.user) ? 'admin' : (rolesOf(req.user)[0] || 'provider');
}

async function addOfferEvent(client, req, offerId, action, fromStatus, toStatus, note = null, payload = {}) {
  await client.query(
    `INSERT INTO hotel_offer_events (offer_id,actor_id,actor_role,action,from_status,to_status,note,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [offerId, positiveInt(req.user?.id), actorRole(req), action, fromStatus || null, toStatus || null,
      note ? String(note).slice(0, 2000) : null, JSON.stringify(payload || {})]
  );
}

router.use(canUseOffers);

router.get('/', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    const rateDate = req.query.date ? isoDate(req.query.date) : null;
    if (req.query.date && !rateDate) return res.status(400).json({ error: 'bad_date' });
    const params = [hotelId, req.query.status ? String(req.query.status).toLowerCase() : null, rateDate];
    const mineOnly = String(req.query.mine || '') === '1';
    let visibilityFilter = '';
    if (!isAdmin(req.user)) {
      params.push(positiveInt(req.user?.id) || 0);
      visibilityFilter = mineOnly ? ` AND o.provider_id=$4` : ` AND (o.status='active' OR o.provider_id=$4)`;
    }
    const { rows } = await db.query(
      `SELECT o.id, o.hotel_id, o.provider_id, p.name AS provider_name, p.type AS provider_type,
              o.supplier_type, o.is_direct, o.currency, o.status, o.title, o.terms,
              o.valid_from::text, o.valid_to::text, o.last_verified_at, o.created_at, o.updated_at,
              o.rejection_reason, o.submitted_at, o.reviewed_at, o.reviewed_by,
              (o.valid_to IS NOT NULL AND o.valid_to < CURRENT_DATE) AS is_expired,
              CASE WHEN o.valid_to IS NULL THEN NULL ELSE (o.valid_to - CURRENT_DATE)::int END AS days_until_expiry,
              COUNT(r.id)::int AS rate_count, MIN(r.amount)::numeric AS min_rate,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.room_type), NULL) AS room_types,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.meal_plan), NULL) AS meal_plans,
              COALESCE(BOOL_OR(r.allotment IS NULL),false) AS unlimited_allotment,
              COALESCE(BOOL_OR(r.allotment > 0),false) AS has_allotment,
              MAX(r.allotment)::int AS max_allotment,
              BOOL_AND(r.refundable) FILTER (WHERE r.id IS NOT NULL) AS fully_refundable,
              MIN(r.min_stay)::int AS min_stay,
              MIN(r.date_from)::text AS rate_from, MAX(r.date_to)::text AS rate_to
         FROM hotel_offers o
         JOIN providers p ON p.id=o.provider_id
         LEFT JOIN hotel_offer_rates r ON r.offer_id=o.id
          AND ($3::date IS NULL OR (r.date_from <= $3::date AND r.date_to >= $3::date))
        WHERE o.hotel_id=$1 AND o.status <> 'archived'
          AND ($2::text IS NULL OR o.status=$2)
          AND ($3::date IS NULL OR (o.valid_from IS NULL OR o.valid_from <= $3::date))
          AND ($3::date IS NULL OR (o.valid_to IS NULL OR o.valid_to >= $3::date))
          ${visibilityFilter}
        GROUP BY o.id, p.name, p.type
        ORDER BY MIN(r.amount) ASC NULLS LAST, o.is_direct DESC, p.name, o.id`,
      params
    );
    return res.json({ items: rows });
  } catch (error) { return next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    const requestedProviderId = positiveInt(req.body?.provider_id ?? req.body?.providerId);
    const providerId = isAdmin(req.user) ? requestedProviderId : positiveInt(req.user?.id);
    if (!hotelId || !providerId) return res.status(400).json({ error: 'bad_ids' });

    const providerResult = await db.query(`SELECT id, name, type FROM providers WHERE id=$1 LIMIT 1`, [providerId]);
    if (!providerResult.rowCount) return res.status(404).json({ error: 'provider_not_found' });
    const provider = providerResult.rows[0];
    const providerType = String(provider.type || '').toLowerCase();
    if (!OFFER_PROVIDER_TYPES.has(providerType)) return res.status(400).json({ error: 'invalid_offer_provider_type' });
    const directRequested = req.body?.is_direct === true || req.body?.isDirect === true;
    const providerIsHotel = providerType === 'hotel';
    if (directRequested && !providerIsHotel) return res.status(400).json({ error: 'direct_offer_requires_hotel_provider' });

    const supplierTypeRaw = String(req.body?.supplier_type || provider.type || 'supplier').toLowerCase();
    const supplierType = providerIsHotel ? 'hotel' : (SUPPLIER_TYPES.has(supplierTypeRaw) ? supplierTypeRaw : 'supplier');
    const currency = String(req.body?.currency || 'UZS').toUpperCase();
    if (!['UZS', 'USD'].includes(currency)) return res.status(400).json({ error: 'bad_currency' });
    // A new offer starts as a draft. Activation is a separate reviewed action
    // after at least one valid rate has been saved.
    const status = 'draft';
    const validFrom = req.body?.valid_from ? isoDate(req.body.valid_from) : null;
    const validTo = req.body?.valid_to ? isoDate(req.body.valid_to) : null;
    if ((req.body?.valid_from && !validFrom) || (req.body?.valid_to && !validTo) || (validFrom && validTo && validFrom > validTo)) {
      return res.status(400).json({ error: 'bad_dates' });
    }

    const { rows } = await db.query(
      `INSERT INTO hotel_offers
         (hotel_id,provider_id,supplier_type,is_direct,currency,status,title,terms,valid_from,valid_to,last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,CASE WHEN $6='active' THEN NOW() ELSE NULL END)
       ON CONFLICT (hotel_id,provider_id) DO UPDATE SET
         supplier_type=EXCLUDED.supplier_type, is_direct=EXCLUDED.is_direct,
         currency=EXCLUDED.currency, title=EXCLUDED.title, terms=EXCLUDED.terms,
         valid_from=EXCLUDED.valid_from, valid_to=EXCLUDED.valid_to, updated_at=NOW()
       RETURNING *`,
      [hotelId, providerId, supplierType, directRequested && providerIsHotel, currency, status,
        String(req.body?.title || '').trim() || null, JSON.stringify(req.body?.terms || {}), validFrom, validTo]
    );
    await addOfferEvent(db, req, rows[0].id, 'created', null, rows[0].status, null, { provider_id: providerId });
    return res.status(201).json({ item: { ...rows[0], provider_name: provider.name, provider_type: provider.type } });
  } catch (error) { return next(error); }
});

router.put('/:offerId', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });

    const requestedStatus = String(req.body?.status || offer.status).toLowerCase();
    let status = offer.status;
    if (requestedStatus === 'paused' && ['active', 'pending_review'].includes(offer.status)) status = 'paused';
    if (requestedStatus === 'draft' && isAdmin(req.user) && offer.status !== 'archived') status = 'draft';
    const currency = String(req.body?.currency || offer.currency).toUpperCase();
    if (!['UZS', 'USD'].includes(currency)) return res.status(400).json({ error: 'bad_currency' });
    const validFrom = req.body?.valid_from ? isoDate(req.body.valid_from) : null;
    const validTo = req.body?.valid_to ? isoDate(req.body.valid_to) : null;
    if ((req.body?.valid_from && !validFrom) || (req.body?.valid_to && !validTo) || (validFrom && validTo && validFrom > validTo)) {
      return res.status(400).json({ error: 'bad_dates' });
    }
    const { rows } = await db.query(
      `UPDATE hotel_offers SET currency=$1,status=$2,title=$3,terms=$4::jsonb,
              valid_from=$5,valid_to=$6,
              last_verified_at=CASE WHEN $2='active' THEN NOW() ELSE last_verified_at END,
              updated_at=NOW()
        WHERE id=$7 AND hotel_id=$8 RETURNING *`,
      [currency, status, String(req.body?.title ?? offer.title ?? '').trim() || null,
        JSON.stringify(req.body?.terms ?? offer.terms ?? {}), validFrom, validTo, offerId, hotelId]
    );
    if (status !== offer.status) await addOfferEvent(db, req, offerId, 'status_changed', offer.status, status);
    return res.json({ item: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/:offerId/rates', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query(
      `SELECT r.id,r.offer_id,r.room_type,r.meal_plan,r.residency,r.date_from::text,r.date_to::text,
              r.amount::numeric,r.allotment,r.min_stay,r.refundable,r.created_at,r.updated_at,
              COALESCE(stock.held,0)::int AS held,
              COALESCE(stock.confirmed,0)::int AS confirmed,
              CASE WHEN r.allotment IS NULL THEN NULL
                   ELSE GREATEST(0,r.allotment-COALESCE(stock.held,0)-COALESCE(stock.confirmed,0))::int END AS available
         FROM hotel_offer_rates r
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(quantity) FILTER (WHERE status='held' AND expires_at>NOW()),0) AS held,
                  COALESCE(SUM(quantity) FILTER (WHERE status='confirmed'),0) AS confirmed
             FROM hotel_inventory_reservations hir
            WHERE hir.rate_id=r.id
         ) stock ON true
        WHERE r.offer_id=$1 ORDER BY r.date_from,r.room_type,r.meal_plan,r.residency,r.id`,
      [offerId]
    );
    return res.json({ offer, items: rows });
  } catch (error) { return next(error); }
});

router.put('/:offerId/rates', async (req, res, next) => {
  let client;
  try {
    await ensureHotelOfferTables();
    client = await db.connect();
    const hotelId = positiveInt(req.params.id);
    const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    const input = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = input.map((row) => ({
      room_type: String(row?.room_type || '').trim(),
      meal_plan: String(row?.meal_plan || 'BB').toUpperCase(),
      residency: String(row?.residency || 'all').toLowerCase(),
      date_from: isoDate(row?.date_from), date_to: isoDate(row?.date_to),
      amount: Number(row?.amount), allotment: row?.allotment === '' || row?.allotment == null ? null : Math.max(0, Math.trunc(Number(row.allotment))),
      min_stay: Math.max(1, Math.trunc(Number(row?.min_stay || 1))), refundable: row?.refundable !== false,
    }));
    const invalid = items.some((row) => !row.room_type || !MEAL_PLANS.has(row.meal_plan) || !RESIDENCIES.has(row.residency)
      || !row.date_from || !row.date_to || row.date_from > row.date_to || !(row.amount > 0));
    if (invalid) return res.status(400).json({ error: 'bad_rate_rows' });

    const sorted = [...items].sort((a, b) => `${a.room_type}|${a.meal_plan}|${a.residency}|${a.date_from}`.localeCompare(`${b.room_type}|${b.meal_plan}|${b.residency}|${b.date_from}`));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]; const current = sorted[i];
      if (prev.room_type === current.room_type && prev.meal_plan === current.meal_plan && prev.residency === current.residency && current.date_from <= prev.date_to) {
        return res.status(409).json({ error: 'rate_overlap', rows: [i - 1, i] });
      }
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM hotel_offer_rates WHERE offer_id=$1`, [offerId]);
    for (const row of items) {
      await client.query(
        `INSERT INTO hotel_offer_rates
          (offer_id,room_type,meal_plan,residency,date_from,date_to,amount,allotment,min_stay,refundable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [offerId,row.room_type,row.meal_plan,row.residency,row.date_from,row.date_to,row.amount,row.allotment,row.min_stay,row.refundable]
      );
    }
    await client.query(
      `UPDATE hotel_offers SET status='draft',rejection_reason=NULL,submitted_at=NULL,updated_at=NOW() WHERE id=$1`,
      [offerId]
    );
    await addOfferEvent(client, req, offerId, 'rates_replaced', offer.status, 'draft', null, { rate_count: items.length });
    await client.query('COMMIT');
    return res.json({ ok: true, count: items.length });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client?.release(); }
});

router.post('/:offerId/submit', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    if (!['draft', 'rejected', 'paused'].includes(offer.status)) return res.status(409).json({ error: 'offer_not_submittable' });
    const rateCount = await db.query(`SELECT COUNT(*)::int AS count FROM hotel_offer_rates WHERE offer_id=$1`, [offerId]);
    if (!rateCount.rows[0]?.count) return res.status(409).json({ error: 'rates_required_before_submission' });
    if (dateOnly(offer.valid_to) && dateOnly(offer.valid_to) < new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'offer_expired' });
    const { rows } = await db.query(
      `UPDATE hotel_offers SET status='pending_review',submitted_at=NOW(),rejection_reason=NULL,updated_at=NOW()
        WHERE id=$1 RETURNING *`, [offerId]
    );
    await addOfferEvent(db, req, offerId, 'submitted', offer.status, 'pending_review');
    return res.json({ item: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/:offerId/review', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'admin_required' });
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (offer.status !== 'pending_review') return res.status(409).json({ error: 'offer_not_pending_review' });
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'bad_decision' });
    const reason = String(req.body?.reason || '').trim();
    if (decision === 'reject' && !reason) return res.status(400).json({ error: 'rejection_reason_required' });
    if (decision === 'approve') {
      const rateCount = await db.query(`SELECT COUNT(*)::int AS count FROM hotel_offer_rates WHERE offer_id=$1`, [offerId]);
      if (!rateCount.rows[0]?.count) return res.status(409).json({ error: 'rates_required_before_activation' });
      if (dateOnly(offer.valid_to) && dateOnly(offer.valid_to) < new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'offer_expired' });
    }
    const nextStatus = decision === 'approve' ? 'active' : 'rejected';
    const { rows } = await db.query(
      `UPDATE hotel_offers SET status=$2,rejection_reason=$3,reviewed_at=NOW(),reviewed_by=$4,
              last_verified_at=CASE WHEN $2='active' THEN NOW() ELSE last_verified_at END,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [offerId, nextStatus, decision === 'reject' ? reason.slice(0, 2000) : null, positiveInt(req.user?.id)]
    );
    await addOfferEvent(db, req, offerId, decision === 'approve' ? 'approved' : 'rejected', offer.status, nextStatus, reason || null);
    return res.json({ item: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/:offerId/events', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query(`SELECT * FROM hotel_offer_events WHERE offer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [offerId]);
    return res.json({ items: rows });
  } catch (error) { return next(error); }
});

router.delete('/:offerId', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    await db.query(`UPDATE hotel_offers SET status='archived',updated_at=NOW() WHERE id=$1`, [offerId]);
    await addOfferEvent(db, req, offerId, 'archived', offer.status, 'archived');
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

module.exports = router;
