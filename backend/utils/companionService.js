const { ensureServiceModerationEvents } = require('./serviceModerationEvents');
const { normalizeCompanion, normalizeCompanionPrices, CATEGORIES } = require('./companion');
const { buildServiceEditChanges } = require('./serviceEditHistory');
const { isDeepStrictEqual } = require('node:util');
async function readCompanionService(pool, providerId, serviceId, lock = false) {
  const result = await pool.query(`SELECT *,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [serviceId, providerId]);
  const service = result.rows[0];
  if (!service || !CATEGORIES.has(service.category)) throw new Error('Услуга не найдена или не поддерживает поиск попутчика.');
  if (typeof service.details === 'string') service.details = JSON.parse(service.details);
  service.details = service.details || {};
  return service;
}
async function saveCompanion(pool, { providerId, serviceId, version, value, prices }) {
  await ensureServiceModerationEvents(pool);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const service = await readCompanionService(db, providerId, serviceId, true);
    if (service.edit_version !== version) throw new Error('Услуга изменилась. Откройте поиск попутчика заново.');
    if (service.status === 'pending' || service.moderation_status === 'pending' || ['archived', 'deleted'].includes(service.status)) throw new Error('Сейчас менять услугу нельзя. Откройте актуальную карточку.');
    const companion = normalizeCompanion(value, service.category);
    const amounts = companion.enabled ? normalizeCompanionPrices(prices) : {};
    const details = { ...service.details, companion, ...amounts, ...(companion.enabled ? { price: amounts.netPrice } : {}) };
    if (!isDeepStrictEqual(service.details, details)) {
      await db.query("UPDATE services SET details=$3::jsonb,price=COALESCE($4,price),status='draft',moderation_status='draft',submitted_at=NULL,updated_at=NOW() WHERE id=$1 AND provider_id=$2", [serviceId, providerId, JSON.stringify(details), amounts.netPrice ?? null]);
      const changes = buildServiceEditChanges(service, { ...service, details, price: amounts.netPrice ?? service.price });
      await db.query("INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'provider','service_edited',$3::jsonb)", [serviceId, providerId, JSON.stringify({ source: 'telegram_companion', changes })]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
module.exports = { readCompanionService, saveCompanion };
