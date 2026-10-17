const GUIDE_SERVICE_CATEGORIES = [
  "city_tour_guide",
  "city_tour_guide_with_transport",
  "thematic_tour_guide",
  "attraction_tour_guide",
  "countryside_tour_guide",
  "mountain_tour_guide",
  "desert_tour_guide",
  "safari_tour_guide",
  "group_escort",
  "meet",
  "seeoff",
  "translation",
  "event_coordinator",
  "shopping_assistance",
];

const TRANSPORT_SERVICE_CATEGORIES = [
  "airport_to_hotel_transfer",
  "hotel_to_airport_transfer",
  "station_to_hotel_transfer",
  "hotel_to_station_transfer",
  "hotel_transfer",
  "city_tour_transport",
  "countryside_tour_transport",
  "mountain_tour_transport",
  "desert_tour_transport",
  "safari_tour_transport",
  "intercity_transfer",
  "border_transfer",
  "one_way_transfer",
  "hourly_driver",
  "half_day_driver",
  "full_day_driver",
  "vip_transfer",
  "group_bus",
  "dinner_transfer",
  "meet_with_sign",
  "extra_waiting",
];

const PROVIDER_SERVICE_CATEGORIES = [
  ...GUIDE_SERVICE_CATEGORIES,
  ...TRANSPORT_SERVICE_CATEGORIES,
];

const GUIDE_SERVICE_CATEGORY_SET = new Set(GUIDE_SERVICE_CATEGORIES);
const TRANSPORT_SERVICE_CATEGORY_SET = new Set(TRANSPORT_SERVICE_CATEGORIES);
const PROVIDER_SERVICE_CATEGORY_SET = new Set(PROVIDER_SERVICE_CATEGORIES);

function getAllowedProviderServiceCategories(providerType) {
  const type = String(providerType || "").trim().toLowerCase();
  if (type === "transport") return TRANSPORT_SERVICE_CATEGORIES;
  if (type === "guide" || type === "agent" || type === "tour_agent") {
    return PROVIDER_SERVICE_CATEGORIES;
  }
  return [];
}

function isProviderServiceCategoryAllowed(providerType, category) {
  return getAllowedProviderServiceCategories(providerType).includes(String(category || ""));
}

module.exports = {
  GUIDE_SERVICE_CATEGORIES,
  TRANSPORT_SERVICE_CATEGORIES,
  PROVIDER_SERVICE_CATEGORIES,
  GUIDE_SERVICE_CATEGORY_SET,
  TRANSPORT_SERVICE_CATEGORY_SET,
  PROVIDER_SERVICE_CATEGORY_SET,
  getAllowedProviderServiceCategories,
  isProviderServiceCategoryAllowed,
};
