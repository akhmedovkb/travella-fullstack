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
    { category: "intercity_transfer", details: { destination_city: "Samarkand" } },
    { category: "intercity_transfer", details: { destination_city: "Buxoro" } },
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
    { category: "intercity_transfer", title: "Intercity transfer · Tashkent → Samarkand", details: "{}" },
    { category: "intercity_transfer", details: JSON.stringify({ destinationCity: "Bukhara" }) },
  ]);

  assert.equal(changed, true);
  assert.deepEqual(calls[1].params[0], ["Tashkent", "Samarkand", "Bukhara"]);
});

test("removes route fragments created from non-intercity service titles", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT location")) {
        return {
          rowCount: 1,
          rows: [{
            location: ["Tashkent", "Отель · Tashkent", "Аэропорт · Tashkent", "Samarkand", "Bukhara"],
            city_slugs: ["tashkent", "otel-tashkent", "aeroport-tashkent", "samarkand", "bukhara"],
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const changed = await syncProviderCitiesFromServices(db, 7, [
    { category: "airport_to_hotel_transfer", title: "Transfer · Аэропорт → Отель · Tashkent", details: {} },
    { category: "intercity_transfer", title: "Intercity transfer · Tashkent → Samarkand", details: {} },
  ]);

  assert.equal(changed, true);
  assert.deepEqual(calls[1].params, [
    ["Tashkent", "Samarkand", "Bukhara"],
    ["tashkent", "samarkand", "bukhara"],
    7,
  ]);
});
