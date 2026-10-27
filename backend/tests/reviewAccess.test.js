const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReviewBooking } = require("../utils/reviewAccess");

const booking = { status: "completed", client_id: 10, provider_id: 20, requester_provider_id: 30, service_id: 40 };

test("allows reviews only from the matching completed booking participant", () => {
  assert.equal(validateReviewBooking({ booking, targetType: "provider", targetId: 20, authorRole: "client", authorId: 10 }).ok, true);
  assert.equal(validateReviewBooking({ booking, targetType: "service", targetId: 40, authorRole: "client", authorId: 10 }).ok, true);
  assert.equal(validateReviewBooking({ booking, targetType: "client", targetId: 10, authorRole: "provider", authorId: 20 }).ok, true);
  assert.equal(validateReviewBooking({ booking, targetType: "provider", targetId: 20, authorRole: "provider", authorId: 30 }).ok, true);
});

test("rejects unfinished, mismatched and unrelated booking reviews", () => {
  assert.equal(validateReviewBooking({ booking: { ...booking, status: "confirmed" }, targetType: "provider", targetId: 20, authorRole: "client", authorId: 10 }).code, "booking_not_completed");
  assert.equal(validateReviewBooking({ booking, targetType: "provider", targetId: 21, authorRole: "client", authorId: 10 }).code, "review_booking_forbidden");
  assert.equal(validateReviewBooking({ booking, targetType: "client", targetId: 10, authorRole: "provider", authorId: 99 }).code, "review_booking_forbidden");
});

test("keeps provider-to-client reviews scoped to the service provider", () => {
  assert.equal(validateReviewBooking({ booking, targetType: "client", targetId: 10, authorRole: "provider", authorId: 20 }).ok, true);
  assert.equal(validateReviewBooking({ booking, targetType: "client", targetId: 11, authorRole: "provider", authorId: 20 }).code, "review_booking_forbidden");
  assert.equal(validateReviewBooking({ booking, targetType: "client", targetId: 10, authorRole: "client", authorId: 10 }).code, "review_booking_forbidden");
});
