const test = require('node:test');
const assert = require('node:assert/strict');

const { runExpireHotelBookingHoldsJob } = require('../jobs/expireHotelBookingHoldsJob');

test('expires overdue payment holds and notifies once per returned booking', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (queries.length === 1) return { rows: [{ column_name: 'hold_until' }, { column_name: 'cancelled_by' }] };
      return { rows: [{ id: 41 }, { id: 42 }] };
    },
  };
  const notified = [];
  const notifier = { async notifyBookingAutoCancelled(booking) { notified.push(booking.id); } };

  const result = await runExpireHotelBookingHoldsJob({ db, notifier });

  assert.equal(result.expired, 2);
  assert.deepEqual(notified, [41, 42]);
  assert.match(queries[1], /FOR UPDATE SKIP LOCKED/);
  assert.match(queries[1], /status='cancelled_unpaid'/);
  assert.match(queries[1], /cancelled_by='system'/);
});

test('supports schemas without hold_until and cancelled_by', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };

  const result = await runExpireHotelBookingHoldsJob({ db, notifier: {} });

  assert.equal(result.expired, 0);
  assert.match(queries[1], /created_at \+ INTERVAL '30 minutes'/);
  assert.doesNotMatch(queries[1], /cancelled_by='system'/);
});
