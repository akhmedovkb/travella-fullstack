const { excludedCountries } = require('./groupAssistantCountries');
const { normalizeIntent, CATEGORIES } = require('./groupAssistantModel');
const { isServiceActual } = require('../telegram/helpers/serviceActual');
const clean = (value, length = 120) => String(value || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length);
const GROSS = "COALESCE(NULLIF(s.details->>'grossPrice',''),NULLIF(s.details->>'gross_price',''),NULLIF(s.details->>'clientPrice',''))";
const MONEY = `CASE WHEN REPLACE(${GROSS},',','.') ~ '^\\d+(\\.\\d{1,2})?$' THEN REPLACE(${GROSS},',','.')::numeric ELSE NULL END`;
const CURRENCY = "UPPER(COALESCE(NULLIF(s.details->>'currency',''),NULLIF(s.currency,''),'USD'))";
const START = "SUBSTRING(COALESCE(NULLIF(s.details->>'startDate',''),NULLIF(s.details->>'checkInDate',''),s.details->>'departureFlightDate') FROM 1 FOR 10)";
const countValue = keys => keys.map(key => `CASE WHEN s.details->>'${key}' ~ '^[0-9]{1,2}$' THEN NULLIF((s.details->>'${key}')::int,0) END`);
const accommodationCount = pattern => `NULLIF(SUBSTRING(LOWER(COALESCE(s.details->>'accommodation','')) FROM '${pattern}')::int,0)`;
const ADULTS = `COALESCE(${countValue(['adt','adults','accommodationADT','passengersCount']).join(',')},${accommodationCount('([0-9]{1,2})[[:space:]]*(adl|adt|adult|взр)')},CASE WHEN LOWER(s.details->>'accommodation') ~ '(^|[^a-z])dbl([^a-z]|$)' THEN 2 END)`;
const CHILDREN = `COALESCE(${countValue(['chd','children','accommodationCHD']).join(',')},${accommodationCount('([0-9]{1,2})[[:space:]]*(chd|child|реб)')},0)`;
const INFANTS = `COALESCE(${countValue(['inf','infants','accommodationINF']).join(',')},${accommodationCount('([0-9]{1,2})[[:space:]]*(inf|млад)')},0)`;
const BASIS = `CASE WHEN s.details->>'pricePeriod'='night' OR (s.details ? 'surchargesStatus' AND COALESCE(s.details->>'surchargesStatus','')<>'none') THEN 'unknown' WHEN s.details->>'priceBasis'='person' THEN 'person' WHEN s.details->>'priceBasis'='total' THEN 'total' WHEN s.details->>'priceBasis'='room' THEN 'unknown' WHEN s.details->'companion'->>'priceBasis'='per_person' OR LOWER(COALESCE(s.details->>'priceFor',s.details->>'pricePer','')) IN ('person','per_person','per person','за человека','за 1 человека') OR s.details->>'pricePerPerson'='true' THEN 'person' WHEN s.details->>'priceFor' IN ('total','tour','room') THEN 'total' WHEN s.category IN ('refused_tour','refused_hotel') AND COALESCE(NULLIF(s.details->>'priceFor',''),NULLIF(s.details->>'pricePer',''),NULLIF(s.details->>'priceDescription',''),NULLIF(s.details->>'priceComment',''),NULLIF(s.details->>'priceNote',''),NULLIF(s.details->>'pricePerPerson',''),NULLIF(s.details->>'perPersonPrice',''),NULLIF(s.details->>'price_per_person','')) IS NULL AND ${ADULTS}>1 AND ${CHILDREN}=0 AND ${INFANTS}=0 THEN 'total' ELSE 'unknown' END`;

function buildSearch(filters) {
  const f = normalizeIntent({ kind: 'search', filters }).filters;
  const args = [];
  const param = value => { args.push(value); return `$${args.length}`; };
  const where = ["s.deleted_at IS NULL", "LOWER(s.status) IN ('published','active','approved')", "LOWER(COALESCE(s.moderation_status,'')) IN ('published','active','approved')", "COALESCE(LOWER(s.details->>'isActive'),'true') NOT IN ('false','0','no')", "(s.expiration_at IS NULL OR s.expiration_at>NOW())", `s.category=ANY(${param(f.category ? [f.category] : CATEGORIES)}::text[])`];
  const patterns = values => values.map(value => `%${value.replace(/[\\%_]/g, '\\$&')}%`);
  if (f.destination.length) where.push(`CONCAT_WS(' ',s.details->>'directionCountry',s.details->>'country',s.details->>'directionTo',s.details->>'toCity',s.details->>'city',s.details->>'location') ILIKE ANY(${param(patterns(f.destination))}::text[])`);
  if (f.origin.length) where.push(`CONCAT_WS(' ',s.details->>'directionFrom',s.details->>'fromCity') ILIKE ANY(${param(patterns(f.origin))}::text[])`);
  const excluded = excludedCountries(f.excludedCountries, f.excludeArab);
  if (excluded.length) {
    const country = "CONCAT_WS(' ',s.details->>'directionCountry',s.details->>'country')";
    const excludedParam = param(excluded);
    const normalized = key => `LOWER(TRIM(REGEXP_REPLACE(COALESCE(s.details->>'${key}',''),'[^[:alnum:]]+',' ','g')))`;
    where.push(`TRIM(${country})<>''`, `NOT (${normalized('directionCountry')}=ANY(${excludedParam}::text[]) OR ${normalized('country')}=ANY(${excludedParam}::text[]))`);
  }
  if (f.guests !== null) where.push(`${ADULTS}=${param(f.guests)}`, `${CHILDREN}=0`, `${INFANTS}=0`);
  if (f.start) where.push(`${START}>=${param(f.start)}`);
  if (f.end || f.start) where.push(`${START}<=${param(f.end || f.start)}`);
  if (f.companion) where.push("s.details->'companion'->>'enabled'='true'");
  if (f.gender && f.gender !== 'any') where.push(`s.details->'companion'->>'gender' IN (${param(f.gender)},'any')`);
  if (f.budget !== null) {
    if (!f.currency || !f.priceBasis) throw new Error('BUDGET_NEEDS_CLARIFICATION');
    where.push(`${MONEY}<=${param(f.budget)}`, `${CURRENCY}=${param(f.currency)}`, `${BASIS}=${param(f.priceBasis)}`);
  }
  return { sql: `SELECT s.id,s.title,s.category,s.expiration_at,${MONEY} AS public_price,${CURRENCY} AS currency,${BASIS} AS price_basis,${ADULTS} AS adults,${CHILDREN} AS children,${INFANTS} AS infants,
    jsonb_build_object('startDate',s.details->>'startDate','endDate',s.details->>'endDate','checkInDate',s.details->>'checkInDate','checkOutDate',s.details->>'checkOutDate',
      'departureFlightDate',s.details->>'departureFlightDate','returnFlightDate',s.details->>'returnFlightDate','expiration',s.details->>'expiration','isActive',s.details->>'isActive') AS details,
    s.details->>'directionFrom' AS origin,s.details->>'directionTo' AS destination,s.details->>'directionCountry' AS country,
    s.details->>'hotel' AS hotel,s.details->'companion'->>'gender' AS companion_gender,s.details->'companion'->>'room' AS companion_room,
    s.details->'companion'->>'enabled' AS companion_enabled, s.details->'galaDinner'->>'status' AS gala_status,
    s.details->'galaDinner'->>'adultPrice' AS gala_adult_price,s.details->'galaDinner'->>'currency' AS gala_currency
    FROM services s WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC,s.id DESC LIMIT 30`, args };
}
async function searchGroupOffers(pool, filters) {
  const { sql, args } = buildSearch(filters);
  const result = await pool.query(sql, args);
  return result.rows.filter(row => isServiceActual(row.details, row)).slice(0, 5).map(row => ({
    id: Number(row.id), title: clean(row.title), category: row.category,
    origin: clean(row.origin, 60), destination: clean(row.destination || row.country, 60), hotel: clean(row.hotel),
    start: clean(row.details?.startDate || row.details?.checkInDate || row.details?.departureFlightDate, 10),
    end: clean(row.details?.endDate || row.details?.checkOutDate || row.details?.returnFlightDate, 10),
    price: row.public_price === null || row.public_price === undefined ? null : Number(row.public_price), currency: clean(row.currency, 3), priceBasis: row.price_basis, guests: row.adults && !Number(row.children) && !Number(row.infants) ? Number(row.adults) : null,
    gala: ['mandatory','optional'].includes(row.gala_status) ? { status: row.gala_status, adultPrice: clean(row.gala_adult_price, 20), currency: clean(row.gala_currency, 3) } : null,
    companion: row.companion_enabled === 'true', gender: row.companion_gender, room: row.companion_room,
    url: `https://travella.uz/marketplace?opened=${Number(row.id)}`,
  }));
}
module.exports = { buildSearch, searchGroupOffers };
