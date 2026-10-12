BEGIN;

ALTER TABLE hotel_offer_rates
  ADD COLUMN IF NOT EXISTS occupancy_code TEXT NOT NULL DEFAULT 'ROOM';

ALTER TABLE hotel_offer_rates
  ADD COLUMN IF NOT EXISTS guest_count INTEGER NOT NULL DEFAULT 1;

UPDATE hotel_offer_rates
SET occupancy_code = 'ROOM'
WHERE occupancy_code IS NULL OR BTRIM(occupancy_code) = '';

UPDATE hotel_offer_rates
SET guest_count = 1
WHERE guest_count IS NULL OR guest_count < 1;

COMMIT;
