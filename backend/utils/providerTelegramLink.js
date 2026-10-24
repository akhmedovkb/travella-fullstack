const crypto = require("crypto");

const LINK_TTL_SECONDS = 15 * 60;

function getSecret() {
  const secret = String(
    process.env.PROVIDER_TELEGRAM_LINK_SECRET || process.env.JWT_SECRET || ""
  ).trim();
  if (!secret) throw new Error("PROVIDER_TELEGRAM_LINK_SECRET_NOT_CONFIGURED");
  return secret;
}

function signatureFor(value) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(value)
    .digest("base64url")
    .slice(0, 22);
}

function createProviderTelegramLinkPayload(providerId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = Number(providerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("INVALID_PROVIDER_ID");
  const value = `${id}.${nowSeconds}`;
  return `pl_${value}.${signatureFor(value)}`;
}

function verifyProviderTelegramLinkPayload(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  const match = String(payload || "").match(/^pl_(\d+)\.(\d+)\.([A-Za-z0-9_-]{22})$/);
  if (!match) return null;

  const providerId = Number(match[1]);
  const issuedAt = Number(match[2]);
  const value = `${providerId}.${issuedAt}`;
  const expected = Buffer.from(signatureFor(value));
  const actual = Buffer.from(match[3]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  if (issuedAt > nowSeconds + 60 || nowSeconds - issuedAt > LINK_TTL_SECONDS) return null;

  return { providerId, issuedAt };
}

module.exports = {
  LINK_TTL_SECONDS,
  createProviderTelegramLinkPayload,
  verifyProviderTelegramLinkPayload,
};
