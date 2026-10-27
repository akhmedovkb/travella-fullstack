const test = require("node:test");
const assert = require("node:assert/strict");
const { runBookingLifecycleReminderJob } = require("../jobs/bookingLifecycleReminderJob");

test("claims and sends each booking lifecycle reminder through the idempotent ledger", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (queries.length === 2) return { rowCount: 1, rows: [{ booking_id: 11, minutes_left: 8 }] };
      if (queries.length === 3) return { rowCount: 1, rows: [{ booking_id: 12 }] };
      if (queries.length === 4) return { rowCount: 1, rows: [{ booking_id: 13 }] };
      return { rowCount: 0, rows: [] };
    },
  };
  const sent = [];
  const notifier = {
    async notifyBookingPaymentReminder({ booking, minutesLeft }) { sent.push(["payment", booking.id, minutesLeft]); },
    async notifyBookingServiceReminder({ booking }) { sent.push(["service", booking.id]); },
    async notifyBookingCompleted({ booking }) { sent.push(["completed", booking.id]); },
  };

  const result = await runBookingLifecycleReminderJob({ db, notifier });

  assert.deepEqual(sent, [["payment", 11, 8], ["service", 12], ["completed", 13]]);
  assert.equal(result.payment_reminders, 1);
  assert.equal(result.service_reminders, 1);
  assert.equal(result.completed_bookings, 1);
  assert.match(queries[0], /PRIMARY KEY \(booking_id, reminder_kind\)/);
  assert.match(queries[1], /ON CONFLICT DO NOTHING/);
  assert.match(queries[2], /service_24h/);
  assert.match(queries[3], /status='completed'/);
});
