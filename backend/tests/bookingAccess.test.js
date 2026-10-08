const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canAccessBooking,
  canActAsBookingPayer,
  canPlaceBookingHold,
  canMarkBookingPaid,
  canProviderQuoteStatus,
  canConfirmBookingStatus,
  canCancelBookingStatus,
  canRejectBookingStatus,
  isLiveHotelReservation,
  hasPaidHotelPayment,
} = require('../controllers/bookingController');

const booking = { client_id: 10, provider_id: 20, requester_provider_id: 30 };

test('allows only booking participants to view booking data', () => {
  assert.equal(canAccessBooking({ id: 10, role: 'client' }, booking), true);
  assert.equal(canAccessBooking({ id: 20, role: 'provider' }, booking), true);
  assert.equal(canAccessBooking({ id: 30, role: 'provider' }, booking), true);
  assert.equal(canAccessBooking({ id: 11, role: 'client' }, booking), false);
  assert.equal(canAccessBooking({ id: 21, role: 'provider' }, booking), false);
});

test('allows the paid marker only for trusted administrative identities', () => {
  assert.equal(canMarkBookingPaid({ id: 10, role: 'client' }), false);
  assert.equal(canMarkBookingPaid({ id: 30, role: 'provider' }), false);
  assert.equal(canMarkBookingPaid({ id: 999, role: 'admin', is_admin: true }), true);
  assert.equal(canMarkBookingPaid({ id: 999, role: 'provider', is_moderator: true }), true);
});

test('rejects missing and ambiguous identities', () => {
  assert.equal(canAccessBooking({}, booking), false);
  assert.equal(canAccessBooking({ id: 10, role: 'provider' }, booking), false);
  assert.equal(canAccessBooking({ id: 20, role: 'client' }, booking), false);
});

test('allows financial actions only to the actual client or tour-agent requester', () => {
  assert.equal(canActAsBookingPayer({ id: 10, role: 'client' }, booking), true);
  assert.equal(canActAsBookingPayer({ id: 30, role: 'provider' }, booking), true);
  assert.equal(canActAsBookingPayer({ id: 20, role: 'provider' }, booking), false);
  assert.equal(canActAsBookingPayer({ id: 999, role: 'admin', is_admin: true }, booking), false);
  assert.equal(canActAsBookingPayer({ id: 10, role: 'provider' }, booking), false);
  assert.equal(canActAsBookingPayer({ id: 30, role: 'client' }, booking), false);
});

test('allows only the recipient provider to place a hold on an active booking', () => {
  assert.equal(canPlaceBookingHold({ id: 20, role: 'provider' }, { ...booking, status: 'pending' }), true);
  assert.equal(canPlaceBookingHold({ id: 21, role: 'provider' }, { ...booking, status: 'pending' }), false);
  assert.equal(canPlaceBookingHold({ id: 20, role: 'client' }, { ...booking, status: 'pending' }), false);
  assert.equal(canPlaceBookingHold({ id: 20, role: 'provider' }, { ...booking, status: 'cancelled' }), false);
  assert.equal(canPlaceBookingHold({ id: 20, role: 'provider' }, { ...booking, status: 'confirmed' }), false);
});

test('allows provider quotes only while negotiation is active', () => {
  assert.equal(canProviderQuoteStatus('pending'), true);
  assert.equal(canProviderQuoteStatus('quoted'), true);
  assert.equal(canProviderQuoteStatus('awaiting_payment'), false);
  assert.equal(canProviderQuoteStatus('confirmed'), false);
  assert.equal(canProviderQuoteStatus('cancelled'), false);
});

test('allows confirmation only from negotiation states', () => {
  assert.equal(canConfirmBookingStatus('pending'), true);
  assert.equal(canConfirmBookingStatus('quoted'), true);
  assert.equal(canConfirmBookingStatus('awaiting_payment'), false);
  assert.equal(canConfirmBookingStatus('cancelled'), false);
  assert.equal(canConfirmBookingStatus('confirmed'), false);
});

test('allows cancellation only while a booking is active', () => {
  for (const status of ['pending', 'quoted', 'awaiting_payment', 'confirmed']) {
    assert.equal(canCancelBookingStatus(status), true);
  }
  for (const status of ['cancelled', 'cancelled_unpaid', 'rejected', 'expired', 'completed', 'paid']) {
    assert.equal(canCancelBookingStatus(status), false);
  }
});

test('allows rejection only before a booking is accepted', () => {
  assert.equal(canRejectBookingStatus('pending'), true);
  assert.equal(canRejectBookingStatus('quoted'), true);
  assert.equal(canRejectBookingStatus('awaiting_payment'), false);
  assert.equal(canRejectBookingStatus('confirmed'), false);
  assert.equal(canRejectBookingStatus('cancelled'), false);
});

test('reports only confirmed or unexpired held hotel reservations as live', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  assert.equal(isLiveHotelReservation({ status: 'confirmed' }, now), true);
  assert.equal(isLiveHotelReservation({ status: 'held', expires_at: '2026-10-08T10:01:00Z' }, now), true);
  assert.equal(isLiveHotelReservation({ status: 'held', expires_at: '2026-10-08T10:00:00Z' }, now), false);
  assert.equal(isLiveHotelReservation({ status: 'held', expires_at: 'bad-date' }, now), false);
  assert.equal(isLiveHotelReservation({ status: 'released', expires_at: '2026-10-08T11:00:00Z' }, now), false);
});

test('detects a paid hotel booking without requiring a new schema on legacy databases', async () => {
  const queries = [];
  const paidDb = {
    query: async (sql) => {
      queries.push(sql);
      return queries.length === 1 ? { rows: [{ reg: 'topup_orders' }] } : { rowCount: 1, rows: [{}] };
    },
  };
  assert.equal(await hasPaidHotelPayment(paidDb, 44), true);
  assert.match(queries[1], /to_jsonb\(topup_orders\).*booking_id/s);

  const legacyDb = { query: async () => ({ rows: [{ reg: null }], rowCount: 0 }) };
  assert.equal(await hasPaidHotelPayment(legacyDb, 44), false);
});
