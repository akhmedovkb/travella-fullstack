const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PROVIDER_TELEGRAM_LINK_SECRET = "provider-telegram-link-test-secret";

const {
  LINK_TTL_SECONDS,
  createProviderTelegramLinkPayload,
  verifyProviderTelegramLinkPayload,
} = require("../utils/providerTelegramLink");

test("provider Telegram link accepts a valid signed payload", () => {
  const payload = createProviderTelegramLinkPayload(85, 1_000);
  assert.deepEqual(verifyProviderTelegramLinkPayload(payload, 1_001), {
    providerId: 85,
    issuedAt: 1_000,
  });
});

test("provider Telegram link rejects tampering and expiration", () => {
  const payload = createProviderTelegramLinkPayload(85, 1_000);
  assert.equal(verifyProviderTelegramLinkPayload(payload.replace("pl_85.", "pl_86."), 1_001), null);
  assert.equal(verifyProviderTelegramLinkPayload(payload, 1_000 + LINK_TTL_SECONDS + 1), null);
});
