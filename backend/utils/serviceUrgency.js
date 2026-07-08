// backend/utils/serviceUrgency.js
// Единая производная срочность услуги: только от срока актуальности.
// Ручной выбор срочности поставщиком не используется.

function parseExpiration(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveServiceExpiration(serviceOrDetails = {}) {
  const d = serviceOrDetails?.details && typeof serviceOrDetails.details === "object"
    ? serviceOrDetails.details
    : serviceOrDetails;
  return (
    serviceOrDetails?.expiration_at ||
    serviceOrDetails?.expires_at ||
    d?.expiration_at ||
    d?.expires_at ||
    d?.expiration ||
    d?.expiration_ts ||
    null
  );
}

function getServiceUrgency(expirationValue, nowValue = new Date()) {
  const expiresAt = parseExpiration(expirationValue);
  const now = parseExpiration(nowValue) || new Date();

  if (!expiresAt) {
    return {
      code: "unknown",
      label: "Актуальность не указана",
      badge: "⚪ Без срока",
      priority: 0,
      expired: false,
      remainingMs: null,
    };
  }

  const remainingMs = expiresAt.getTime() - now.getTime();
  const hours = remainingMs / 36e5;

  if (remainingMs <= 0) {
    return { code: "expired", label: "Истекло", badge: "🔴 Истекло", priority: 0, expired: true, remainingMs };
  }
  if (hours <= 6) {
    return { code: "critical", label: "Очень срочно", badge: "🔥 Очень срочно", priority: 100, expired: false, remainingMs };
  }
  if (hours <= 24) {
    return { code: "high", label: "Срочно", badge: "⚡ Срочно", priority: 80, expired: false, remainingMs };
  }
  if (hours <= 72) {
    return { code: "medium", label: "Скоро истекает", badge: "🟡 Скоро истекает", priority: 50, expired: false, remainingMs };
  }
  return { code: "normal", label: "Актуально", badge: "🟢 Актуально", priority: 10, expired: false, remainingMs };
}

function getServiceUrgencyFromService(serviceOrDetails = {}, nowValue = new Date()) {
  return getServiceUrgency(resolveServiceExpiration(serviceOrDetails), nowValue);
}

module.exports = {
  parseExpiration,
  resolveServiceExpiration,
  getServiceUrgency,
  getServiceUrgencyFromService,
};
