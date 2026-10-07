"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const CLIENT_TOKEN = "123456:client-test-token";
const PROVIDER_TOKEN = "654321:provider-test-token";

process.env.TELEGRAM_CLIENT_BOT_TOKEN = CLIENT_TOKEN;
process.env.TELEGRAM_PROVIDER_BOT_TOKEN = PROVIDER_TOKEN;

const { verifyTelegramAuth } = require("../controllers/telegramWebAuthController");
const { verifyTelegramLogin } = require("../controllers/providerTelegramAuthController");

function signedPayload(token, payload, { includeRole = false } = {}) {
  const data = { ...payload };
  const check = Object.keys(data)
    .filter((key) => (includeRole || key !== "role") && data[key] !== "")
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");
  const secret = crypto.createHash("sha256").update(token).digest();
  return {
    ...data,
    hash: crypto.createHmac("sha256", secret).update(check).digest("hex"),
  };
}

test("client Telegram login accepts a current payload signed by the client bot", () => {
  const payload = signedPayload(CLIENT_TOKEN, {
    id: "10001",
    auth_date: Math.floor(Date.now() / 1000),
    first_name: "Client",
    role: "client",
  });
  assert.deepEqual(verifyTelegramAuth(payload), { ok: true });
});

test("client Telegram login rejects a provider-bot signature", () => {
  const payload = signedPayload(PROVIDER_TOKEN, {
    id: "10002",
    auth_date: Math.floor(Date.now() / 1000),
    first_name: "Wrong bot",
    role: "client",
  });
  assert.equal(verifyTelegramAuth(payload).error, "telegram_bad_hash");
});

test("provider Telegram login accepts a current provider-bot payload", () => {
  const payload = signedPayload(PROVIDER_TOKEN, {
    id: "20001",
    auth_date: Math.floor(Date.now() / 1000),
    first_name: "Provider",
  });
  assert.equal(verifyTelegramLogin(payload).id, "20001");
});

test("provider Telegram login rejects an expired payload", () => {
  const payload = signedPayload(PROVIDER_TOKEN, {
    id: "20002",
    auth_date: Math.floor(Date.now() / 1000) - 90000,
    first_name: "Expired",
  });
  assert.throws(() => verifyTelegramLogin(payload), /TELEGRAM_AUTH_EXPIRED/);
});
