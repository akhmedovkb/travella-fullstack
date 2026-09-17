const test = require("node:test");
const assert = require("node:assert/strict");

const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { getServiceUrgency } = require("../utils/serviceUrgency");
const { buildServiceMessage } = require("../utils/telegramServiceCard");

const fixedNow = new Date("2026-09-17T10:00:00+05:00");

test("refused service actuality covers active and inactive lifecycle states", () => {
  const future = { category: "refused_tour", status: "published" };
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, future), true);
  assert.equal(isServiceActual({ isActive: false, startDate: "2026-10-03" }, future), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-09-01" }, future), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, { ...future, status: "archived" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, { ...future, status: "deleted" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, { ...future, status: "inactive" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, { ...future, status: "expired" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2026-10-03" }, { ...future, status: "cancelled" }), false);
});

test("urgency scale covers every expiration band", () => {
  assert.equal(getServiceUrgency(null, fixedNow).code, "unknown");
  assert.equal(getServiceUrgency("2026-09-20T11:00:00+05:00", fixedNow).code, "normal");
  assert.equal(getServiceUrgency("2026-09-19T10:00:00+05:00", fixedNow).code, "medium");
  assert.equal(getServiceUrgency("2026-09-18T09:00:00+05:00", fixedNow).code, "high");
  assert.equal(getServiceUrgency("2026-09-17T15:00:00+05:00", fixedNow).code, "critical");
  assert.equal(getServiceUrgency("2026-09-17T09:00:00+05:00", fixedNow).code, "expired");
});

test("Telegram card respects explicit per-person price and inferred DBL audience", () => {
  const card = buildServiceMessage(
    {
      id: 1113,
      title: "ОТКАЗНОЙ ТУР В ШАРМ",
      category: "refused_tour",
      status: "published",
      details: {
        isActive: true,
        startDate: "2030-10-03",
        endDate: "2030-10-09",
        expiration: "2030-09-24T04:59:00+05:00",
        persons: "2",
        accommodation: "DBL",
        grossPrice: "2500",
        priceFor: "за 1 человека",
        pricePerPerson: "1 250 USD",
      },
    },
    "refused_tour",
    "client",
    { unlocked: true }
  );

  assert.match(card.text, /2500 USD<\/b> <i>за 2 человека<\/i>/);
  assert.match(card.text, /за 1 человека:<\/b> 1 250 USD/);
  assert.doesNotMatch(card.text, /2500 USD<\/b> <i>за 1 человека<\/i>/);
});

test("Telegram card renders lifecycle labels without false urgency", () => {
  const base = {
    id: 1,
    title: "Тестовый отказной тур",
    category: "refused_tour",
    details: {
      isActive: true,
      startDate: "2030-10-03",
      expiration: "2030-09-24T04:59:00+05:00",
      grossPrice: "1000",
    },
  };
  const render = (patch = {}) => buildServiceMessage(
    { ...base, ...patch, details: { ...base.details, ...(patch.details || {}) } },
    "refused_tour",
    "client",
    { unlocked: true }
  ).text;

  assert.match(render({ status: "published" }), /🟢 Актуально/);
  assert.doesNotMatch(render({ status: "published" }), /⚡ срочно/i);
  assert.match(render({ status: "pending" }), /🟠 на модерации/);
  assert.match(render({ status: "draft" }), /📝 черновик/);
  assert.match(render({ status: "rejected" }), /⛔ отклонено/);
  assert.match(render({ status: "archived" }), /📦 архив/);
  assert.match(render({ status: "deleted" }), /🗑 удалено/);
  assert.match(render({ status: "cancelled" }), /⛔ отменено/);
  assert.match(render({ status: "expired" }), /🔴 истекло/);
  assert.match(render({ status: "inactive" }), /🔴 неактуально/);
  assert.match(render({ status: "published", details: { isActive: false } }), /🔴 неактуально/);
});
