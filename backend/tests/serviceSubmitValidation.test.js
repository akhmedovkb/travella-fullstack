const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSubmitValidationBlockers } = require("../utils/serviceSubmitValidation");

test("marketplace guide service is not validated as a refused tour", () => {
  const blockers = buildSubmitValidationBlockers({
    category: "city_tour_guide",
    title: "Tashkent city tour",
    description: "Guided city tour",
    price: 800000,
    images: ["https://example.com/tour.jpg"],
    details: { location: "Tashkent" },
  });

  assert.deepEqual(blockers, []);
});

test("marketplace service reports only its own required fields", () => {
  const blockers = buildSubmitValidationBlockers({
    category: "airport_to_hotel_transfer",
    title: "Airport transfer",
    description: "",
    price: 0,
    images: [],
    details: {},
  });

  assert.deepEqual(
    blockers.map((blocker) => blocker.code),
    ["DESCRIPTION_REQUIRED", "PRICE_REQUIRED", "PHOTO_REQUIRED"]
  );
  assert.equal(blockers.some((blocker) => blocker.code === "COUNTRY_REQUIRED"), false);
});
