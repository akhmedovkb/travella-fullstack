const test = require('node:test');
const assert = require('node:assert/strict');
const { reservationLines, physicalAvailability } = require('../utils/hotelInventory');

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
