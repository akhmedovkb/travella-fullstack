const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CAMPAIGNS,
  formatLesson,
  lessonKeyboard,
} = require("../services/telegramLearningService");
const { tashkentHour } = require("../jobs/telegramLearningJob");

test("learning campaigns cover clients and providers with ordered lessons", () => {
  assert.deepEqual(CAMPAIGNS.map((item) => item.audience).sort(), ["client", "provider"]);
  for (const campaign of CAMPAIGNS) {
    assert.ok(campaign.lessons.length >= 5);
    assert.equal(campaign.lessons[0].delayHours, 0);
    assert.ok(campaign.lessons.every((lesson) => lesson.title && lesson.message));
  }
});

test("lesson formatter and keyboard produce a compact guided step", () => {
  const row = {
    lesson_id: 7,
    position: 2,
    lesson_count: 7,
    lesson_title: "Создание предложения",
    message_html: "Текст урока",
    action_kind: "create_offer",
    action_label: "Создать предложение",
  };
  assert.match(formatLesson(row), /Урок 2 из 7/);
  const keyboard = lessonKeyboard(row).inline_keyboard.flat();
  assert.equal(keyboard[0].callback_data, "prov_services:create");
  assert.ok(keyboard.some((button) => button.callback_data === "learning:unsubscribe"));
});

test("Tashkent hour uses the configured timezone", () => {
  assert.equal(tashkentHour(new Date("2026-10-27T04:00:00.000Z")), 9);
});

