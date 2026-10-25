const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteProviderService, validateRateVariants } = require("../utils/providerServicePricing");

test("selects a provider rate by travel date and group size", () => {
  const service = { price: 100, details: { pricing_mode: "fixed", rate_variants: [
    { id: "summer-small", valid_from: "2026-06-01", valid_to: "2026-08-31", min_guests: 1, max_guests: 4, price: 150 },
    { id: "summer-group", valid_from: "2026-06-01", valid_to: "2026-08-31", min_guests: 5, max_guests: 20, price: 220 },
  ] } };
  const quote = quoteProviderService({ service, dates: ["2026-07-10"], pax: 6 });
  assert.equal(quote.amount, 220);
  assert.equal(quote.breakdown[0].variant_id, "summer-group");
});

test("falls back to the base price outside configured conditions", () => {
  const service = { price: 100, details: { pricing_mode: "fixed", rate_variants: [
    { valid_from: "2026-06-01", valid_to: "2026-08-31", min_guests: 1, price: 150 },
  ] } };
  assert.equal(quoteProviderService({ service, dates: ["2026-10-10"], pax: 2 }).amount, 100);
});

test("applies hourly duration after selecting the matching unit price", () => {
  const service = { price: 100, details: { pricing_mode: "hourly", minimum_hours: 2, rate_variants: [
    { min_guests: 5, price: 120 },
  ] } };
  const quote = quoteProviderService({ service, dates: ["2026-07-10"], pax: 6, timeSlots: [
    { date: "2026-07-10", start_time: "10:00", end_time: "13:00" },
  ] });
  assert.equal(quote.amount, 360);
});

test("rejects overlapping date and group conditions", () => {
  assert.equal(validateRateVariants({ rate_variants: [
    { valid_from: "2026-06-01", valid_to: "2026-08-31", min_guests: 1, max_guests: 8, price: 150 },
    { valid_from: "2026-08-01", valid_to: "2026-09-30", min_guests: 5, max_guests: 20, price: 220 },
  ] }), "rate_variants_overlap");
});

test("allows conditions separated by group size", () => {
  assert.equal(validateRateVariants({ rate_variants: [
    { min_guests: 1, max_guests: 4, price: 150 },
    { min_guests: 5, max_guests: 20, price: 220 },
  ] }), null);
});

test("selects different prices for residents and non-residents", () => {
  const service = { price: 100, details: { pricing_mode: "fixed", rate_variants: [
    { id: "resident", resident_type: "res", min_guests: 1, price: 80 },
    { id: "non-resident", resident_type: "nrs", min_guests: 1, price: 140 },
  ] } };
  assert.equal(quoteProviderService({ service, dates: ["2026-07-10"], pax: 2, residentType: "res" }).amount, 80);
  assert.equal(quoteProviderService({ service, dates: ["2026-07-10"], pax: 2, residentType: "nrs" }).amount, 140);
  assert.equal(validateRateVariants(service.details), null);
});

test("applies package prices from a matching condition", () => {
  const service = { price: 400, details: {
    pricing_mode: "packages", half_day_hours: 4, full_day_hours: 8,
    half_day_price: 400, full_day_price: 700, extra_hour_price: 100,
    rate_variants: [{ id: "summer", valid_from: "2026-06-01", valid_to: "2026-08-31", min_guests: 1, half_day_price: 500, full_day_price: 900, extra_hour_price: 150 }],
  } };
  const quote = quoteProviderService({ service, dates: ["2026-07-10"], pax: 2, timeSlots: [
    { date: "2026-07-10", start_time: "09:00", end_time: "19:00" },
  ] });
  assert.equal(quote.amount, 1200);
  assert.equal(quote.breakdown[0].variant_id, "summer");
});

test("adds night and holiday surcharges to the selected rate", () => {
  const service = { price: 1000, details: { pricing_mode: "fixed", surcharges: {
    night_percent: 20, night_from: "22:00", night_to: "06:00", holiday_percent: 10, holiday_dates: ["2026-12-31"],
  } } };
  const quote = quoteProviderService({ service, dates: ["2026-12-31"], pax: 2, timeSlots: [
    { date: "2026-12-31", start_time: "23:00", end_time: "23:30" },
  ] });
  assert.equal(quote.amount, 1300);
  assert.deepEqual(quote.breakdown[0].surcharge_reasons, ["night", "holiday"]);
});
