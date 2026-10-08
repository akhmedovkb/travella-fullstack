const pool = require('../db');
const telegram = require('../utils/telegram');

async function runExpireHotelBookingHoldsJob({ db = pool, notifier = telegram } = {}) {
  const columns = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bookings'
        AND column_name=ANY($1::text[])`,
    [['hold_until', 'cancelled_by']]
  );
  const available = new Set(columns.rows.map((row) => row.column_name));
  const dueExpression = available.has('hold_until')
    ? `COALESCE(hold_until,created_at + INTERVAL '30 minutes')`
    : `created_at + INTERVAL '30 minutes'`;
  const cancelledBy = available.has('cancelled_by') ? `,cancelled_by='system'` : '';

  const { rows } = await db.query(
    `WITH due AS (
       SELECT id
         FROM bookings
        WHERE status='awaiting_payment'
          AND ${dueExpression} <= NOW()
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 200
     )
     UPDATE bookings booking
        SET status='cancelled_unpaid',updated_at=NOW()${cancelledBy}
       FROM due
      WHERE booking.id=due.id
        AND booking.status='awaiting_payment'
      RETURNING booking.*`
  );

  const notificationResults = await Promise.allSettled(
    rows.map((booking) => Promise.resolve(notifier.notifyBookingAutoCancelled?.(booking)))
  );
  const notificationFailures = notificationResults.filter((result) => result.status === 'rejected').length;
  if (notificationFailures) {
    console.warn('[job] expireHotelBookingHolds notification failures:', notificationFailures);
  }
  return { ok: true, expired: rows.length, notification_failures: notificationFailures };
}

module.exports = { runExpireHotelBookingHoldsJob };
