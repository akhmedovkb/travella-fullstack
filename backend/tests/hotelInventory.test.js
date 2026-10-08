const test = require('node:test');
const assert = require('node:assert/strict');
const { reservationLines, quotedHotelPrice, physicalAvailability, supplierAllocationAvailability } = require('../utils/hotelInventory');

test('deduplicates repeated quote snapshots by rate and stay date', () => {
  const quote = {
    offer: { provider_id: 77 },
    lines: [
      { rate_id: 10, date: '2026-10-10', quantity: 1 },
      { rate_id: 10, date: '2026-10-11', quantity: 1 },
    ],
  };
  const lines = reservationLines({ hotel_quotes: [quote, quote] }, 77);
  assert.deepEqual(lines, [
    { rateId: 10, date: '2026-10-10', quantity: 1 },
    { rateId: 10, date: '2026-10-11', quantity: 1 },
  ]);
});

test('keeps the largest quantity and ignores another provider quote', () => {
  const lines = reservationLines({ hotel_quotes: [
    { offer: { provider_id: 77 }, lines: [{ rate_id: 10, date: '2026-10-10', quantity: 1 }] },
    { offer: { provider_id: 77 }, lines: [{ rate_id: 10, date: '2026-10-10', quantity: 2 }] },
    { offer: { provider_id: 88 }, lines: [{ rate_id: 20, date: '2026-10-10', quantity: 5 }] },
  ] }, 77);
  assert.deepEqual(lines, [{ rateId: 10, date: '2026-10-10', quantity: 2 }]);
});

test('calculates shared room inventory with overrides and stop-sale', () => {
  assert.equal(physicalAvailability(6, null, 2), 4);
  assert.equal(physicalAvailability(6, 3, 2), 1);
  assert.equal(physicalAvailability(6, null, 8), 0);
  assert.equal(physicalAvailability(6, null, 0, true), 0);
});

test('calculates one shared supplier allocation across its rates', () => {
  assert.equal(supplierAllocationAvailability(6, 2), 4);
  assert.equal(supplierAllocationAvailability(6, 9), 0);
});

test('uses the resident price for a resident Tour Builder booking', () => {
  const details = { resident_type: 'res', hotel_quotes: [
    { valid: true, date: '2026-11-07', quote_version: 'resident-v1', currency: 'UZS', offer: { provider_id: 77 },
      lines: [{ residency: 'resident' }], totals: { total: 1000000 } },
    { valid: true, date: '2026-11-07', quote_version: 'other-provider', currency: 'UZS', offer: { provider_id: 88 },
      lines: [{ residency: 'resident' }], totals: { total: 999 } },
  ] };
  assert.deepEqual(quotedHotelPrice(details, 77), { amount: 1000000, currency: 'UZS' });
});

test('uses the non-resident price and rejects a residency mismatch', () => {
  const matching = { resident_type: 'nrs', hotel_quotes: [
    { valid: true, date: '2026-11-07', quote_version: 'non-resident-v1', currency: 'UZS', offer: { provider_id: 77 },
      lines: [{ residency: 'non_resident' }], totals: { total: 1200000 } },
  ] };
  const mismatched = { ...matching, hotel_quotes: [{ ...matching.hotel_quotes[0], lines: [{ residency: 'resident' }] }] };
  assert.deepEqual(quotedHotelPrice(matching, 77), { amount: 1200000, currency: 'UZS' });
  assert.equal(quotedHotelPrice(mismatched, 77), null);
});
