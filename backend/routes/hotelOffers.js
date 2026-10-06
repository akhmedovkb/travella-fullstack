const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { ensureHotelOfferTables } = require('../utils/hotelOffersSchema');
const {
  notifyHotelOfferSubmitted,
  notifyHotelOfferReviewed,
} = require('../utils/hotelOfferModerationNotifications');
const { notifyHotelAllocationChanges } = require('../utils/hotelAllocationNotifications');
const { notifyHotelOwnerSupplierLinked } = require('../utils/hotelSupplierLinkNotifications');

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

async function getHotelTemplateProviderId(hotelId, executor = db) {
  const { rows } = await executor.query(
    `SELECT COALESCE(
        (SELECT o.provider_id FROM hotel_offers o JOIN providers p ON p.id=o.provider_id
          WHERE o.hotel_id=$1 AND (o.is_direct=true OR o.supplier_type='hotel' OR LOWER(COALESCE(p.type,''))='hotel')
          ORDER BY o.is_direct DESC,o.id LIMIT 1),
        (SELECT provider_id FROM hotels WHERE id=$1)
      ) AS provider_id`,
    [hotelId]
  );
  return positiveInt(rows[0]?.provider_id);
}

function canEditOffer(req, offer) {
  return isAdmin(req.user) || Number(offer?.provider_id) === Number(req.user?.id);
}

async function canManageHotelInventory(req, hotelId) {
  if (isAdmin(req.user)) return true;
  const providerId = positiveInt(req.user?.id);
  if (!providerId) return false;
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM hotel_offers o
        JOIN providers p ON p.id=o.provider_id
        WHERE o.hotel_id=$1 AND o.provider_id=$2
          AND (o.is_direct=true OR o.supplier_type='hotel' OR LOWER(COALESCE(p.type,''))='hotel')
       UNION ALL
       SELECT 1 FROM hotels h
        WHERE h.id=$1 AND h.provider_id=$2
          AND NOT EXISTS (
            SELECT 1 FROM hotel_offers owner_offer JOIN providers owner_provider ON owner_provider.id=owner_offer.provider_id
             WHERE owner_offer.hotel_id=$1
               AND (owner_offer.is_direct=true OR owner_offer.supplier_type='hotel' OR LOWER(COALESCE(owner_provider.type,''))='hotel')
          )
     ) AS allowed`,
    [hotelId, providerId]
  );
  return rows[0]?.allowed === true;
}

async function hasHotelOfferAccess(req, hotelId) {
  if (isAdmin(req.user) || await canManageHotelInventory(req, hotelId)) return true;
  const providerId = positiveInt(req.user?.id);
  if (!providerId) return false;
  const result = await db.query(`SELECT 1 FROM hotel_offers WHERE hotel_id=$1 AND provider_id=$2 LIMIT 1`, [hotelId, providerId]);
  return result.rowCount > 0;
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

router.get('/inventory/allocations', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    if (!(await hasHotelOfferAccess(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const manager = isAdmin(req.user) || await canManageHotelInventory(req, hotelId);
    const providerId = positiveInt(req.user?.id);
    const params = manager ? [hotelId] : [hotelId, providerId];
    const filter = manager ? '' : 'AND a.provider_id=$2';
    const { rows } = await db.query(
      `SELECT a.id,a.hotel_id,a.provider_id,a.pool_id,a.date_from::text,a.date_to::text,a.allotment,a.active,
              p.name AS provider_name,p.type AS provider_type,rp.room_type,
              COALESCE(usage.held,0)::int AS held,COALESCE(usage.confirmed,0)::int AS confirmed,
              GREATEST(0,a.allotment-COALESCE(usage.occupied_peak,0))::int AS available
         FROM hotel_supplier_inventory_allocations a
         JOIN providers p ON p.id=a.provider_id
         JOIN hotel_room_inventory_pools rp ON rp.id=a.pool_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(MAX(day.held),0)::int AS held,COALESCE(MAX(day.confirmed),0)::int AS confirmed,
                  COALESCE(MAX(day.occupied),0)::int AS occupied_peak
             FROM (
               SELECT hir.stay_date,
                      COALESCE(SUM(hir.quantity) FILTER (WHERE hir.status='held' AND hir.expires_at>NOW()),0)::int AS held,
                      COALESCE(SUM(hir.quantity) FILTER (WHERE hir.status='confirmed'),0)::int AS confirmed,
                      COALESCE(SUM(hir.quantity) FILTER (WHERE hir.status='confirmed' OR (hir.status='held' AND hir.expires_at>NOW())),0)::int AS occupied
                 FROM hotel_inventory_reservations hir
                 JOIN hotel_offer_rates r ON r.id=hir.rate_id JOIN hotel_offers o ON o.id=r.offer_id
                WHERE o.hotel_id=a.hotel_id AND o.provider_id=a.provider_id AND r.inventory_pool_id=a.pool_id
                  AND hir.stay_date BETWEEN a.date_from AND a.date_to
                GROUP BY hir.stay_date
             ) day
         ) usage ON true
        WHERE a.hotel_id=$1 AND a.active=true ${filter}
        ORDER BY p.name,rp.room_type,a.date_from,a.id`, params);
    const providers = manager ? (await db.query(
      `SELECT DISTINCT o.provider_id,p.name AS provider_name,p.type AS provider_type,o.supplier_type,o.status
         FROM hotel_offers o JOIN providers p ON p.id=o.provider_id
        WHERE o.hotel_id=$1 AND o.status<>'archived'
        ORDER BY p.name,o.provider_id`, [hotelId]
    )).rows : [];
    return res.json({ items: rows, providers, can_manage: manager });
  } catch (error) { return next(error); }
});

router.put('/inventory/allocations', async (req, res, next) => {
  let client;
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    if (!(isAdmin(req.user) || await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((item) => ({
      id: positiveInt(item?.id), provider_id: positiveInt(item?.provider_id), pool_id: positiveInt(item?.pool_id),
      date_from: isoDate(item?.date_from), date_to: isoDate(item?.date_to), allotment: Math.trunc(Number(item?.allotment)),
    }));
    if (items.length > 300 || items.some((item) => !item.provider_id || !item.pool_id || !item.date_from || !item.date_to
      || item.date_from > item.date_to || !Number.isInteger(item.allotment) || item.allotment < 0)) {
      return res.status(400).json({ error: 'bad_supplier_allocations' });
    }
    for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]; const b = items[j];
      if (a.provider_id === b.provider_id && a.pool_id === b.pool_id && a.date_from <= b.date_to && b.date_from <= a.date_to) {
        return res.status(400).json({ error: 'supplier_allocation_periods_overlap' });
      }
    }
    client = await db.connect(); await client.query('BEGIN');
    const allocationSelect = `SELECT a.id,a.provider_id,a.pool_id,a.date_from::text,a.date_to::text,a.allotment,
        rp.room_type,p.telegram_web_chat_id,p.telegram_chat_id,p.tg_chat_id
      FROM hotel_supplier_inventory_allocations a
      JOIN hotel_room_inventory_pools rp ON rp.id=a.pool_id
      JOIN providers p ON p.id=a.provider_id
      WHERE a.hotel_id=$1 AND a.active=true ORDER BY a.id`;
    const beforeRows = (await client.query(allocationSelect, [hotelId])).rows;
    const valid = await client.query(
      `SELECT o.provider_id,p.id AS pool_id
         FROM hotel_offers o CROSS JOIN hotel_room_inventory_pools p
        WHERE o.hotel_id=$1 AND p.hotel_id=$1 AND o.provider_id=ANY($2::int[]) AND p.id=ANY($3::bigint[])`,
      [hotelId, [...new Set(items.map((x) => x.provider_id))], [...new Set(items.map((x) => x.pool_id))]]);
    const validKeys = new Set(valid.rows.map((x) => `${x.provider_id}:${x.pool_id}`));
    if (items.some((item) => !validKeys.has(`${item.provider_id}:${item.pool_id}`))) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'allocation_provider_or_pool_invalid' });
    }
    const ids = items.map((item) => item.id).filter(Boolean);
    await client.query(`UPDATE hotel_supplier_inventory_allocations SET active=false,updated_at=NOW()
      WHERE hotel_id=$1 AND active=true AND NOT (id=ANY($2::bigint[]))`, [hotelId, ids.length ? ids : [0]]);
    for (const item of items) {
      if (item.id) {
        await client.query(`UPDATE hotel_supplier_inventory_allocations SET provider_id=$3,pool_id=$4,date_from=$5,date_to=$6,
          allotment=$7,active=true,updated_at=NOW() WHERE id=$2 AND hotel_id=$1`,
        [hotelId,item.id,item.provider_id,item.pool_id,item.date_from,item.date_to,item.allotment]);
      } else {
        await client.query(`INSERT INTO hotel_supplier_inventory_allocations
          (hotel_id,provider_id,pool_id,date_from,date_to,allotment,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [hotelId,item.provider_id,item.pool_id,item.date_from,item.date_to,item.allotment,positiveInt(req.user?.id)]);
      }
    }
    const afterRows = (await client.query(allocationSelect, [hotelId])).rows;
    const hotelName = (await client.query('SELECT name FROM hotels WHERE id=$1', [hotelId])).rows[0]?.name || `#${hotelId}`;
    await client.query('COMMIT');
    notifyHotelAllocationChanges({ hotelId, hotelName, beforeRows, afterRows })
      .catch((error) => console.error('[hotel-allocations] telegram notification failed:', error?.message || error));
    return res.json({ ok: true, count: items.length });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client?.release(); }
});

router.get('/inventory/rooms', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    if (!(await hasHotelOfferAccess(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const canManage = isAdmin(req.user) || await canManageHotelInventory(req, hotelId);
    const { rows } = await db.query(
      `SELECT id,hotel_id,room_type,base_inventory,active,created_at,updated_at
         FROM hotel_room_inventory_pools
        WHERE hotel_id=$1
        ORDER BY active DESC,room_type,id`,
      [hotelId]
    );
    return res.json({ items: rows, can_manage: canManage });
  } catch (error) { return next(error); }
});

router.put('/inventory/rooms', async (req, res, next) => {
  let client;
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    if (!(await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((item) => ({
      room_type: String(item?.room_type || '').trim(),
      base_inventory: Math.trunc(Number(item?.base_inventory)),
      active: item?.active !== false,
    }));
    const keys = items.map((item) => item.room_type.toLowerCase());
    if (!items.length || items.length > 100 || items.some((item) => !item.room_type || item.room_type.length > 120
      || !Number.isInteger(item.base_inventory) || item.base_inventory < 0) || new Set(keys).size !== keys.length) {
      return res.status(400).json({ error: 'bad_room_inventory_rows' });
    }
    client = await db.connect();
    await client.query('BEGIN');
    for (const item of items) {
      const updated = await client.query(
        `UPDATE hotel_room_inventory_pools
            SET room_type=$2,base_inventory=$3,active=$4,updated_at=NOW()
          WHERE hotel_id=$1 AND LOWER(room_type)=LOWER($2)
          RETURNING id`,
        [hotelId, item.room_type, item.base_inventory, item.active]
      );
      let poolId = updated.rows[0]?.id;
      if (!updated.rowCount) {
        const inserted = await client.query(
          `INSERT INTO hotel_room_inventory_pools (hotel_id,room_type,base_inventory,active) VALUES ($1,$2,$3,$4) RETURNING id`,
          [hotelId, item.room_type, item.base_inventory, item.active]
        );
        poolId = inserted.rows[0].id;
      }
      await client.query(
        `UPDATE hotel_offer_rates r SET inventory_pool_id=$3,updated_at=NOW()
          FROM hotel_offers o
         WHERE r.offer_id=o.id AND o.hotel_id=$1 AND LOWER(r.room_type)=LOWER($2) AND r.inventory_pool_id IS NULL`,
        [hotelId, item.room_type, poolId]
      );
    }
    await client.query(
      `UPDATE hotel_room_inventory_pools SET active=false,updated_at=NOW()
        WHERE hotel_id=$1 AND NOT (LOWER(room_type)=ANY($2::text[]))`,
      [hotelId, keys]
    );
    await client.query('COMMIT');
    const { rows } = await db.query(
      `SELECT id,hotel_id,room_type,base_inventory,active,created_at,updated_at
         FROM hotel_room_inventory_pools WHERE hotel_id=$1 ORDER BY active DESC,room_type,id`,
      [hotelId]
    );
    return res.json({ ok: true, items: rows });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client?.release(); }
});

router.get('/inventory/rooms/:poolId/calendar', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const poolId = positiveInt(req.params.poolId);
    if (!hotelId || !poolId) return res.status(400).json({ error: 'bad_inventory_pool' });
    if (!(await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const from = isoDate(req.query.from); const to = isoDate(req.query.to);
    if (!from || !to || from > to) return res.status(400).json({ error: 'bad_dates' });
    if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366) {
      return res.status(400).json({ error: 'inventory_range_too_large' });
    }
    const poolResult = await db.query(
      `SELECT id,hotel_id,room_type,base_inventory,active FROM hotel_room_inventory_pools WHERE id=$1 AND hotel_id=$2 LIMIT 1`,
      [poolId, hotelId]
    );
    if (!poolResult.rowCount) return res.status(404).json({ error: 'inventory_pool_not_found' });
    const pool = poolResult.rows[0];
    const { rows } = await db.query(
      `SELECT d::date::text AS date,ov.inventory,ov.stop_sell,ov.note,
              COALESCE(SUM(hir.quantity) FILTER (WHERE hir.status='held' AND hir.expires_at>NOW()),0)::int AS held,
              COALESCE(SUM(hir.quantity) FILTER (WHERE hir.status='confirmed'),0)::int AS confirmed
         FROM generate_series($3::date,$4::date,INTERVAL '1 day') d
         LEFT JOIN hotel_room_inventory_overrides ov ON ov.pool_id=$1 AND ov.stay_date=d::date
         LEFT JOIN hotel_inventory_reservations hir ON hir.stay_date=d::date
           AND hir.rate_id IN (
             SELECT r.id FROM hotel_offer_rates r JOIN hotel_offers o ON o.id=r.offer_id
              WHERE o.hotel_id=$2 AND r.inventory_pool_id=$1
           )
        GROUP BY d,ov.inventory,ov.stop_sell,ov.note ORDER BY d`,
      [poolId, hotelId, from, to]
    );
    return res.json({ pool, items: rows.map((row) => {
      const effective = row.inventory == null ? Number(pool.base_inventory) : Number(row.inventory);
      const used = Number(row.held || 0) + Number(row.confirmed || 0);
      return { ...row, effective_inventory: effective, available: row.stop_sell ? 0 : Math.max(0, effective - used) };
    }) });
  } catch (error) { return next(error); }
});

router.put('/inventory/rooms/:poolId/calendar', async (req, res, next) => {
  let client;
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const poolId = positiveInt(req.params.poolId);
    if (!hotelId || !poolId) return res.status(400).json({ error: 'bad_inventory_pool' });
    if (!(await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
    const poolResult = await db.query(`SELECT id FROM hotel_room_inventory_pools WHERE id=$1 AND hotel_id=$2 LIMIT 1`, [poolId, hotelId]);
    if (!poolResult.rowCount) return res.status(404).json({ error: 'inventory_pool_not_found' });
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((item) => ({
      date: isoDate(item?.date),
      inventory: item?.inventory === '' || item?.inventory == null ? null : Math.trunc(Number(item.inventory)),
      stop_sell: item?.stop_sell === true,
      note: String(item?.note || '').trim().slice(0, 500),
    }));
    if (!items.length || items.length > 367 || items.some((item) => !item.date || (item.inventory != null && (!Number.isInteger(item.inventory) || item.inventory < 0)))) {
      return res.status(400).json({ error: 'bad_inventory_rows' });
    }
    client = await db.connect(); await client.query('BEGIN');
    for (const item of items) {
      if (item.inventory == null && !item.stop_sell && !item.note) {
        await client.query(`DELETE FROM hotel_room_inventory_overrides WHERE pool_id=$1 AND stay_date=$2`, [poolId, item.date]);
      } else {
        await client.query(
          `INSERT INTO hotel_room_inventory_overrides (pool_id,stay_date,inventory,stop_sell,note)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (pool_id,stay_date) DO UPDATE SET
             inventory=EXCLUDED.inventory,stop_sell=EXCLUDED.stop_sell,note=EXCLUDED.note,updated_at=NOW()`,
          [poolId, item.date, item.inventory, item.stop_sell, item.note || null]
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ ok: true, count: items.length });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client?.release(); }
});

router.get('/', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id);
    if (!hotelId) return res.status(400).json({ error: 'bad_hotel_id' });
    const rateDate = req.query.date ? isoDate(req.query.date) : null;
    if (req.query.date && !rateDate) return res.status(400).json({ error: 'bad_date' });
    const params = [hotelId, req.query.status ? String(req.query.status).toLowerCase() : null, rateDate];
    const mineOnly = String(req.query.mine || '') === '1';
    const manager = isAdmin(req.user) || await canManageHotelInventory(req, hotelId);
    let visibilityFilter = '';
    if (!manager) {
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
    return res.json({ items: rows.map((offer) => ({ ...offer, can_edit: canEditOffer(req, offer) })), can_manage: manager });
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

    const existingOffer = await db.query(
      'SELECT id FROM hotel_offers WHERE hotel_id=$1 AND provider_id=$2 LIMIT 1',
      [hotelId, providerId]
    );

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
    if (!existingOffer.rowCount) {
      notifyHotelOwnerSupplierLinked({ hotelId, supplierProviderId: providerId })
        .catch((error) => console.error('[hotel-suppliers] telegram notification failed:', error?.message || error));
    }
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
    const canEdit = canEditOffer(req, offer);
    if (!canEdit && !(await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });

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
    const templateProviderId = await getHotelTemplateProviderId(hotelId);
    const isHotelTemplate = Number(templateProviderId) === Number(offer.provider_id);
    if (!isHotelTemplate) {
      const { rows } = await db.query(
        `SELECT own.id,own.offer_id,source.id AS source_rate_id,source.inventory_pool_id,
                COALESCE(pool.room_type,source.room_type) AS room_type,source.meal_plan,source.residency,
                source.date_from::text,source.date_to::text,own.amount::numeric,NULL::int AS allotment,
                source.min_stay,source.refundable,own.created_at,own.updated_at,
                COALESCE(stock.held,0)::int AS held,COALESCE(stock.confirmed,0)::int AS confirmed,
                allocation.allotment::int AS supplier_allotment,
                CASE WHEN allocation.allotment IS NULL THEN NULL
                     ELSE GREATEST(0,allocation.allotment-COALESCE(stock.held,0)-COALESCE(stock.confirmed,0))::int END AS available,
                true AS inherited
           FROM hotel_offers hotel_offer
           JOIN hotel_offer_rates source ON source.offer_id=hotel_offer.id
           LEFT JOIN LATERAL (
             SELECT candidate.* FROM hotel_offer_rates candidate
              WHERE candidate.offer_id=$2 AND (
                candidate.source_rate_id=source.id OR (
                  candidate.source_rate_id IS NULL AND candidate.inventory_pool_id=source.inventory_pool_id
                  AND candidate.meal_plan=source.meal_plan AND candidate.residency=source.residency
                  AND candidate.date_from=source.date_from AND candidate.date_to=source.date_to
                )
              )
              ORDER BY (candidate.source_rate_id=source.id) DESC LIMIT 1
           ) own ON true
           LEFT JOIN hotel_room_inventory_pools pool ON pool.id=source.inventory_pool_id
           LEFT JOIN LATERAL (
             SELECT allotment FROM hotel_supplier_inventory_allocations a
              WHERE a.hotel_id=$1 AND a.provider_id=$3 AND a.pool_id=source.inventory_pool_id AND a.active=true
                AND a.date_from<=source.date_from AND a.date_to>=source.date_to
              ORDER BY a.updated_at DESC LIMIT 1
           ) allocation ON true
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(quantity) FILTER (WHERE status='held' AND expires_at>NOW()),0) AS held,
                    COALESCE(SUM(quantity) FILTER (WHERE status='confirmed'),0) AS confirmed
               FROM hotel_inventory_reservations hir WHERE hir.rate_id=own.id
           ) stock ON true
          WHERE hotel_offer.hotel_id=$1 AND hotel_offer.provider_id=$4
          ORDER BY source.date_from,source.room_type,source.meal_plan,source.residency,source.id`,
        [hotelId, offerId, offer.provider_id, templateProviderId]
      );
      return res.json({ offer, items: rows, cascade: true, can_edit: canEdit });
    }
    const { rows } = await db.query(
      `SELECT r.id,r.offer_id,r.source_rate_id,r.inventory_pool_id,COALESCE(p.room_type,r.room_type) AS room_type,r.meal_plan,r.residency,r.date_from::text,r.date_to::text,
              r.amount::numeric,r.allotment,r.min_stay,r.refundable,r.created_at,r.updated_at,
              COALESCE(stock.held,0)::int AS held,
              COALESCE(stock.confirmed,0)::int AS confirmed,
              CASE WHEN r.allotment IS NULL THEN NULL
                   ELSE GREATEST(0,r.allotment-COALESCE(stock.held,0)-COALESCE(stock.confirmed,0))::int END AS available
         FROM hotel_offer_rates r
         LEFT JOIN hotel_room_inventory_pools p ON p.id=r.inventory_pool_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(quantity) FILTER (WHERE status='held' AND expires_at>NOW()),0) AS held,
                  COALESCE(SUM(quantity) FILTER (WHERE status='confirmed'),0) AS confirmed
             FROM hotel_inventory_reservations hir
            WHERE hir.rate_id=r.id
         ) stock ON true
        WHERE r.offer_id=$1 ORDER BY r.date_from,r.room_type,r.meal_plan,r.residency,r.id`,
      [offerId]
    );
    return res.json({ offer, items: rows, cascade: false, can_edit: canEdit });
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
      id: positiveInt(row?.id), source_rate_id: positiveInt(row?.source_rate_id),
      inventory_pool_id: positiveInt(row?.inventory_pool_id),
      room_type: String(row?.room_type || '').trim(),
      meal_plan: String(row?.meal_plan || 'BB').toUpperCase(),
      residency: String(row?.residency || 'all').toLowerCase(),
      date_from: isoDate(row?.date_from), date_to: isoDate(row?.date_to),
      amount: Number(row?.amount), allotment: null,
      min_stay: Math.max(1, Math.trunc(Number(row?.min_stay || 1))), refundable: row?.refundable !== false,
    }));
    const poolResult = await db.query(
      `SELECT id,room_type FROM hotel_room_inventory_pools WHERE hotel_id=$1 AND active=true`,
      [hotelId]
    );
    const poolMap = new Map(poolResult.rows.map((row) => [Number(row.id), row]));
    const templateProviderId = await getHotelTemplateProviderId(hotelId);
    const isHotelTemplate = Number(templateProviderId) === Number(offer.provider_id);

    if (!isHotelTemplate) {
      const sourceIds = items.map((row) => row.source_rate_id).filter(Boolean);
      const sourceResult = await db.query(
        `SELECT r.id,r.inventory_pool_id,COALESCE(p.room_type,r.room_type) AS room_type,r.meal_plan,r.residency,
                r.date_from::text,r.date_to::text,r.min_stay,r.refundable
           FROM hotel_offer_rates r JOIN hotel_offers o ON o.id=r.offer_id
           LEFT JOIN hotel_room_inventory_pools p ON p.id=r.inventory_pool_id
          WHERE o.hotel_id=$1 AND o.provider_id=$2 AND r.id=ANY($3::bigint[])`,
        [hotelId, templateProviderId, sourceIds.length ? sourceIds : [0]]
      );
      const sources = new Map(sourceResult.rows.map((row) => [Number(row.id), row]));
      if (items.some((row) => !row.source_rate_id || !sources.has(row.source_rate_id) || !(row.amount > 0))) {
        return res.status(400).json({ error: 'supplier_price_rows_invalid' });
      }
      await client.query('BEGIN');
      const kept = [];
      for (const row of items) {
        const source = sources.get(row.source_rate_id);
        const saved = await client.query(
          `INSERT INTO hotel_offer_rates
             (offer_id,source_rate_id,inventory_pool_id,room_type,meal_plan,residency,date_from,date_to,amount,allotment,min_stay,refundable)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11)
           ON CONFLICT (offer_id,source_rate_id) WHERE source_rate_id IS NOT NULL DO UPDATE SET
             inventory_pool_id=EXCLUDED.inventory_pool_id,room_type=EXCLUDED.room_type,meal_plan=EXCLUDED.meal_plan,
             residency=EXCLUDED.residency,date_from=EXCLUDED.date_from,date_to=EXCLUDED.date_to,
             amount=EXCLUDED.amount,allotment=NULL,min_stay=EXCLUDED.min_stay,refundable=EXCLUDED.refundable,updated_at=NOW()
           RETURNING id`,
          [offerId,source.id,source.inventory_pool_id,source.room_type,source.meal_plan,source.residency,
            source.date_from,source.date_to,row.amount,source.min_stay,source.refundable]
        );
        kept.push(saved.rows[0].id);
      }
      await client.query('DELETE FROM hotel_offer_rates WHERE offer_id=$1 AND NOT (id=ANY($2::int[]))', [offerId, kept.length ? kept : [0]]);
      await client.query(`UPDATE hotel_offers SET status='draft',rejection_reason=NULL,submitted_at=NULL,updated_at=NOW() WHERE id=$1`, [offerId]);
      await addOfferEvent(client, req, offerId, 'rates_replaced', offer.status, 'draft', null, { rate_count: items.length, cascade: true });
      await client.query('COMMIT');
      return res.json({ ok: true, count: items.length, cascade: true });
    }
    items.forEach((row) => {
      const pool = poolMap.get(row.inventory_pool_id);
      if (pool) row.room_type = String(pool.room_type || '').trim();
    });
    const invalid = items.some((row) => !row.room_type || !row.inventory_pool_id || !poolMap.has(row.inventory_pool_id)
      || !MEAL_PLANS.has(row.meal_plan) || !RESIDENCIES.has(row.residency)
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
    const keptRateIds = [];
    for (const row of items) {
      if (row.id) {
        const updated = await client.query(
          `UPDATE hotel_offer_rates SET inventory_pool_id=$3,room_type=$4,meal_plan=$5,residency=$6,date_from=$7,date_to=$8,
                  amount=$9,allotment=$10,min_stay=$11,refundable=$12,updated_at=NOW()
            WHERE id=$1 AND offer_id=$2 AND source_rate_id IS NULL RETURNING id`,
          [row.id,offerId,row.inventory_pool_id,row.room_type,row.meal_plan,row.residency,row.date_from,row.date_to,row.amount,null,row.min_stay,row.refundable]
        );
        if (updated.rowCount) keptRateIds.push(updated.rows[0].id);
      } else {
        const inserted = await client.query(
        `INSERT INTO hotel_offer_rates
          (offer_id,inventory_pool_id,room_type,meal_plan,residency,date_from,date_to,amount,allotment,min_stay,refundable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [offerId,row.inventory_pool_id,row.room_type,row.meal_plan,row.residency,row.date_from,row.date_to,row.amount,null,row.min_stay,row.refundable]
        );
        keptRateIds.push(inserted.rows[0].id);
      }
    }
    await client.query('DELETE FROM hotel_offer_rates WHERE offer_id=$1 AND source_rate_id IS NULL AND NOT (id=ANY($2::int[]))', [offerId, keptRateIds.length ? keptRateIds : [0]]);
    await client.query(
      `UPDATE hotel_offer_rates child SET
          inventory_pool_id=source.inventory_pool_id,room_type=source.room_type,meal_plan=source.meal_plan,
          residency=source.residency,date_from=source.date_from,date_to=source.date_to,
          allotment=NULL,min_stay=source.min_stay,refundable=source.refundable,updated_at=NOW()
        FROM hotel_offer_rates source
       WHERE child.source_rate_id=source.id AND source.offer_id=$1`,
      [offerId]
    );
    await client.query(
      `UPDATE hotel_offers SET status='draft',rejection_reason=NULL,submitted_at=NULL,updated_at=NOW()
        WHERE id IN (SELECT DISTINCT offer_id FROM hotel_offer_rates WHERE source_rate_id=ANY($1::bigint[]))`,
      [keptRateIds.length ? keptRateIds : [0]]
    );
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

router.get('/:offerId/rates/:rateId/inventory', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId); const rateId = positiveInt(req.params.rateId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer || !rateId) return res.status(404).json({ error: 'rate_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    const from = isoDate(req.query.from); const to = isoDate(req.query.to);
    if (!from || !to || from > to) return res.status(400).json({ error: 'bad_dates' });
    if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366) {
      return res.status(400).json({ error: 'inventory_range_too_large' });
    }
    const rateResult = await db.query(
      `SELECT id,offer_id,room_type,meal_plan,date_from::text,date_to::text,allotment
         FROM hotel_offer_rates WHERE id=$1 AND offer_id=$2 LIMIT 1`, [rateId, offerId]
    );
    if (!rateResult.rowCount) return res.status(404).json({ error: 'rate_not_found' });
    const { rows } = await db.query(
      `SELECT d::date::text AS date,o.allotment,o.stop_sell,o.note,
              COALESCE(SUM(r.quantity) FILTER (WHERE r.status='held' AND r.expires_at>NOW()),0)::int AS held,
              COALESCE(SUM(r.quantity) FILTER (WHERE r.status='confirmed'),0)::int AS confirmed
         FROM generate_series($2::date,$3::date,INTERVAL '1 day') d
         LEFT JOIN hotel_inventory_overrides o ON o.rate_id=$1 AND o.stay_date=d::date
         LEFT JOIN hotel_inventory_reservations r ON r.rate_id=$1 AND r.stay_date=d::date
        WHERE d::date BETWEEN $4::date AND $5::date
        GROUP BY d,o.allotment,o.stop_sell,o.note ORDER BY d`,
      [rateId, from, to, rateResult.rows[0].date_from, rateResult.rows[0].date_to]
    );
    const baseAllotment = rateResult.rows[0].allotment == null ? null : Number(rateResult.rows[0].allotment);
    return res.json({ rate: rateResult.rows[0], items: rows.map((row) => {
      const effective = row.allotment == null ? baseAllotment : Number(row.allotment);
      const used = Number(row.held || 0) + Number(row.confirmed || 0);
      return { ...row, effective_allotment: effective, available: row.stop_sell ? 0 : effective == null ? null : Math.max(0, effective - used) };
    }) });
  } catch (error) { return next(error); }
});

router.put('/:offerId/rates/:rateId/inventory', async (req, res, next) => {
  let client;
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId); const rateId = positiveInt(req.params.rateId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer || !rateId) return res.status(404).json({ error: 'rate_not_found' });
    if (!canEditOffer(req, offer)) return res.status(403).json({ error: 'forbidden' });
    const input = Array.isArray(req.body?.items) ? req.body.items.slice(0, 366) : [];
    const items = input.map((item) => ({
      date: isoDate(item?.date),
      allotment: item?.allotment === '' || item?.allotment == null ? null : Math.max(0, Math.trunc(Number(item.allotment))),
      stop_sell: item?.stop_sell === true,
      note: String(item?.note || '').trim().slice(0, 500) || null,
    }));
    if (!items.length || items.some((item) => !item.date || (item.allotment != null && !Number.isFinite(item.allotment)))) {
      return res.status(400).json({ error: 'bad_inventory_rows' });
    }
    client = await db.connect(); await client.query('BEGIN');
    const rateResult = await client.query(
      `SELECT id,date_from::text,date_to::text FROM hotel_offer_rates WHERE id=$1 AND offer_id=$2 FOR UPDATE`, [rateId, offerId]
    );
    if (!rateResult.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'rate_not_found' }); }
    const rate = rateResult.rows[0];
    if (items.some((item) => item.date < rate.date_from || item.date > rate.date_to)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'inventory_date_outside_rate' });
    }
    for (const item of items) {
      if (item.allotment == null && !item.stop_sell && !item.note) {
        await client.query(`DELETE FROM hotel_inventory_overrides WHERE rate_id=$1 AND stay_date=$2`, [rateId, item.date]);
      } else {
        await client.query(
          `INSERT INTO hotel_inventory_overrides (offer_id,rate_id,stay_date,allotment,stop_sell,note)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (rate_id,stay_date) DO UPDATE SET
             allotment=EXCLUDED.allotment,stop_sell=EXCLUDED.stop_sell,note=EXCLUDED.note,updated_at=NOW()`,
          [offerId, rateId, item.date, item.allotment, item.stop_sell, item.note]
        );
      }
    }
    await addOfferEvent(client, req, offerId, 'inventory_updated', offer.status, offer.status, null, { rate_id: rateId, dates: items.map((item) => item.date) });
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
    if (offer.status === 'pending_review') {
      return res.json({ item: offer, already_submitted: true });
    }
    if (!['draft', 'rejected', 'paused'].includes(offer.status)) {
      return res.status(409).json({ error: 'offer_not_submittable', current_status: offer.status });
    }
    const rateCount = await db.query(`SELECT COUNT(*)::int AS count FROM hotel_offer_rates WHERE offer_id=$1`, [offerId]);
    if (!rateCount.rows[0]?.count) return res.status(409).json({ error: 'rates_required_before_submission' });
    if (dateOnly(offer.valid_to) && dateOnly(offer.valid_to) < new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'offer_expired' });
    const { rows } = await db.query(
      `UPDATE hotel_offers SET status='pending_review',submitted_at=NOW(),rejection_reason=NULL,updated_at=NOW()
        WHERE id=$1 AND status IN ('draft','rejected','paused') RETURNING *`, [offerId]
    );
    if (!rows.length) {
      const current = await getOffer(offerId, hotelId);
      if (current?.status === 'pending_review') {
        return res.json({ item: current, already_submitted: true });
      }
      return res.status(409).json({ error: 'offer_not_submittable', current_status: current?.status || null });
    }
    await addOfferEvent(db, req, offerId, 'submitted', offer.status, 'pending_review');
    notifyHotelOfferSubmitted(offerId)
      .then((result) => {
        if (!result?.ok) console.warn('[hotel-offer] moderation Telegram notification skipped', { offerId, reason: result?.reason || result?.error });
      })
      .catch((error) => {
        console.warn('[hotel-offer] moderation Telegram notification failed', {
          offerId,
          error: error?.message || String(error),
        });
      });
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
    notifyHotelOfferReviewed(offerId, decision, reason)
      .then((result) => {
        if (!result?.ok) console.warn('[hotel-offer] provider Telegram notification skipped', { offerId, decision, reason: result?.reason });
      })
      .catch((error) => {
        console.warn('[hotel-offer] provider Telegram notification failed', {
          offerId,
          decision,
          error: error?.message || String(error),
        });
      });
    return res.json({ item: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/:offerId/events', async (req, res, next) => {
  try {
    await ensureHotelOfferTables();
    const hotelId = positiveInt(req.params.id); const offerId = positiveInt(req.params.offerId);
    const offer = await getOffer(offerId, hotelId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!canEditOffer(req, offer) && !(await canManageHotelInventory(req, hotelId))) return res.status(403).json({ error: 'forbidden' });
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
