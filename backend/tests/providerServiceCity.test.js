const test = require("node:test");
const assert = require("node:assert/strict");
const { addServiceCity } = require("../utils/cities");

test("adds a new service destination to profile locations and normalized slugs", () => {
  assert.deepEqual(addServiceCity(["Tashkent"], ["tashkent"], "buxoro"), {
    location: ["Tashkent", "Buxoro"],
    city_slugs: ["tashkent", "bukhara"],
    added: true,
  });
});

test("does not duplicate an existing service city written in another form", () => {
  assert.deepEqual(addServiceCity(["Bukhara"], ["bukhara"], "Бухара"), {
    location: ["Bukhara"],
    city_slugs: ["bukhara"],
    added: false,
  });
});
