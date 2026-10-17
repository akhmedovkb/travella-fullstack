const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GUIDE_SERVICE_CATEGORIES,
  TRANSPORT_SERVICE_CATEGORIES,
  PROVIDER_SERVICE_CATEGORIES,
  getAllowedProviderServiceCategories,
  isProviderServiceCategoryAllowed,
} = require("../utils/providerServiceCatalog");

test("provider service catalog contains unique categories", () => {
  assert.equal(PROVIDER_SERVICE_CATEGORIES.length, 35);
  assert.equal(new Set(PROVIDER_SERVICE_CATEGORIES).size, PROVIDER_SERVICE_CATEGORIES.length);
});

test("transport providers only receive transport services", () => {
  assert.deepEqual(getAllowedProviderServiceCategories("transport"), TRANSPORT_SERVICE_CATEGORIES);
  assert.equal(isProviderServiceCategoryAllowed("transport", "city_tour_guide"), false);
  assert.equal(isProviderServiceCategoryAllowed("transport", "city_tour_guide_with_transport"), false);
});

test("guides and agents receive guide and transport services", () => {
  assert.equal(getAllowedProviderServiceCategories("guide").length, 35);
  assert.equal(getAllowedProviderServiceCategories("agent").length, 35);
  assert.equal(isProviderServiceCategoryAllowed("guide", "city_tour_guide_with_transport"), true);
  assert.equal(isProviderServiceCategoryAllowed("guide", GUIDE_SERVICE_CATEGORIES[0]), true);
  assert.equal(isProviderServiceCategoryAllowed("guide", TRANSPORT_SERVICE_CATEGORIES[0]), true);
});

test("unknown provider types and categories are rejected", () => {
  assert.deepEqual(getAllowedProviderServiceCategories("hotel"), []);
  assert.equal(isProviderServiceCategoryAllowed("guide", "unknown_service"), false);
});
