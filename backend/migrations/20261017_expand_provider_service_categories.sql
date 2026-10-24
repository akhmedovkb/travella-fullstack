BEGIN;

ALTER TABLE provider_services
  DROP CONSTRAINT IF EXISTS chk_provider_services_category;

ALTER TABLE provider_services
  ADD CONSTRAINT chk_provider_services_category
  CHECK (
    category = ANY (
      ARRAY[
        'city_tour_guide',
        'thematic_tour_guide',
        'attraction_tour_guide',
        'countryside_tour_guide',
        'mountain_tour_guide',
        'desert_tour_guide',
        'safari_tour_guide',
        'group_escort',
        'meet',
        'seeoff',
        'translation',
        'event_coordinator',
        'shopping_assistance',
        'airport_to_hotel_transfer',
        'hotel_to_airport_transfer',
        'station_to_hotel_transfer',
        'hotel_to_station_transfer',
        'hotel_transfer',
        'city_tour_transport',
        'countryside_tour_transport',
        'mountain_tour_transport',
        'desert_tour_transport',
        'safari_tour_transport',
        'intercity_transfer',
        'border_transfer',
        'one_way_transfer',
        'hourly_driver',
        'half_day_driver',
        'full_day_driver',
        'vip_transfer',
        'group_bus',
        'dinner_transfer',
        'meet_with_sign',
        'extra_waiting'
      ]::text[]
    )
  );

COMMIT;
