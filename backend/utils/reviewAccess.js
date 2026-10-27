function validateReviewBooking({ booking, targetType, targetId, authorRole, authorId }) {
  if (!booking) return { ok: false, code: "booking_not_found" };
  if (String(booking.status) !== "completed") return { ok: false, code: "booking_not_completed" };
  const target = Number(targetId);
  const author = Number(authorId);
  if (targetType === "service") {
    return Number(booking.client_id) === author && Number(booking.service_id) === target
      ? { ok: true } : { ok: false, code: "review_booking_forbidden" };
  }
  if (targetType === "provider") {
    const ownsBooking = authorRole === "client"
      ? Number(booking.client_id) === author
      : Number(booking.requester_provider_id) === author;
    return ownsBooking && Number(booking.provider_id) === target
      ? { ok: true } : { ok: false, code: "review_booking_forbidden" };
  }
  if (targetType === "client") {
    return authorRole === "provider" && Number(booking.provider_id) === author && Number(booking.client_id) === target
      ? { ok: true } : { ok: false, code: "review_booking_forbidden" };
  }
  return { ok: false, code: "review_target_invalid" };
}

module.exports = { validateReviewBooking };
