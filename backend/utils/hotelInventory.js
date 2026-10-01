const db = require('../db');
const { ensureHotelOfferTables } = require('./hotelOffersSchema');

class HotelInventoryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
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

async function reserveHotelInventory({ bookingId, providerId, details, holdMinutes = 30 }) {
  const requested = reservationLines(details, providerId);
  const hasManagedQuote = (Array.isArray(details?.hotel_quotes) ? details.hotel_quotes : [])
    .some((quote) => Number(quote?.offer?.provider_id) === Number(providerId) && Number(quote?.offer?.id) > 0);
  if (!requested.length) {
    if (hasManagedQuote) throw new HotelInventoryError('hotel_inventory_lines_required');
    return { count: 0, items: [] };
  }
  if (requested.some((item) => item.quantity > 100)) throw new HotelInventoryError('hotel_inventory_quantity_invalid');
  await ensureHotelOfferTables();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const rateIds = [...new Set(requested.map((item) => item.rateId))];
    const { rows: rates } = await client.query(
      `SELECT r.id,r.offer_id,r.date_from::text,r.date_to::text,r.allotment,
              o.provider_id,o.status AS offer_status,o.valid_from::text,o.valid_to::text
         FROM hotel_offer_rates r
         JOIN hotel_offers o ON o.id=r.offer_id
        WHERE r.id=ANY($1::int[])
        ORDER BY r.id
        FOR UPDATE OF r`,
      [rateIds]
    );
    const rateMap = new Map(rates.map((rate) => [Number(rate.id), rate]));
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
    await client.query('COMMIT');
    return { count: reserved.length, items: reserved };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { HotelInventoryError, reserveHotelInventory, reservationLines };
