const pool = require("../db");
const telegram = require("../utils/telegram");

async function ensureReminderTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_telegram_reminders (
      booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      reminder_kind TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (booking_id, reminder_kind)
    )
  `);
}

async function runBookingLifecycleReminderJob({ db = pool, notifier = telegram } = {}) {
  await ensureReminderTable(db);

  const payment = await db.query(`
    WITH due AS (
      SELECT b.id AS booking_id,
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (b.hold_until-NOW())) / 60))::int AS minutes_left
        FROM bookings b
       WHERE b.status='awaiting_payment'
         AND b.hold_until IS NOT NULL
         AND b.hold_until > NOW()
         AND b.hold_until <= NOW() + INTERVAL '10 minutes'
       ORDER BY b.hold_until
       LIMIT 200
    )
    INSERT INTO booking_telegram_reminders(booking_id,reminder_kind)
    SELECT booking_id,'payment_10m' FROM due
    ON CONFLICT DO NOTHING
    RETURNING booking_id,
      (SELECT minutes_left FROM due WHERE due.booking_id=booking_telegram_reminders.booking_id) AS minutes_left
  `);

  const service = await db.query(`
    WITH due AS (
      SELECT b.id AS booking_id
        FROM bookings b
       WHERE b.status IN ('confirmed','paid')
         AND b.date > CURRENT_DATE
         AND b.date <= CURRENT_DATE + 1
       ORDER BY b.date,b.id
       LIMIT 200
    )
    INSERT INTO booking_telegram_reminders(booking_id,reminder_kind)
    SELECT booking_id,'service_24h' FROM due
    ON CONFLICT DO NOTHING
    RETURNING booking_id
  `);

  const notifications = [
    ...(payment.rows || []).map((row) => Promise.resolve(
      notifier.notifyBookingPaymentReminder?.({ booking: { id: row.booking_id }, minutesLeft: row.minutes_left })
    )),
    ...(service.rows || []).map((row) => Promise.resolve(
      notifier.notifyBookingServiceReminder?.({ booking: { id: row.booking_id } })
    )),
  ];
  const settled = await Promise.allSettled(notifications);
  const failed = settled.filter((item) => item.status === "rejected").length;
  return {
    ok: true,
    payment_reminders: payment.rowCount || 0,
    service_reminders: service.rowCount || 0,
    notification_failures: failed,
  };
}

module.exports = { runBookingLifecycleReminderJob, ensureReminderTable };
