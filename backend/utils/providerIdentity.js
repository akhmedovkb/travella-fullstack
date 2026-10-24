"use strict";

class ProviderIdentityConflictError extends Error {
  constructor(matches) {
    super("PROVIDER_IDENTITY_CONFLICT");
    this.name = "ProviderIdentityConflictError";
    this.code = "PROVIDER_IDENTITY_CONFLICT";
    this.status = 409;
    this.providerIds = [...new Set((matches || []).map((row) => Number(row.id)))];
  }
}

function normalizeProviderEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProviderPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

function collectProviderIdentityMatches(rows) {
  const byProvider = new Map();
  for (const row of rows || []) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (!byProvider.has(id)) byProvider.set(id, { ...row, matchedFields: [] });
    const match = byProvider.get(id);
    if (row.matched_email && !match.matchedFields.includes("email")) match.matchedFields.push("email");
    if (row.matched_phone && !match.matchedFields.includes("phone")) match.matchedFields.push("phone");
    if (row.matched_telegram && !match.matchedFields.includes("telegram")) match.matchedFields.push("telegram");
  }
  return [...byProvider.values()];
}

async function lockProviderIdentity(db, { email, phone, telegramId } = {}) {
  const keys = [
    normalizeProviderEmail(email) && `provider:email:${normalizeProviderEmail(email)}`,
    normalizeProviderPhone(phone) && `provider:phone:${normalizeProviderPhone(phone)}`,
    String(telegramId || "").trim() && `provider:telegram:${String(telegramId).trim()}`,
  ].filter(Boolean).sort();

  for (const key of keys) {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  }
}

async function findProviderIdentityMatches(db, { email, phone, telegramId } = {}) {
  const emailNorm = normalizeProviderEmail(email);
  const phoneNorm = normalizeProviderPhone(phone);
  const telegramNorm = String(telegramId || "").trim();
  if (!emailNorm && !phoneNorm && !telegramNorm) return [];

  const result = await db.query(
    `
      SELECT p.*,
             ($1::text <> '' AND LOWER(TRIM(COALESCE(p.email, ''))) = $1) AS matched_email,
             ($2::text <> '' AND REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), '^00', '') = $2) AS matched_phone,
             ($3::text <> '' AND $3 = ANY(ARRAY[
               COALESCE(p.telegram_chat_id::text, ''),
               COALESCE(p.tg_chat_id::text, ''),
               COALESCE(p.telegram_web_chat_id::text, ''),
               COALESCE(p.telegram_refused_chat_id::text, '')
             ])) AS matched_telegram
        FROM providers p
       WHERE ($1::text <> '' AND LOWER(TRIM(COALESCE(p.email, ''))) = $1)
          OR ($2::text <> '' AND REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), '^00', '') = $2)
          OR ($3::text <> '' AND $3 = ANY(ARRAY[
               COALESCE(p.telegram_chat_id::text, ''),
               COALESCE(p.tg_chat_id::text, ''),
               COALESCE(p.telegram_web_chat_id::text, ''),
               COALESCE(p.telegram_refused_chat_id::text, '')
             ]))
       ORDER BY p.id
    `,
    [emailNorm, phoneNorm, telegramNorm]
  );

  return collectProviderIdentityMatches(result.rows);
}

function requireSingleProviderIdentity(matches) {
  if (!matches?.length) return null;
  if (matches.length > 1) throw new ProviderIdentityConflictError(matches);
  return matches[0];
}

function requireVerifiedProviderLink(matches) {
  const provider = requireSingleProviderIdentity(matches);
  if (!provider) return null;
  const verified = provider.matchedFields?.some((field) =>
    field === "phone" || field === "telegram"
  );
  if (!verified) throw new ProviderIdentityConflictError(matches);
  return provider;
}

module.exports = {
  ProviderIdentityConflictError,
  collectProviderIdentityMatches,
  findProviderIdentityMatches,
  lockProviderIdentity,
  normalizeProviderEmail,
  normalizeProviderPhone,
  requireSingleProviderIdentity,
  requireVerifiedProviderLink,
};
