const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeOffer } = require("../services/flightSearchClient");

test("normalizes a Google Flights result for Tour Builder", () => {
  const offer = normalizeOffer({
    price: 320,
    total_duration: 225,
    booking_token: "booking-token",
    flights: [{
      departure_airport: { id: "TAS", time: "2026-11-01 08:00" },
      arrival_airport: { id: "DXB", time: "2026-11-01 10:45" },
      airline: "Uzbekistan Airways",
      flight_number: "HY 333",
      duration: 225,
      airplane: "Airbus A320",
      travel_class: "Economy",
      extensions: ["23 kg checked baggage"],
    }],
  }, "USD", new Date("2026-10-12T12:00:00Z"));

  assert.equal(offer.provider, "serpapi_google_flights");
  assert.equal(offer.price, 320);
  assert.equal(offer.segments[0].carrier_code, "HY");
  assert.equal(offer.segments[0].number, "333");
  assert.equal(offer.baggage, "23 kg checked baggage");
  assert.equal(offer.offer_expires_at, "2026-10-12T12:15:00.000Z");
});
