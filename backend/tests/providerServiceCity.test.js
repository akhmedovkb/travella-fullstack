const test = require("node:test");
const assert = require("node:assert/strict");
const { addServiceCity } = require("../utils/cities");
const { syncProviderCitiesFromServices } = require("../controllers/providerServicesController");

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

test("repairs profile cities from existing intercity service destinations", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT location")) {
        return { rowCount: 1, rows: [{ location: ["Tashkent"], city_slugs: ["tashkent"] }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const changed = await syncProviderCitiesFromServices(db, 7, [
    { details: { destination_city: "Samarkand" } },
    { details: { destination_city: "Buxoro" } },
  ]);

  assert.equal(changed, true);
  assert.deepEqual(calls[1].params, [
    ["Tashkent", "Samarkand", "Buxoro"],
    ["tashkent", "samarkand", "bukhara"],
    7,
  ]);
});

test("repairs destinations stored in legacy service titles and JSON strings", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT location")) {
        return { rowCount: 1, rows: [{ location: ["Tashkent"], city_slugs: ["tashkent"] }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const changed = await syncProviderCitiesFromServices(db, 7, [
    { title: "Intercity transfer · Tashkent → Samarkand", details: "{}" },
    { details: JSON.stringify({ destinationCity: "Bukhara" }) },
  ]);

  assert.equal(changed, true);
  assert.deepEqual(calls[1].params[0], ["Tashkent", "Samarkand", "Bukhara"]);
});
