const db = require('../db');
const { ensureHotelOfferTables } = require('./hotelOffersSchema');

class HotelInventoryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function physicalAvailability(baseInventory, overrideInventory, used, stopSell = false) {
  const capacity = overrideInventory == null ? Number(baseInventory) : Number(overrideInventory);
  return stopSell ? 0 : Math.max(0, capacity - Number(used || 0));
}

function supplierAllocationAvailability(allotment, used) {
  return Math.max(0, Number(allotment) - Number(used || 0));
}

function reservationLines(details, providerId) {
  const quotes = Array.isArray(details?.hotel_quotes) ? details.hotel_quotes : [];
  const unique = new Map();
  for (const quote of quotes) {
    const quoteProviderId = Number(quote?.offer?.provider_id ?? quote?.hotel?.provider_id);
    if (!quoteProviderId || quoteProviderId !== Number(providerId)) continue;
    for (const line of Array.isArray(quote?.lines) ? quote.lines : []) {
      const rateId = Number(line?.rate_id);
      const date = String(line?.date || '');
      const quantity = Math.max(0, Math.trunc(Number(line?.quantity || 0)));
      if (!Number.isInteger(rateId) || rateId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !quantity) continue;
      const key = `${rateId}:${date}`;
      const previous = unique.get(key);
      if (!previous || quantity > previous.quantity) unique.set(key, { rateId, date, quantity });
    }
  }
  return [...unique.values()].sort((a, b) => a.rateId - b.rateId || a.date.localeCompare(b.date));
}

async function reserveHotelInventory({ bookingId, providerId, details, holdMinutes = 30, client: transactionClient = null }) {
  const requested = reservationLines(details, providerId);
  const hasManagedQuote = (Array.isArray(details?.hotel_quotes) ? details.hotel_quotes : [])
    .some((quote) => Number(quote?.offer?.provider_id) === Number(providerId) && Number(quote?.offer?.id) > 0);
  if (!requested.length) {
    if (hasManagedQuote) throw new HotelInventoryError('hotel_inventory_lines_required');
    return { count: 0, items: [] };
  }
  if (requested.some((item) => item.quantity > 100)) throw new HotelInventoryError('hotel_inventory_quantity_invalid');
  const ownsTransaction = !transactionClient;
  if (ownsTransaction) await ensureHotelOfferTables();
  const client = transactionClient || await db.connect();
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const rateIds = [...new Set(requested.map((item) => item.rateId))];
    const { rows: rates } = await client.query(
      `SELECT r.id,r.offer_id,r.inventory_pool_id,r.room_type,r.date_from::text,r.date_to::text,r.allotment,
              o.hotel_id,o.provider_id,o.is_direct,o.status AS offer_status,o.valid_from::text,o.valid_to::text
         FROM hotel_offer_rates r
         JOIN hotel_offers o ON o.id=r.offer_id
        WHERE r.id=ANY($1::int[])
        ORDER BY r.id
        FOR UPDATE OF r`,
      [rateIds]
    );
    const rateMap = new Map(rates.map((rate) => [Number(rate.id), rate]));
    const poolIds = [...new Set(rates.map((rate) => Number(rate.inventory_pool_id)).filter((id) => id > 0))];
    const { rows: poolRows } = poolIds.length ? await client.query(
      `SELECT id,hotel_id,room_type,base_inventory
         FROM hotel_room_inventory_pools
        WHERE id=ANY($1::bigint[]) AND active=true
        ORDER BY id FOR UPDATE`,
      [poolIds]
    ) : { rows: [] };
    const pools = new Map(poolRows.map((row) => [Number(row.id), row]));
    const { rows: overrideRows } = await client.query(
      `SELECT rate_id,stay_date::text AS stay_date,allotment,stop_sell
         FROM hotel_inventory_overrides
        WHERE rate_id=ANY($1::int[]) AND stay_date=ANY($2::date[])`,
      [rateIds, [...new Set(requested.map((item) => item.date))]]
    );
    const overrides = new Map(overrideRows.map((row) => [`${row.rate_id}:${row.stay_date}`, row]));
    const { rows: occupiedRows } = await client.query(
      `SELECT rate_id,stay_date::text AS stay_date,COALESCE(SUM(quantity),0)::int AS quantity
         FROM hotel_inventory_reservations
        WHERE rate_id=ANY($1::int[]) AND booking_id<>$2
          AND (status='confirmed' OR (status='held' AND expires_at>NOW()))
        GROUP BY rate_id,stay_date`,
      [rateIds, bookingId]
    );
    const occupied = new Map(occupiedRows.map((row) => [`${row.rate_id}:${row.stay_date}`, Number(row.quantity || 0)]));
    const dates = [...new Set(requested.map((item) => item.date))];
    const poolOverrides = new Map();
    if (poolIds.length) {
      const { rows } = await client.query(
        `SELECT pool_id,stay_date::text AS stay_date,inventory,stop_sell
           FROM hotel_room_inventory_overrides
          WHERE pool_id=ANY($1::bigint[]) AND stay_date=ANY($2::date[])`,
        [poolIds, dates]
      );
      for (const row of rows) poolOverrides.set(`${row.pool_id}:${row.stay_date}`, row);
    }
    const physicalOccupied = new Map();
    if (poolIds.length) {
      const { rows } = await client.query(
        `SELECT r.inventory_pool_id,hir.stay_date::text AS stay_date,
                COALESCE(SUM(hir.quantity),0)::int AS quantity
           FROM hotel_inventory_reservations hir
           JOIN hotel_offer_rates r ON r.id=hir.rate_id
          WHERE r.inventory_pool_id=ANY($1::bigint[])
            AND hir.stay_date=ANY($2::date[]) AND hir.booking_id<>$3
            AND (hir.status='confirmed' OR (hir.status='held' AND hir.expires_at>NOW()))
          GROUP BY r.inventory_pool_id,hir.stay_date`,
        [poolIds, dates, bookingId]
      );
      for (const row of rows) physicalOccupied.set(`${row.inventory_pool_id}:${row.stay_date}`, Number(row.quantity || 0));
    }
    const physicalRequested = new Map();
    for (const item of requested) {
      const rate = rateMap.get(item.rateId);
      if (!rate) continue;
      if (!rate.inventory_pool_id) continue;
      const key = `${rate.inventory_pool_id}:${item.date}`;
      physicalRequested.set(key, (physicalRequested.get(key) || 0) + item.quantity);
    }
    for (const [key, quantity] of physicalRequested) {
      const [poolId, date] = key.split(':');
      const pool = pools.get(Number(poolId));
      if (!pool) continue;
      const override = poolOverrides.get(`${pool.id}:${date}`);
      const used = physicalOccupied.get(key) || 0;
      const available = physicalAvailability(pool.base_inventory, override?.inventory, used, override?.stop_sell === true);
      if (quantity > available) {
        throw new HotelInventoryError(override?.stop_sell === true ? 'hotel_stop_sell' : 'hotel_inventory_exhausted', {
          hotel_id: Number(pool.hotel_id), inventory_pool_id: Number(pool.id), room_type: pool.room_type, date, requested: quantity, available,
        });
      }
    }
    const supplierOccupied = new Map();
    if (poolIds.length) {
      const { rows } = await client.query(
        `SELECT r.inventory_pool_id,hir.stay_date::text AS stay_date,COALESCE(SUM(hir.quantity),0)::int AS quantity
           FROM hotel_inventory_reservations hir
           JOIN hotel_offer_rates r ON r.id=hir.rate_id JOIN hotel_offers o ON o.id=r.offer_id
          WHERE o.provider_id=$1 AND r.inventory_pool_id=ANY($2::bigint[]) AND hir.stay_date=ANY($3::date[])
            AND hir.booking_id<>$4 AND (hir.status='confirmed' OR (hir.status='held' AND hir.expires_at>NOW()))
          GROUP BY r.inventory_pool_id,hir.stay_date`, [providerId,poolIds,dates,bookingId]);
      for (const row of rows) supplierOccupied.set(`${row.inventory_pool_id}:${row.stay_date}`, Number(row.quantity || 0));
    }
    const supplierRequested = new Map();
    const supplierRequiresAllocation = new Map();
    for (const item of requested) {
      const rate = rateMap.get(item.rateId); if (!rate?.inventory_pool_id) continue;
      const key = `${rate.inventory_pool_id}:${item.date}`;
      supplierRequested.set(key, (supplierRequested.get(key) || 0) + item.quantity);
      if (rate.is_direct !== true) supplierRequiresAllocation.set(key, true);
    }
    for (const [key, quantity] of supplierRequested) {
      const [poolId, date] = key.split(':');
      const allocation = await client.query(
        `SELECT allotment FROM hotel_supplier_inventory_allocations
          WHERE provider_id=$1 AND pool_id=$2 AND active=true AND $3::date BETWEEN date_from AND date_to
          ORDER BY updated_at DESC,id DESC LIMIT 1`, [providerId,poolId,date]);
      if (!allocation.rowCount) {
        if (!supplierRequiresAllocation.get(key)) continue;
        throw new HotelInventoryError('hotel_supplier_allocation_exhausted', {
          provider_id: Number(providerId), inventory_pool_id: Number(poolId), date, requested: quantity, available: 0,
        });
      }
      const used = supplierOccupied.get(key) || 0; const limit = Number(allocation.rows[0].allotment);
      const available = supplierAllocationAvailability(limit, used);
      if (quantity > available) throw new HotelInventoryError('hotel_supplier_allocation_exhausted', {
        provider_id: Number(providerId), inventory_pool_id: Number(poolId), date, requested: quantity, available,
      });
    }
    const reserved = [];
    for (const item of requested) {
      const rate = rateMap.get(item.rateId);
      if (!rate || Number(rate.provider_id) !== Number(providerId) || rate.offer_status !== 'active') {
        throw new HotelInventoryError('hotel_rate_not_available', { rate_id: item.rateId, date: item.date });
      }
      if (item.date < rate.date_from || item.date > rate.date_to
        || (rate.valid_from && item.date < rate.valid_from) || (rate.valid_to && item.date > rate.valid_to)) {
        throw new HotelInventoryError('hotel_rate_not_valid_for_date', { rate_id: item.rateId, date: item.date });
      }
      const override = overrides.get(`${item.rateId}:${item.date}`);
      if (override?.stop_sell === true) {
        throw new HotelInventoryError('hotel_stop_sell', { rate_id: item.rateId, date: item.date });
      }
      const effectiveAllotment = override?.allotment != null ? override.allotment : rate.allotment;
      const allotment = effectiveAllotment == null ? null : Number(effectiveAllotment);
      const used = occupied.get(`${item.rateId}:${item.date}`) || 0;
      if (allotment != null && item.quantity > Math.max(0, allotment - used)) {
        throw new HotelInventoryError('hotel_inventory_exhausted', {
          rate_id: item.rateId, date: item.date, requested: item.quantity, available: Math.max(0, allotment - used),
        });
      }
      await client.query(
        `INSERT INTO hotel_inventory_reservations
           (booking_id,offer_id,rate_id,stay_date,quantity,status,expires_at)
         VALUES ($1,$2,$3,$4,$5,'held',NOW()+($6::int * INTERVAL '1 minute'))
         ON CONFLICT (booking_id,rate_id,stay_date) DO UPDATE SET
           quantity=EXCLUDED.quantity,status='held',expires_at=EXCLUDED.expires_at,updated_at=NOW()`,
        [bookingId, rate.offer_id, item.rateId, item.date, item.quantity, holdMinutes]
      );
      reserved.push({ rate_id: item.rateId, date: item.date, quantity: item.quantity,
        available_after: allotment == null ? null : Math.max(0, allotment - used - item.quantity) });
    }
    if (ownsTransaction) await client.query('COMMIT');
    return { count: reserved.length, items: reserved };
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

module.exports = { HotelInventoryError, reserveHotelInventory, reservationLines, physicalAvailability, supplierAllocationAvailability };
