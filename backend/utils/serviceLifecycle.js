// backend/utils/serviceLifecycle.js

const { assertServiceSubmittable, getProofImages } = require("./serviceSubmitValidation");

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
  deleted_by,
  submitted_at,
  published_at,
  approved_at,
  rejected_at,
  rejected_reason,
  created_at,
  updated_at
`;

const SERVICE_LIFECYCLE_ACTIONS = new Set([
  "submit",
  "extend7",
  "unpublish",
  "archive",
  "restore_active",
  "delete",
  "restore_deleted",
  "purge",
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

async function fetchServiceForLifecycle(pool, providerId, serviceId) {
  const result = await pool.query(
    `SELECT ${DEFAULT_RETURNING}
       FROM services
      WHERE id = $1
        AND provider_id = $2
      LIMIT 1`,
    [serviceId, providerId]
  );
  return result.rows[0] || null;
}

async function assertNoPurgeBlockers(pool, serviceId) {
  const blockers = [];
  const checks = [
    { table: "bookings", field: "service_id", code: "HAS_BOOKINGS" },
    { table: "booking_requests", field: "service_id", code: "HAS_REQUESTS" },
    { table: "client_service_contact_unlocks", field: "service_id", code: "HAS_UNLOCKS" },
    { table: "provider_favorites", field: "service_id", code: "HAS_FAVORITES" },
  ];

  for (const c of checks) {
    try {
      const r = await pool.query(
        `SELECT 1 FROM ${c.table} WHERE ${c.field} = $1 LIMIT 1`,
        [serviceId]
      );
      if (r.rowCount) blockers.push(c.code);
    } catch (e) {
      // Some installations may not have every optional table yet.
      console.warn(`[serviceLifecycle] purge check skipped for ${c.table}:`, e?.message || e);
    }
  }

  if (blockers.length) {
    const err = new Error("PURGE_BLOCKED");
    err.code = "PURGE_BLOCKED";
    err.status = 409;
    err.blockers = blockers;
    throw err;
  }
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

  const before = await fetchServiceForLifecycle(pool, pid, sid);

  if (!before) {
    const err = new Error("SERVICE_NOT_FOUND");
    err.code = "SERVICE_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  let result;

  if (act === "submit") {
    if (before.deleted_at) {
      const err = new Error("SERVICE_DELETED");
      err.code = "SERVICE_DELETED";
      err.status = 409;
      throw err;
    }

    assertServiceSubmittable(before);

    result = await pool.query(
      `UPDATE services
          SET status = 'pending',
              moderation_status = 'pending',
              submitted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND provider_id = $2
          AND deleted_at IS NULL
          AND (status IN ('draft','rejected','pending') OR status IS NULL)
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );

    if (!result.rowCount) {
      const err = new Error("SERVICE_NOT_SUBMITTABLE");
      err.code = "SERVICE_NOT_SUBMITTABLE";
      err.status = 409;
      throw err;
    }
  } else if (act === "unpublish") {
    result = await pool.query(
      `UPDATE services
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
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );
  } else if (act === "extend7") {
    result = await pool.query(
      `UPDATE services
          SET status = CASE
                WHEN status = 'archived' AND COALESCE(moderation_status, '') = 'approved' THEN 'published'
                WHEN status = 'archived' THEN 'draft'
                ELSE status
              END,
              moderation_status = CASE
                WHEN status = 'archived' AND COALESCE(moderation_status, '') <> 'approved' THEN 'draft'
                ELSE moderation_status
              END,
              submitted_at = CASE
                WHEN status = 'archived' AND COALESCE(moderation_status, '') <> 'approved' THEN NULL
                ELSE submitted_at
              END,
              rejected_at = CASE
                WHEN status = 'archived' AND COALESCE(moderation_status, '') <> 'approved' THEN NULL
                ELSE rejected_at
              END,
              rejected_reason = CASE
                WHEN status = 'archived' AND COALESCE(moderation_status, '') <> 'approved' THEN NULL
                ELSE rejected_reason
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
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );
  } else if (act === "archive") {
    result = await pool.query(
      `UPDATE services
          SET status = 'archived',
              expiration_at = COALESCE(expiration_at, NOW()),
              details = jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                                  '{isActive}', 'false'::jsonb, true),
              updated_at = NOW()
        WHERE id = $1
          AND provider_id = $2
          AND deleted_at IS NULL
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );
  } else if (act === "restore_active") {
    result = await pool.query(
      `UPDATE services
          SET status = CASE
                WHEN COALESCE(moderation_status, '') = 'approved' THEN 'published'
                ELSE 'draft'
              END,
              moderation_status = CASE
                WHEN COALESCE(moderation_status, '') = 'approved' THEN moderation_status
                ELSE 'draft'
              END,
              submitted_at = CASE
                WHEN COALESCE(moderation_status, '') = 'approved' THEN submitted_at
                ELSE NULL
              END,
              rejected_at = CASE
                WHEN COALESCE(moderation_status, '') = 'approved' THEN rejected_at
                ELSE NULL
              END,
              rejected_reason = CASE
                WHEN COALESCE(moderation_status, '') = 'approved' THEN rejected_reason
                ELSE NULL
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
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );
  } else if (act === "delete") {
    result = await pool.query(
      `UPDATE services
          SET status = 'deleted',
              deleted_at = NOW(),
              deleted_by = $2,
              updated_at = NOW()
        WHERE id = $1
          AND provider_id = $2
          AND deleted_at IS NULL
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );

    if (!result.rowCount) {
      const err = new Error(before.deleted_at ? "ALREADY_DELETED" : "DELETE_FAILED");
      err.code = before.deleted_at ? "ALREADY_DELETED" : "DELETE_FAILED";
      err.status = 409;
      throw err;
    }
  } else if (act === "restore_deleted") {
    result = await pool.query(
      `UPDATE services
          SET deleted_at = NULL,
              deleted_by = NULL,
              status = 'draft',
              moderation_status = 'draft',
              submitted_at = NULL,
              published_at = NULL,
              approved_at = NULL,
              rejected_at = NULL,
              rejected_reason = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND provider_id = $2
          AND deleted_at IS NOT NULL
        RETURNING ${DEFAULT_RETURNING}`,
      [sid, pid]
    );

    if (!result.rowCount) {
      const err = new Error("NOT_DELETED");
      err.code = "NOT_DELETED";
      err.status = 409;
      throw err;
    }
  } else if (act === "purge") {
    if (!before.deleted_at) {
      const err = new Error("NOT_IN_TRASH");
      err.code = "NOT_IN_TRASH";
      err.status = 409;
      throw err;
    }

    await assertNoPurgeBlockers(pool, sid);

    result = await pool.query(
      `DELETE FROM services
        WHERE id = $1
          AND provider_id = $2
          AND deleted_at IS NOT NULL
        RETURNING id`,
      [sid, pid]
    );

    if (!result.rowCount) {
      const err = new Error("PURGE_FAILED");
      err.code = "PURGE_FAILED";
      err.status = 409;
      throw err;
    }

    return {
      rowCount: result.rowCount,
      service: null,
      before,
      purgedId: result.rows[0]?.id || sid,
    };
  }

  if (!result?.rowCount) {
    const err = new Error("SERVICE_NOT_FOUND_OR_DELETED");
    err.code = "SERVICE_NOT_FOUND_OR_DELETED";
    err.status = 404;
    throw err;
  }

  return {
    rowCount: result.rowCount,
    service: result.rows[0] || null,
    before,
  };
}


function getServiceLifecycleState(service = {}) {
  const status = String(service.status || "").toLowerCase();
  const moderationStatus = String(service.moderation_status || "").toLowerCase();

  if (service.deleted_at || status === "deleted") return "deleted";
  if (status === "archived") return "archived";
  if (status === "pending" || moderationStatus === "pending") return "pending";
  if (status === "rejected" || moderationStatus === "rejected") return "rejected";
  if (status === "published" || status === "active" || status === "approved") return "published";
  return "draft";
}

function getServiceLifecycleLabel(service = {}) {
  const state = getServiceLifecycleState(service);
  const labels = {
    draft: "Черновик",
    pending: "На модерации",
    rejected: "Отклонено",
    published: "Опубликовано",
    archived: "Архив",
    deleted: "Корзина",
  };
  return labels[state] || labels.draft;
}

module.exports = {
  SERVICE_LIFECYCLE_ACTIONS,
  applyServiceLifecycleAction,
  fetchServiceForLifecycle,
  getProofImages,
  getServiceLifecycleState,
  getServiceLifecycleLabel,
};
