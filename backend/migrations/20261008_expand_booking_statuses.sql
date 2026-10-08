BEGIN;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_chk;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_chk
  CHECK (status IN (
    'pending',
    'quoted',
    'awaiting_payment',
    'confirmed',
    'active',
    'accepted',
    'completed',
    'paid',
    'rejected',
    'cancelled',
    'cancelled_unpaid',
    'expired'
  )) NOT VALID;

COMMIT;
