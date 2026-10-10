CREATE TABLE IF NOT EXISTS booking_time_slots (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_time_slots_valid_range CHECK (end_time > start_time),
  CONSTRAINT booking_time_slots_unique UNIQUE (booking_id, slot_date, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS booking_time_slots_date_range_idx
  ON booking_time_slots (slot_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS booking_time_slots_booking_idx
  ON booking_time_slots (booking_id);
