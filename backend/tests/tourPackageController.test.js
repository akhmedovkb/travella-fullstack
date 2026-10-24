const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSupplierServiceOrderMessage, buildSupplierServiceOrderReminderMessage, buildSupplierServiceOrderCancellationMessage, buildSupplierServiceOrderNoteMessage, buildSupplierDocumentRequestMessage, calculateGross, canEditTourPackage, createBookingReference, derivePackageStatus, escapeTelegramHtml, hashShareToken, isValidProposalResponse, normalizeClientFollowup, normalizeComponentOperations, normalizePackagePayment, normalizePackageRefund, normalizeProposalResponseReason, normalizeSupplierRefund, normalizeTourCancellationDetails, normalizeTourCancellationReason, normalizeTourTask, normalizeTraveler, packageOperationsReadiness, packageOperationsTimeline, packageSaleReadiness, packageSnapshot, publicPackageView } = require("../controllers/tourPackageController");

test("calculates percent and fixed agency markup", () => {
  assert.equal(calculateGross(1000, "percent", 15), 1150);
  assert.equal(calculateGross(1000, "fixed", 250), 1250);
  assert.equal(calculateGross(-10, "percent", 15), 0);
});

test("only editable tour package states can be revised", () => {
  assert.equal(canEditTourPackage("proposed"), true);
  assert.equal(canEditTourPackage("confirmed"), true);
  assert.equal(canEditTourPackage("booked"), false);
  assert.equal(canEditTourPackage("paid"), false);
  assert.equal(canEditTourPackage("cancelled"), false);
  assert.equal(canEditTourPackage("lost"), true);
});

test("derives package payment status from the received amount", () => {
  assert.deepEqual(normalizePackagePayment({ paid_amount: 0 }, 1000).paymentStatus, "unpaid");
  assert.deepEqual(normalizePackagePayment({ paid_amount: 250 }, 1000).paymentStatus, "partial");
  assert.deepEqual(normalizePackagePayment({ paid_amount: 1500 }, 1000), {
    paymentStatus: "paid", paidAmount: 1000, paymentDueAt: null, paymentNote: null,
  });
});

test("derives a cancelled tour refund status without exceeding received funds", () => {
  assert.deepEqual(normalizePackageRefund({ refund_due_amount: 800, refunded_amount: 200, refund_due_at: "2026-11-01", refund_note: " Bank transfer " }, 1000), {
    refundStatus: "partial", refundDueAmount: 800, refundedAmount: 200, refundDueAt: "2026-11-01", refundNote: "Bank transfer",
  });
  assert.deepEqual(normalizePackageRefund({ refund_due_amount: 1200, refunded_amount: 1200 }, 1000), {
    refundStatus: "refunded", refundDueAmount: 1000, refundedAmount: 1000, refundDueAt: null, refundNote: null,
  });
});

test("derives supplier recovery status without exceeding paid cost", () => {
  assert.deepEqual(normalizeSupplierRefund({ supplier_refund_due_amount: 700, supplier_refunded_amount: 250, supplier_refund_due_at: "2026-11-05", supplier_refund_note: " Hotel refund " }, 800), {
    status: "partial", dueAmount: 700, receivedAmount: 250, dueAt: "2026-11-05", note: "Hotel refund",
  });
  assert.equal(normalizeSupplierRefund({ supplier_refund_due_amount: 900, supplier_refunded_amount: 900 }, 800).receivedAmount, 800);
});

test("normalizes structured tour cancellation details", () => {
  assert.deepEqual(normalizeTourCancellationDetails({ reason: "  Client changed dates  ", reason_code: "client_plans", initiator: "client" }), {
    reason: "Client changed dates", reasonCode: "client_plans", initiator: "client",
  });
  assert.deepEqual(normalizeTourCancellationDetails({ reason: "Details", reason_code: "unknown", initiator: "unknown" }), {
    reason: "Details", reasonCode: "other", initiator: "client",
  });
});

test("normalizes private traveler details", () => {
  assert.deepEqual(normalizeTraveler({ full_name: "  Jane Doe  ", traveler_type: "child", passport_number: " ab 123 ", notes: " Vegan " }, 2), {
    fullName: "Jane Doe", travelerType: "child", birthDate: null, citizenship: null,
    passportNumber: "AB 123", passportExpiry: null, roomType: null, notes: "Vegan", sortOrder: 2,
  });
});

test("normalizes client follow-up details", () => {
  assert.deepEqual(normalizeClientFollowup({ channel: "telegram", note: "  Sent revised offer  " }), { channel: "telegram", note: "Sent revised offer" });
  assert.deepEqual(normalizeClientFollowup({ channel: "unsupported", note: " " }), { channel: "phone", note: null });
});

test("normalizes private component operations", () => {
  assert.deepEqual(normalizeComponentOperations({ confirmation_reference: " HTL-42 ", supplier_payment_due_at: "2026-11-05", operational_note: " Pay after invoice " }), {
    confirmationReference: "HTL-42", supplierPaymentDueAt: "2026-11-05", supplierPaid: false, operationalNote: "Pay after invoice", qualityRating: null, reliabilityRating: null, performanceNote: null, actualSupplierCost: null, costVarianceNote: null,
  });
  assert.equal(normalizeComponentOperations({ supplier_paid: true }).supplierPaid, true);
  assert.equal(normalizeComponentOperations({ supplier_payment_due_at: "tomorrow" }).supplierPaymentDueAt, null);
  assert.deepEqual(normalizeComponentOperations({ quality_rating: 5, reliability_rating: "4", performance_note: " On time " }), {
    confirmationReference: null, supplierPaymentDueAt: null, supplierPaid: false, operationalNote: null, qualityRating: 5, reliabilityRating: 4, performanceNote: "On time", actualSupplierCost: null, costVarianceNote: null,
  });
  assert.equal(normalizeComponentOperations({ actual_supplier_cost: "125.50" }).actualSupplierCost, 125.5);
});

test("normalizes operational tour tasks", () => {
  assert.deepEqual(normalizeTourTask({ title: " Call hotel ", assigned_to: " Aziza ", due_at: "2026-11-03", priority: "high", completed: true }), {
    title: "Call hotel", assignedTo: "Aziza", dueAt: "2026-11-03", priority: "high", completed: true,
  });
  assert.deepEqual(normalizeTourTask({ title: "Check", due_at: "tomorrow", priority: "urgent" }), {
    title: "Check", assignedTo: null, dueAt: null, priority: "normal", completed: false,
  });
});

test("hashes proposal tokens deterministically without storing the raw token", () => {
  const hash = hashShareToken("a-private-proposal-token");
  assert.equal(hash.length, 64);
  assert.equal(hash, hashShareToken("a-private-proposal-token"));
  assert.notEqual(hash, "a-private-proposal-token");
});

test("accepts all supported client proposal decisions", () => {
  assert.equal(isValidProposalResponse("accepted"), true);
  assert.equal(isValidProposalResponse("changes_requested"), true);
  assert.equal(isValidProposalResponse("declined"), true);
  assert.equal(isValidProposalResponse("pending"), false);
});

test("normalizes structured proposal decline reasons", () => {
  assert.equal(normalizeProposalResponseReason(" budget "), "budget");
  assert.equal(normalizeProposalResponseReason("plans_changed"), "plans_changed");
  assert.equal(normalizeProposalResponseReason("unknown"), null);
});

test("normalizes a required tour cancellation reason", () => {
  assert.equal(normalizeTourCancellationReason("  Client   cancelled the trip  "), "Client cancelled the trip");
  assert.equal(normalizeTourCancellationReason("x".repeat(1200)).length, 1000);
});

test("creates a readable booking reference", () => {
  const reference = createBookingReference(new Date("2026-10-22T00:00:00Z"), Buffer.from([0xab, 0xcd, 0xef]));
  assert.equal(reference, "TVL-261022-ABCDEF");
});

test("escapes untrusted client text before Telegram HTML delivery", () => {
  assert.equal(escapeTelegramHtml("<b>A & B</b>"), "&lt;b&gt;A &amp; B&lt;/b&gt;");
});

test("builds a supplier-safe service order", () => {
  const message = buildSupplierServiceOrderMessage({
    tourPackage: { title: "Silk & Sun", booking_reference: "TVL-001", pax_adult: 2, pax_child: 1, agency_name: "DMC <One>", agency_phone: "+99890" },
    component: { service_title: "City <Tour>", date: "2026-11-03T00:00:00.000Z", confirmation_reference: "CNF-7", operational_note: "Meet & greet" },
    travelers: [{ full_name: "Ali <A>" }, { full_name: "Sara" }],
  });
  assert.match(message, /Silk &amp; Sun/);
  assert.match(message, /City &lt;Tour&gt;/);
  assert.match(message, /Гостей: 3/);
  assert.match(message, /Ali &lt;A&gt;, Sara/);
  assert.match(message, /CNF-7/);
  assert.match(message, /Meet &amp; greet/);
  assert.doesNotMatch(message, /gross_total|client_phone|марж/i);
});

test("builds a safe supplier reminder without commercial data", () => {
  const message = buildSupplierServiceOrderReminderMessage({
    tourPackage: { title: "Silk <Road>", booking_reference: "TVL-9", gross_total: 500 },
    component: { service_title: "Guide & car" },
  });
  assert.match(message, /Silk &lt;Road&gt;/);
  assert.match(message, /Guide &amp; car/);
  assert.match(message, /TVL-9/);
  assert.doesNotMatch(message, /500|gross_total/);
});

test("builds a safe supplier cancellation without commercial data", () => {
  const message = buildSupplierServiceOrderCancellationMessage({
    tourPackage: { title: "Silk <Road>", booking_reference: "TVL-10", gross_total: 900 },
    component: { service_title: "Hotel & transfer", provider_price: 400 },
  });
  assert.match(message, /Silk &lt;Road&gt;/);
  assert.match(message, /Hotel &amp; transfer/);
  assert.match(message, /TVL-10/);
  assert.doesNotMatch(message, /900|400|gross_total|provider_price/);
});

test("builds a contextual supplier note without commercial data", () => {
  const message = buildSupplierServiceOrderNoteMessage({
    tourPackage: { title: "Silk <Road>", booking_reference: "TVL-11", gross_total: 900 },
    component: { service_title: "Guide & car", provider_price: 400 },
    note: "Please meet guests at 08:00 & bring a sign <ACME>",
  });
  assert.match(message, /Silk &lt;Road&gt;/);
  assert.match(message, /Guide &amp; car/);
  assert.match(message, /08:00 &amp; bring a sign &lt;ACME&gt;/);
  assert.doesNotMatch(message, /900|400|gross_total|provider_price/);
});

test("builds a safe supplier document request", () => {
  const message = buildSupplierDocumentRequestMessage({
    tourPackage: { title: "Silk <Road>", booking_reference: "TVL-12" },
    component: { service_title: "Hotel & transfer" },
  });
  assert.match(message, /Silk &lt;Road&gt;/);
  assert.match(message, /Hotel &amp; transfer/);
  assert.match(message, /подтверждение, счёт или ваучер/);
});

test("revision snapshots never retain a share token", () => {
  const snapshot = packageSnapshot({ id: "package", title: "Tour", share_token_hash: "secret", is_shared: true });
  assert.deepEqual(snapshot, { id: "package", title: "Tour" });
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
    current_revision: 3,
  });
  assert.equal(view.gross_total, "1250.00");
  assert.equal(view.client_name, "Alex");
  assert.equal(view.agency.name, "Example DMC");
  assert.equal(view.revision, 3);
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
  assert.equal(derivePackageStatus([{ status: "confirmed" }], "accepted"), "accepted");
  assert.equal(derivePackageStatus([{ status: "confirmed" }], "lost"), "lost");
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

test("requires every operational milestone before departure", () => {
  const readiness = packageOperationsReadiness({
    status: "booked", paymentStatus: "paid", paxAdult: 2, paxChild: 0,
    travelerCount: 2, componentCount: 3, confirmedCount: 3,
    confirmationCount: 3, approvedDocumentCount: 3, supplierPaidCount: 2, supplierOrderAcceptedCount: 3,
  });
  assert.equal(readiness.percent, 88);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.suppliers_paid, false);
  assert.equal(packageOperationsReadiness({
    status: "paid", paymentStatus: "paid", paxAdult: 2, travelerCount: 2,
    componentCount: 3, confirmedCount: 3, confirmationCount: 3, approvedDocumentCount: 3, supplierPaidCount: 3, supplierOrderAcceptedCount: 3,
  }).ready, true);
});

test("orders tour operations by urgency and omits completed payments", () => {
  const timeline = packageOperationsTimeline({
    status: "booked", paymentStatus: "partial", paymentDueAt: "2026-11-05", startDate: "2026-11-10", nextTaskDueAt: "2026-11-01",
  }, [
    { id: 12, service_title: "Hotel", supplier_payment_due_at: "2026-10-30", supplier_paid: false },
    { id: 13, service_title: "Guide", supplier_payment_due_at: "2026-10-20", supplier_paid: true },
  ], new Date("2026-11-01T12:00:00Z"));
  assert.deepEqual(timeline.map((item) => [item.type, item.urgency, item.days]), [
    ["supplier_payment", "overdue", -2],
    ["manual_task", "today", 0],
    ["client_payment", "soon", 4],
    ["departure", "upcoming", 9],
  ]);
  assert.equal(timeline[0].label, "Hotel");
  assert.deepEqual(packageOperationsTimeline({ status: "cancelled", startDate: "2026-11-10" }), []);
  assert.deepEqual(packageOperationsTimeline({ status: "booked", paymentStatus: "paid", startDate: "2026-10-31" }, [], new Date("2026-11-01T12:00:00Z")), []);
});

test("schedules client follow-up and proposal expiry while awaiting a response", () => {
  const timeline = packageOperationsTimeline({
    status: "proposed",
    proposalResponse: null,
    sharedAt: "2026-11-01T09:00:00Z",
    quoteValidUntil: "2026-11-08T18:00:00Z",
  }, [], new Date("2026-11-04T12:00:00Z"));
  assert.deepEqual(timeline.map((item) => [item.type, item.urgency, item.days]), [
    ["client_follow_up", "overdue", -1],
    ["proposal_expiry", "soon", 4],
  ]);
  assert.deepEqual(packageOperationsTimeline({
    status: "proposed",
    proposalResponse: "accepted",
    sharedAt: "2026-11-01T09:00:00Z",
    quoteValidUntil: "2026-11-08T18:00:00Z",
  }, [], new Date("2026-11-04T12:00:00Z")), []);
  assert.deepEqual(packageOperationsTimeline({
    status: "proposed",
    sharedAt: "2026-11-01T09:00:00Z",
    lastClientFollowupAt: "2026-11-04T09:00:00Z",
  }, [], new Date("2026-11-04T12:00:00Z")).map((item) => [item.type, item.urgency, item.days]), [
    ["client_follow_up", "soon", 2],
  ]);
});

