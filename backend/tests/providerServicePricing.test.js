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
