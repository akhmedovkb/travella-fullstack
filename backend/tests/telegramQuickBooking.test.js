const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBookingDate,
  parseGuestCount,
  parseBookingAmount,
  telegramBookingStatusLabel,
  isActiveBookingStatus,
} = require("../utils/telegramQuickBooking");

test("parses ISO and local booking dates", () => {
  assert.equal(parseBookingDate("2026-11-09"), "2026-11-09");
  assert.equal(parseBookingDate("09.11.2026"), "2026-11-09");
  assert.equal(parseBookingDate("31.02.2026"), null);
});

test("validates guests and amount", () => {
  assert.equal(parseGuestCount("2"), 2);
  assert.equal(parseGuestCount("0"), null);
  assert.equal(parseBookingAmount("1 200 000"), 1200000);
  assert.equal(parseBookingAmount("nope"), null);
});

test("uses actor-specific human booking status labels", () => {
  assert.equal(telegramBookingStatusLabel("quoted"), "Ожидает подтверждения клиента");
  assert.equal(telegramBookingStatusLabel("awaiting_payment"), "Ожидает оплаты клиентом");
  assert.equal(isActiveBookingStatus("confirmed"), true);
  assert.equal(isActiveBookingStatus("cancelled"), false);
});
