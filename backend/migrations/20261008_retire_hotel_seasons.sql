BEGIN;

CREATE TABLE IF NOT EXISTS hotel_seasons_archive_20261008
AS TABLE hotel_seasons WITH DATA;

DO $$
DECLARE
  source_count BIGINT;
  archive_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO source_count FROM hotel_seasons;
  SELECT COUNT(*) INTO archive_count FROM hotel_seasons_archive_20261008;
  IF source_count <> archive_count THEN
    RAISE EXCEPTION 'hotel_seasons archive mismatch: source %, archive %', source_count, archive_count;
  END IF;
END $$;

COMMENT ON TABLE hotel_seasons_archive_20261008 IS
  'Read-only archive of the retired hotel_seasons model. Retired 2026-10-08; pricing is stored in hotel_offer_rates.';

DROP TABLE hotel_seasons;

COMMIT;
