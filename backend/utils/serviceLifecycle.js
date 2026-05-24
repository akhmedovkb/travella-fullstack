// backend/utils/serviceLifecycle.js

const DEFAULT_RETURNING = `
  id,
  provider_id,
  category,
  title,
  description,
  price,
  images,
  availability,
  details,
  vehicle_model,
  status,
  moderation_status,
  expiration_at,
  deleted_at,
  created_at,
  updated_at
`;

const SERVICE_LIFECYCLE_ACTIONS = new Set([
  "extend7",
  "unpublish",
  "archive",
  "restore_active",
]);

function normalizeLifecycleAction(action) {
  return String(action || "").trim();
}

function assertLifecycleAction(action) {
  const normalized = normalizeLifecycleAction(action);
  if (!SERVICE_LIFECYCLE_ACTIONS.has(normalized)) {
    const err = new Error("UNKNOWN_SERVICE_LIFECYCLE_ACTION");
    err.code = "UNKNOWN_SERVICE_LIFECYCLE_ACTION";
    err.status = 400;
    throw err;
  }
  return normalized;
}

async function applyServiceLifecycleAction(pool, { providerId, serviceId, action }) {
  const pid = Number(providerId);
  const sid = Number(serviceId);
  const act = assertLifecycleAction(action);

  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(sid) || sid <= 0) {
    const err = new Error("BAD_SERVICE_OR_PROVIDER_ID");
    err.code = "BAD_SERVICE_OR_PROVIDER_ID";
    err.status = 400;
    throw err;
  }

  let sql;

  if (act === "unpublish") {
    // Снять с витрины: услуга остаётся в истории, но перестаёт быть актуальной.
    // status намеренно переводим в archived, чтобы web и Telegram одинаково не показывали её в актуальных.
    sql = `
      UPDATE services
         SET status = 'archived',
             expiration_at = NOW(),
             details = jsonb_set(
               jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                         '{isActive}', 'false'::jsonb, true),
               '{expiration}', to_jsonb(NOW()::timestamp)::jsonb, true
             ),
             updated_at = NOW()
       WHERE id = $1
         AND provider_id = $2
         AND deleted_at IS NULL
       RETURNING ${DEFAULT_RETURNING}
    `;
  } else if (act === "extend7") {
    sql = `
      UPDATE services
         SET status = CASE
               WHEN status = 'archived' AND COALESCE(moderation_status, '') = 'approved' THEN 'published'
               ELSE status
             END,
             expiration_at = COALESCE(expiration_at, NOW()) + interval '7 days',
             details = jsonb_set(
               jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                         '{isActive}', 'true'::jsonb, true),
               '{expiration}',
               to_jsonb((COALESCE(expiration_at, NOW()) + interval '7 days')::timestamp)::jsonb,
               true
             ),
             updated_at = NOW()
       WHERE id = $1
         AND provider_id = $2
         AND deleted_at IS NULL
       RETURNING ${DEFAULT_RETURNING}
    `;
  } else if (act === "archive") {
    sql = `
      UPDATE services
         SET status = 'archived',
             expiration_at = COALESCE(expiration_at, NOW()),
             details = jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                                 '{isActive}', 'false'::jsonb, true),
             updated_at = NOW()
       WHERE id = $1
         AND provider_id = $2
         AND deleted_at IS NULL
       RETURNING ${DEFAULT_RETURNING}
    `;
  } else if (act === "restore_active") {
    sql = `
      UPDATE services
         SET status = CASE
               WHEN COALESCE(moderation_status, '') = 'approved' THEN 'published'
               WHEN status = 'archived' THEN 'published'
               ELSE status
             END,
             expiration_at = NOW() + interval '7 days',
             details = jsonb_set(
               jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                         '{isActive}', 'true'::jsonb, true),
               '{expiration}', to_jsonb((NOW() + interval '7 days')::timestamp)::jsonb, true
             ),
             updated_at = NOW()
       WHERE id = $1
         AND provider_id = $2
         AND deleted_at IS NULL
       RETURNING ${DEFAULT_RETURNING}
    `;
  }

  const result = await pool.query(sql, [sid, pid]);
  return {
    rowCount: result.rowCount,
    service: result.rows[0] || null,
  };
}

module.exports = {
  SERVICE_LIFECYCLE_ACTIONS,
  applyServiceLifecycleAction,
};
