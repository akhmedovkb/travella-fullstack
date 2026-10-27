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
      if (queries.length === 5) return { rowCount: 1, rows: [{ booking_id: 14 }] };
      if (queries.length === 6) return { rowCount: 1, rows: [{ booking_id: 15 }] };
      return { rowCount: 0, rows: [] };
    },
  };
  const sent = [];
  const notifier = {
    async notifyBookingPaymentReminder({ booking, minutesLeft }) { sent.push(["payment", booking.id, minutesLeft]); },
    async notifyBookingServiceReminder({ booking }) { sent.push(["service", booking.id]); },
    async notifyBookingCompleted({ booking }) { sent.push(["completed", booking.id]); },
    async notifyBookingReviewReminder({ booking, audience }) { sent.push(["review", audience, booking.id]); },
  };

  const result = await runBookingLifecycleReminderJob({ db, notifier });

  assert.deepEqual(sent, [
    ["payment", 11, 8], ["service", 12], ["completed", 13],
    ["review", "client", 14], ["review", "provider", 15],
  ]);
  assert.equal(result.payment_reminders, 1);
  assert.equal(result.service_reminders, 1);
  assert.equal(result.completed_bookings, 1);
  assert.equal(result.client_review_reminders, 1);
  assert.equal(result.provider_review_reminders, 1);
  assert.match(queries[0], /PRIMARY KEY \(booking_id, reminder_kind\)/);
  assert.match(queries[1], /ON CONFLICT DO NOTHING/);
  assert.match(queries[2], /service_24h/);
  assert.match(queries[3], /status='completed'/);
  assert.match(queries[4], /client_review_24h/);
  assert.match(queries[4], /target_type='provider'/);
  assert.match(queries[5], /provider_review_24h/);
  assert.match(queries[5], /target_type='client'/);
});
