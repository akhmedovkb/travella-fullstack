const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBookingDate,
  parseGuestCount,
  parseBookingAmount,
  telegramBookingStatusLabel,
  isActiveBookingStatus,
  bookingFilterStatuses,
  bookingReviewAction,
} = require("../utils/telegramQuickBooking");

test("parses ISO and local booking dates", () => {
  assert.equal(parseBookingDate("2026-11-09"), "2026-11-09");
  assert.equal(parseBookingDate("09.11.2026"), "2026-11-09");
  assert.equal(parseBookingDate("31.02.2026"), null);
});

test("offers reviews only for unreviewed direct completed bookings", () => {
  const booking = { status: "completed", client_id: 10, provider_id: 20, requester_provider_id: null, has_review: false };
  assert.equal(bookingReviewAction("client", booking), "rate");
  assert.equal(bookingReviewAction("provider", booking), "rate_client");
  assert.equal(bookingReviewAction("client", { ...booking, has_review: true }), null);
  assert.equal(bookingReviewAction("provider", { ...booking, status: "paid" }), null);
  assert.equal(bookingReviewAction("provider", { ...booking, requester_provider_id: 30 }), null);
});

test("groups booking statuses into stable Telegram filters", () => {
  assert.deepEqual(bookingFilterStatuses("completed"), ["completed"]);
  assert.equal(bookingFilterStatuses("cancelled").includes("cancelled_unpaid"), true);
  assert.equal(bookingFilterStatuses("unknown").includes("awaiting_payment"), true);
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
