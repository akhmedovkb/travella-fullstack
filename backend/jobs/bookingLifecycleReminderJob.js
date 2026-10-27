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

  const completed = await db.query(`
    UPDATE bookings
       SET status='completed',updated_at=NOW()
     WHERE status IN ('confirmed','paid')
       AND COALESCE((SELECT MAX(bd.date) FROM booking_dates bd WHERE bd.booking_id=bookings.id),date) < CURRENT_DATE
     RETURNING id AS booking_id
  `);

  const clientReviews = await db.query(`
    WITH due AS (
      SELECT b.id AS booking_id
        FROM bookings b
       WHERE b.status='completed'
         AND b.client_id IS NOT NULL
         AND b.requester_provider_id IS NULL
         AND COALESCE(b.updated_at,b.created_at) <= NOW() - INTERVAL '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM reviews r
            WHERE r.booking_id=b.id
              AND r.target_type='provider'
              AND r.author_role='client'
              AND r.author_id=b.client_id
         )
       ORDER BY COALESCE(b.updated_at,b.created_at)
       LIMIT 200
    )
    INSERT INTO booking_telegram_reminders(booking_id,reminder_kind)
    SELECT booking_id,'client_review_24h' FROM due
    ON CONFLICT DO NOTHING
    RETURNING booking_id
  `);

  const providerReviews = await db.query(`
    WITH due AS (
      SELECT b.id AS booking_id
        FROM bookings b
       WHERE b.status='completed'
         AND b.client_id IS NOT NULL
         AND b.requester_provider_id IS NULL
         AND COALESCE(b.updated_at,b.created_at) <= NOW() - INTERVAL '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM reviews r
            WHERE r.booking_id=b.id
              AND r.target_type='client'
              AND r.author_role='provider'
              AND r.author_id=b.provider_id
         )
       ORDER BY COALESCE(b.updated_at,b.created_at)
       LIMIT 200
    )
    INSERT INTO booking_telegram_reminders(booking_id,reminder_kind)
    SELECT booking_id,'provider_review_24h' FROM due
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
    ...(completed.rows || []).map((row) => Promise.resolve(
      notifier.notifyBookingCompleted?.({ booking: { id: row.booking_id } })
    )),
    ...(clientReviews.rows || []).map((row) => Promise.resolve(
      notifier.notifyBookingReviewReminder?.({ booking: { id: row.booking_id }, audience: "client" })
    )),
    ...(providerReviews.rows || []).map((row) => Promise.resolve(
      notifier.notifyBookingReviewReminder?.({ booking: { id: row.booking_id }, audience: "provider" })
    )),
  ];
  const settled = await Promise.allSettled(notifications);
  const failed = settled.filter((item) => item.status === "rejected").length;
  return {
    ok: true,
    payment_reminders: payment.rowCount || 0,
    service_reminders: service.rowCount || 0,
    completed_bookings: completed.rowCount || 0,
    client_review_reminders: clientReviews.rowCount || 0,
    provider_review_reminders: providerReviews.rowCount || 0,
    notification_failures: failed,
  };
}

module.exports = { runBookingLifecycleReminderJob, ensureReminderTable };
