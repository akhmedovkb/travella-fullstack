const test = require("node:test");
const assert = require("node:assert/strict");
const helpers = () => import("../../frontend/src/utils/moderationEditor.js");
test("editor rejects impossible calendar dates and reversed trip dates", async () => {
  const { validateModerationEditor } = await helpers();
  assert.ok(validateModerationEditor({}, { startDate: "2026-02-30" }).startDate);
  assert.ok(validateModerationEditor({}, { startDate: "2026-11-10", endDate: "2026-11-09" }).endDate);
  assert.deepEqual(validateModerationEditor({}, { startDate: "2028-02-29", endDate: "2028-03-01" }), {});
});
test("editor validates numbers, zero, comma decimals and gross/net relationship", async () => {
  const { validateModerationEditor } = await helpers();
  assert.ok(validateModerationEditor({ price: "-1" }).price);
  assert.ok(validateModerationEditor({}, { netPrice: "abc" }).netPrice);
  assert.ok(validateModerationEditor({}, { netPrice: "100", grossPrice: "90" }).grossPrice);
  assert.deepEqual(validateModerationEditor({ price: "0" }, { netPrice: "1 000,50", grossPrice: "1200.50" }), {});
});
test("unchanged provider contacts are omitted so unrelated saves cannot overwrite them", async () => {
  const { changedProviderContacts } = await helpers();
  assert.deepEqual(changedProviderContacts({ telegram_chat_id: "100", telegram_web_chat_id: "" }, { telegram_chat_id: "100", telegram_web_chat_id: null }), {});
  assert.deepEqual(changedProviderContacts({ telegram_chat_id: "" }, { telegram_chat_id: "100" }), { telegram_chat_id: "" });
});
