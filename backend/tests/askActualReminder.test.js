const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTUAL_REMINDER_CATEGORIES,
  supportsActualReminderCategory,
} = require("../jobs/askActualReminder");

test("actuality reminders cover refused offers and author tours", () => {
  assert.equal(supportsActualReminderCategory("author_tour"), true);
  assert.equal(supportsActualReminderCategory("refused_tour"), true);
  assert.equal(supportsActualReminderCategory("refused_hotel"), true);
  assert.equal(supportsActualReminderCategory("refused_flight"), true);
  assert.equal(supportsActualReminderCategory("refused_event_ticket"), true);
  assert.equal(new Set(ACTUAL_REMINDER_CATEGORIES).size, ACTUAL_REMINDER_CATEGORIES.length);
});

test("actuality reminders exclude ordinary Tour Builder services", () => {
  assert.equal(supportsActualReminderCategory("guide_full_day"), false);
  assert.equal(supportsActualReminderCategory("transport_intercity"), false);
  assert.equal(supportsActualReminderCategory("marketplace_service"), false);
});
