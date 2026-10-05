const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAllocationChanges, buildMessage } = require('../utils/hotelAllocationNotifications');

const row = (overrides = {}) => ({
  id: 1, provider_id: 10, pool_id: 20, room_type: 'Single',
  date_from: '2026-10-05', date_to: '2026-11-04', allotment: 2,
  ...overrides,
});

test('detects created, updated and deleted hotel allocations', () => {
  const before = [row(), row({ id: 2, pool_id: 21, room_type: 'Double' })];
  const after = [row({ allotment: 3 }), row({ id: 3, pool_id: 22, room_type: 'Triple' })];
  assert.deepEqual(buildAllocationChanges(before, after).map((item) => item.type), ['updated', 'created', 'deleted']);
});

test('builds supplier allocation message with escaped hotel data', () => {
  const text = buildMessage('Art & Air', { type: 'created', row: row() });
  assert.match(text, /Вам выделена квота/);
  assert.match(text, /Art &amp; Air/);
  assert.match(text, /Single/);
  assert.match(text, /2026-10-05/);
  assert.match(text, /Выделено:<\/b> 2/);
});
