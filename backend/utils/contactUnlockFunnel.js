//backend/utils/contactUnlockFunnel.js

const pool = require("../db");

function toNullableInt(x) {
  if (x === undefined || x === null || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toSafeText(x, fallback = null) {
  if (x === undefined || x === null) return fallback;
  const s = String(x).trim();
  return s ? s : fallback;
}

async function resolveProviderId(db, serviceId) {
  const sid = toNullableInt(serviceId);
  if (!sid || sid <= 0) return null;

  const { rows } = await db.query(
    `
    SELECT provider_id
    FROM services
    WHERE id = $1
    LIMIT 1
    `,
    [sid]
  );

  const providerId = toNullableInt(rows?.[0]?.provider_id);
  return providerId && providerId > 0 ? providerId : null;
}

async function logUnlockFunnel(dbOrPayload, maybePayload = null) {
  let db = pool;
  let payload = dbOrPayload;

  if (
    dbOrPayload &&
    typeof dbOrPayload === "object" &&
    typeof dbOrPayload.query === "function"
  ) {
    db = dbOrPayload;
    payload = maybePayload;
  }

  const clientId = toNullableInt(payload?.clientId);
  const serviceId = toNullableInt(payload?.serviceId);

  if (!clientId || clientId <= 0) {
    throw new Error("logUnlockFunnel: bad clientId");
  }
  if (!serviceId || serviceId <= 0) {
    throw new Error("logUnlockFunnel: bad serviceId");
  }

  let providerId = toNullableInt(payload?.providerId);
  if (!providerId || providerId <= 0) {
    providerId = await resolveProviderId(db, serviceId);
  }

  const source = toSafeText(payload?.source, "web");
  const step = toSafeText(payload?.step);
  if (!step) {
    throw new Error("logUnlockFunnel: step is required");
  }

  const status = toSafeText(payload?.status, null);
  const priceTiyin = Math.max(0, toNullableInt(payload?.priceTiyin) || 0);

  const balanceBefore = toNullableInt(payload?.balanceBefore);
  const balanceAfter = toNullableInt(payload?.balanceAfter);

  const paymeId = toSafeText(payload?.paymeId, null);
  const orderId = toNullableInt(payload?.orderId);
  const sessionKey = toSafeText(payload?.sessionKey, null);

  const meta =
    payload?.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)
      ? payload.meta
      : null;

  const { rows } = await db.query(
    `
    INSERT INTO contact_unlock_funnel (
      client_id,
      service_id,
      provider_id,
      source,
      step,
      status,
      price_tiyin,
      balance_before,
      balance_after,
      payme_id,
      order_id,
      session_key,
      meta
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb
    )
    RETURNING id, created_at
    `,
    [
      clientId,
      serviceId,
      providerId,
      source,
      step,
      status,
      priceTiyin,
      balanceBefore,
      balanceAfter,
      paymeId,
      orderId,
      sessionKey,
      meta ? JSON.stringify(meta) : null,
    ]
  );

  return rows?.[0] || null;
}

module.exports = {
  logUnlockFunnel,
};
