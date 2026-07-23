"use strict";

const PROVIDER_TELEGRAM_ID_AMBIGUOUS = "PROVIDER_TELEGRAM_ID_AMBIGUOUS";
const PROVIDER_TELEGRAM_ID_INVALID = "PROVIDER_TELEGRAM_ID_INVALID";

class ProviderTelegramResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderTelegramResolutionError";
    this.code = code;
    this.status = code === PROVIDER_TELEGRAM_ID_INVALID ? 400 : 409;
    Object.assign(this, details);
  }
}

function normalizeTelegramActorId(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,20}$/.test(text) || text === "0") {
    throw new ProviderTelegramResolutionError(
      PROVIDER_TELEGRAM_ID_INVALID,
      "Telegram actor ID must be a positive integer"
    );
  }
  return text;
}

async function resolveProviderByTelegramActorId(db, actorTelegramId, options = {}) {
  const actorId = normalizeTelegramActorId(actorTelegramId);
  const includeWebChatId = options.includeWebChatId === true;
  const fieldRows = [
    `('telegram_refused_chat_id', p.telegram_refused_chat_id::text, 1)`,
    `('telegram_chat_id', p.telegram_chat_id::text, 2)`,
    `('tg_chat_id', p.tg_chat_id::text, 3)`,
  ];
  if (includeWebChatId) {
    fieldRows.push(`('telegram_web_chat_id', p.telegram_web_chat_id::text, 4)`);
  }

  const result = await db.query(
    `
      SELECT p.id, match.field_name
        FROM providers p
        CROSS JOIN LATERAL (
          VALUES ${fieldRows.join(",\n                 ")}
        ) AS match(field_name, field_value, field_priority)
       WHERE match.field_value = $1
       ORDER BY match.field_priority, p.id
    `,
    [actorId]
  );

  const matchesByProvider = new Map();
  for (const row of result.rows || []) {
    const providerId = Number(row.id);
    if (!matchesByProvider.has(providerId)) matchesByProvider.set(providerId, []);
    matchesByProvider.get(providerId).push(row.field_name);
  }

  const providerIds = [...matchesByProvider.keys()];
  const diagnostic = {
    actorTelegramId: actorId,
    ctxFromId: options.ctxFromId ? String(options.ctxFromId) : null,
    ctxChatId: options.ctxChatId ? String(options.ctxChatId) : null,
    matchedProviderIds: providerIds,
    matchedFields: Object.fromEntries(matchesByProvider),
    endpoint: options.endpoint || null,
    action: options.action || null,
    serviceId: options.serviceId ? Number(options.serviceId) : null,
    draftId: options.draftId ? Number(options.draftId) : null,
  };

  if (providerIds.length > 1) {
    console.error("[provider-telegram-resolver] ambiguous", diagnostic);
    throw new ProviderTelegramResolutionError(
      PROVIDER_TELEGRAM_ID_AMBIGUOUS,
      "Telegram actor ID is linked to multiple providers",
      diagnostic
    );
  }

  if (options.log !== false) {
    console.info("[provider-telegram-resolver] resolved", {
      ...diagnostic,
      resolvedProviderId: providerIds[0] || null,
      matchedField: providerIds.length ? matchesByProvider.get(providerIds[0])[0] : null,
    });
  }

  if (!providerIds.length) return null;
  return {
    id: providerIds[0],
    matchedField: matchesByProvider.get(providerIds[0])[0],
    matchedFields: matchesByProvider.get(providerIds[0]),
  };
}

module.exports = {
  PROVIDER_TELEGRAM_ID_AMBIGUOUS,
  PROVIDER_TELEGRAM_ID_INVALID,
  ProviderTelegramResolutionError,
  normalizeTelegramActorId,
  resolveProviderByTelegramActorId,
};
