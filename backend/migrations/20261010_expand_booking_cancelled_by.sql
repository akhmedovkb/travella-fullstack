BEGIN;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_cancelled_by_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_cancelled_by_check
  CHECK (
    cancelled_by IS NULL
    OR cancelled_by IN ('client', 'provider', 'requester', 'system')
  ) NOT VALID;

COMMIT;
