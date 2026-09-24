const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { ensureHotelOfferTables } = require('../utils/hotelOffersSchema');

const OFFER_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
const SUPPLIER_TYPES = new Set(['hotel', 'tour_operator', 'dmc', 'agency', 'supplier']);
const MEAL_PLANS = new Set(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);
const RESIDENCIES = new Set(['resident', 'non_resident', 'all']);

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

router.use(canUseOffers);

router.get('/', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    const { rows } = await db.query(
      `SELECT o.id, o.hotel_id, o.provider_id, p.name AS provider_name, p.type AS provider_type,
              o.supplier_type, o.is_direct, o.currency, o.status, o.title, o.terms,
              o.valid_from::text, o.valid_to::text, o.last_verified_at, o.created_at, o.updated_at,
              COUNT(r.id)::int AS rate_count, MIN(r.amount)::numeric AS min_rate,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.room_type), NULL) AS room_types,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.meal_plan), NULL) AS meal_plans,
              MIN(r.date_from)::text AS rate_from, MAX(r.date_to)::text AS rate_to
         FROM hotel_offers o
         JOIN providers p ON p.id=o.provider_id
         LEFT JOIN hotel_offer_rates r ON r.offer_id=o.id
        WHERE o.hotel_id=$1 AND o.status <> 'archived'
          AND ($2::text IS NULL OR o.status=$2)
        GROUP BY o.id, p.name, p.type
        ORDER BY o.is_direct DESC, o.status='active' DESC, p.name, o.id`,
      [hotelId, req.query.status ? String(req.query.status).toLowerCase() : null]
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
    const directRequested = req.body?.is_direct === true || req.body?.isDirect === true;
    const providerIsHotel = String(provider.type || '').toLowerCase() === 'hotel';
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
    const status = isAdmin(req.user) && OFFER_STATUSES.has(requestedStatus)
      ? requestedStatus
      : requestedStatus === 'paused' ? 'paused' : offer.status;
    const currency = String(req.body?.currency || offer.currency).toUpperCase();
    if (!['UZS', 'USD'].includes(currency)) return res.status(400).json({ error: 'bad_currency' });
    const validFrom = req.body?.valid_from ? isoDate(req.body.valid_from) : null;
    const validTo = req.body?.valid_to ? isoDate(req.body.valid_to) : null;
    if ((req.body?.valid_from && !validFrom) || (req.body?.valid_to && !validTo) || (validFrom && validTo && validFrom > validTo)) {
      return res.status(400).json({ error: 'bad_dates' });
    }
    if (status === 'active') {
      const rateCount = await db.query(`SELECT COUNT(*)::int AS count FROM hotel_offer_rates WHERE offer_id=$1`, [offerId]);
      if (!rateCount.rows[0]?.count) return res.status(409).json({ error: 'rates_required_before_activation' });
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
    const { rows } = await db.query(
      `SELECT id,offer_id,room_type,meal_plan,residency,date_from::text,date_to::text,
              amount::numeric,allotment,min_stay,refundable,created_at,updated_at
         FROM hotel_offer_rates WHERE offer_id=$1 ORDER BY date_from,room_type,meal_plan,residency,id`,
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
    await client.query(`UPDATE hotel_offers SET status=CASE WHEN status='active' THEN status ELSE 'draft' END,updated_at=NOW() WHERE id=$1`, [offerId]);
    await client.query('COMMIT');
    return res.json({ ok: true, count: items.length });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client?.release(); }
});

router.delete('/:offerId', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    await db.query(`UPDATE hotel_offers SET status='archived',updated_at=NOW() WHERE id=$1`, [offerId]);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

module.exports = router;
