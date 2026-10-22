const test = require("node:test");
const assert = require("node:assert/strict");
const { actorMatchesProfile, profileChatId } = require("../utils/tourServiceOrderResponse");

test("matches a supplier against every supported Telegram chat field", () => {
  assert.equal(actorMatchesProfile(123, { telegram_chat_id: "123" }), true);
  assert.equal(actorMatchesProfile("456", { telegram_refused_chat_id: 456 }), true);
  assert.equal(actorMatchesProfile(789, { tg_chat_id: "123" }), false);
  assert.equal(actorMatchesProfile(null, { telegram_chat_id: "123" }), false);
});

test("selects the highest-priority Telegram chat field", () => {
  assert.equal(profileChatId({ telegram_web_chat_id: 10, telegram_chat_id: 20 }), 10);
  assert.equal(profileChatId({ tg_chat_id: 30 }), 30);
  assert.equal(profileChatId({}), null);
});
