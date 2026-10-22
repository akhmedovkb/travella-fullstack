const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateGross, derivePackageStatus } = require("../controllers/tourPackageController");

test("calculates percent and fixed agency markup", () => {
  assert.equal(calculateGross(1000, "percent", 15), 1150);
  assert.equal(calculateGross(1000, "fixed", 250), 1250);
  assert.equal(calculateGross(-10, "percent", 15), 0);
});

test("derives package sourcing status from supplier components", () => {
  assert.equal(derivePackageStatus([], "draft"), "draft");
  assert.equal(derivePackageStatus([{ status: "pending" }], "draft"), "request_sent");
  assert.equal(derivePackageStatus([{ status: "quoted" }, { status: "pending" }], "request_sent"), "partially_confirmed");
  assert.equal(derivePackageStatus([{ status: "confirmed" }, { status: "paid" }], "request_sent"), "confirmed");
  assert.equal(derivePackageStatus([{ status: "pending" }], "proposed"), "proposed");
});

