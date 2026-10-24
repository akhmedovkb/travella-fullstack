const test = require("node:test");
const assert = require("node:assert/strict");
const { isRegistrationCallbackData } = require("../utils/telegramRegistration");

test("allows every callback required by provider registration", () => {
  for (const value of [
    "role:client",
    "role:provider",
    "provider_type:agent",
    "provider_type:guide",
    "provider_type:transport",
    "provider_type:hotel",
    "provider_type:back",
  ]) {
    assert.equal(isRegistrationCallbackData(value), true, value);
  }
});

test("does not let unrelated callbacks bypass the registration guard", () => {
  for (const value of ["prov_services:list", "quick:42", "provider_type:admin", ""]) {
    assert.equal(isRegistrationCallbackData(value), false, value);
  }
});
