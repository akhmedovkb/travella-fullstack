"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ProviderIdentityConflictError,
  collectProviderIdentityMatches,
  normalizeProviderEmail,
  normalizeProviderPhone,
  requireSingleProviderIdentity,
  requireVerifiedProviderLink,
} = require("../utils/providerIdentity");

test("provider identity normalizes email and international phone formats", () => {
  assert.equal(normalizeProviderEmail("  GUIDE@Example.COM "), "guide@example.com");
  assert.equal(normalizeProviderPhone("+998 (90) 123-45-67"), "998901234567");
  assert.equal(normalizeProviderPhone("00998 90 123 45 67"), "998901234567");
});

test("provider identity combines email, phone and Telegram matches for one provider", () => {
  const matches = collectProviderIdentityMatches([
    { id: 148, matched_email: true, matched_phone: false, matched_telegram: false },
    { id: 148, matched_email: false, matched_phone: true, matched_telegram: true },
  ]);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].matchedFields, ["email", "phone", "telegram"]);
  assert.equal(requireSingleProviderIdentity(matches).id, 148);
});

test("provider identity refuses to guess between duplicate provider records", () => {
  const matches = collectProviderIdentityMatches([
    { id: 148, matched_phone: true },
    { id: 163, matched_telegram: true },
  ]);
  assert.throws(
    () => requireSingleProviderIdentity(matches),
    (error) => error instanceof ProviderIdentityConflictError &&
      error.status === 409 &&
      error.providerIds.join(",") === "148,163"
  );
});

test("Telegram linking requires a phone or Telegram match, not an unverified email alone", () => {
  const emailOnly = collectProviderIdentityMatches([
    { id: 148, matched_email: true },
  ]);
  assert.throws(
    () => requireVerifiedProviderLink(emailOnly),
    (error) => error instanceof ProviderIdentityConflictError && error.status === 409
  );

  const phoneMatch = collectProviderIdentityMatches([
    { id: 148, matched_email: true, matched_phone: true },
  ]);
  assert.equal(requireVerifiedProviderLink(phoneMatch).id, 148);
});
