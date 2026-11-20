const { ensureServiceModerationEvents } = require('./serviceModerationEvents');
const { normalizeGalaDinner, CATEGORIES } = require('./galaDinner');
const { buildServiceEditChanges } = require('./serviceEditHistory');
const { isDeepStrictEqual } = require('node:util');
async function readGalaService(pool, providerId, serviceId, lock = false) {
  const result = await pool.query(`SELECT *,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [serviceId, providerId]);
  const service = result.rows[0];
  if (!service || !CATEGORIES.has(service.category)) throw new Error('Услуга не найдена или не поддерживает гала-ужин.');
  if (typeof service.details === 'string') service.details = JSON.parse(service.details);
  service.details = service.details || {};
  return service;
}
async function saveGalaDinner(pool, { providerId, serviceId, version, value }) {
  await ensureServiceModerationEvents(pool);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const service = await readGalaService(db, providerId, serviceId, true);
    if (service.edit_version !== version) throw new Error('Услуга изменилась. Откройте гала-ужин заново.');
    if (service.status === 'pending' || service.moderation_status === 'pending' || ['archived', 'deleted'].includes(service.status)) throw new Error('Сейчас менять услугу нельзя. Откройте актуальную карточку.');
    const galaDinner = normalizeGalaDinner(value, service.details, service.category);
    if (!isDeepStrictEqual(service.details.galaDinner, galaDinner)) {
      const details = { ...service.details, galaDinner };
      await db.query("UPDATE services SET details=$3::jsonb,status='draft',moderation_status='draft',submitted_at=NULL,updated_at=NOW() WHERE id=$1 AND provider_id=$2", [serviceId, providerId, JSON.stringify(details)]);
      const changes = buildServiceEditChanges(service, { ...service, details });
      await db.query("INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'provider','service_edited',$3::jsonb)", [serviceId, providerId, JSON.stringify({ source: 'telegram_gala_dinner', changes })]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
module.exports = { readGalaService, saveGalaDinner };
