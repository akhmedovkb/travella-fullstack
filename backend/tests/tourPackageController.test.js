const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateGross, derivePackageStatus, hashShareToken, packageSaleReadiness, publicPackageView } = require("../controllers/tourPackageController");

test("calculates percent and fixed agency markup", () => {
  assert.equal(calculateGross(1000, "percent", 15), 1150);
  assert.equal(calculateGross(1000, "fixed", 250), 1250);
  assert.equal(calculateGross(-10, "percent", 15), 0);
});

test("hashes proposal tokens deterministically without storing the raw token", () => {
  const hash = hashShareToken("a-private-proposal-token");
  assert.equal(hash.length, 64);
  assert.equal(hash, hashShareToken("a-private-proposal-token"));
  assert.notEqual(hash, "a-private-proposal-token");
});

test("public proposal omits agency costs, markup and client contacts", () => {
  const view = publicPackageView({
    title: "Silk Road",
    currency: "USD",
    gross_total: "1250.00",
    net_total: "1000.00",
    markup_value: "25.00",
    client_name: "Alex",
    client_phone: "+998900000000",
    client_email: "alex@example.com",
    proposal_response: "changes_requested",
    proposal_response_message: "Please change the hotel",
    route: { from: "Tashkent", to: "Samarkand" },
    itinerary: [{ day: 1, city: "Tashkent" }],
    agency_name: "Example DMC",
    agency_phone: "+998711111111",
  });
  assert.equal(view.gross_total, "1250.00");
  assert.equal(view.client_name, "Alex");
  assert.equal(view.agency.name, "Example DMC");
  assert.equal(view.proposal_response, "changes_requested");
  assert.equal("net_total" in view, false);
  assert.equal("markup_value" in view, false);
  assert.equal("client_phone" in view, false);
  assert.equal("client_email" in view, false);
});

test("derives package sourcing status from supplier components", () => {
  assert.equal(derivePackageStatus([], "draft"), "draft");
  assert.equal(derivePackageStatus([{ status: "pending" }], "draft"), "request_sent");
  assert.equal(derivePackageStatus([{ status: "quoted" }, { status: "pending" }], "request_sent"), "partially_confirmed");
  assert.equal(derivePackageStatus([{ status: "confirmed" }, { status: "paid" }], "request_sent"), "confirmed");
  assert.equal(derivePackageStatus([{ status: "pending" }], "proposed"), "proposed");
});

test("requires client acceptance and every supplier confirmation before booking the package", () => {
  assert.deepEqual(packageSaleReadiness([], "accepted"), {
    ready: false, client_accepted: true, component_count: 0, confirmed_count: 0, blocker_ids: [],
  });
  assert.equal(packageSaleReadiness([{ id: 1, status: "confirmed" }], null).ready, false);
  assert.deepEqual(packageSaleReadiness([
    { id: 1, status: "confirmed" },
    { id: 2, status: "quoted" },
  ], "accepted"), {
    ready: false, client_accepted: true, component_count: 2, confirmed_count: 1, blocker_ids: [2],
  });
  assert.equal(packageSaleReadiness([
    { id: 1, status: "confirmed" },
    { id: 2, status: "paid" },
  ], "accepted").ready, true);
});

