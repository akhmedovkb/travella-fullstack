const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Tour Builder staging E2E

Required environment variables:
  E2E_BASE_URL
  E2E_DMC_EMAIL
  E2E_DMC_PASSWORD
  E2E_SUPPLIER_EMAIL
  E2E_SUPPLIER_PASSWORD

The DMC account must be an admin so the test payment callback can be simulated.
Production hosts are rejected unless ALLOW_PRODUCTION_E2E=true.`);
  process.exit(0);
}

const baseUrl = String(process.env.E2E_BASE_URL || "").replace(/\/+$/, "");
const productionHosts = new Set([
  "travella.uz",
  "www.travella.uz",
  "travella-fullstack-production.up.railway.app",
]);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertSafeTarget() {
  const url = new URL(required("E2E_BASE_URL"));
  if (productionHosts.has(url.hostname) && process.env.ALLOW_PRODUCTION_E2E !== "true") {
    throw new Error(`Refusing to run destructive E2E against production host ${url.hostname}`);
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("E2E_BASE_URL must use HTTPS outside localhost");
  }
}

async function request(path, { token, method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function login(emailName, passwordName) {
  const data = await request("/api/providers/login", {
    method: "POST",
    body: { email: required(emailName), password: required(passwordName) },
  });
  assert.ok(data?.token, `${emailName} login did not return a token`);
  assert.ok(Number(data?.provider?.id), `${emailName} login did not return provider id`);
  return data;
}

function futureDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function logStep(name, detail = "") {
  console.log(`✓ ${name}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  assertSafeTarget();
  const dmc = await login("E2E_DMC_EMAIL", "E2E_DMC_PASSWORD");
  const supplier = await login("E2E_SUPPLIER_EMAIL", "E2E_SUPPLIER_PASSWORD");
  assert.equal(dmc.provider.is_admin, true, "DMC E2E account must be an admin");
  assert.notEqual(Number(dmc.provider.id), Number(supplier.provider.id), "DMC and supplier accounts must differ");
  logStep("authenticated DMC and supplier");

  const packageId = randomUUID();
  const stamp = new Date().toISOString();
  const startDate = futureDate(45);
  const endDate = futureDate(46);
  const title = `[E2E] Tour Builder ${stamp}`;
  const netTotal = 800000;
  const grossTotal = 920000;
  let bookingId = null;
  let packageCancelled = false;

  try {
    const created = await request("/api/tour-packages", {
      token: dmc.token,
      method: "POST",
      expected: [201],
      body: {
        id: packageId,
        title,
        status: "draft",
        currency: "UZS",
        net_total: netTotal,
        markup_type: "percent",
        markup_value: 15,
        pax_adult: 1,
        pax_child: 0,
        start_date: startDate,
        end_date: endDate,
        quote_valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
        route: { from: "Tashkent", to: "Samarkand" },
        itinerary: [{ date: startDate, title: "E2E city tour" }],
        meta: { e2e: true, created_at: stamp },
        client_name: "E2E Client",
        client_email: "e2e@example.invalid",
      },
    });
    assert.equal(created.id, packageId);
    assert.equal(Number(created.gross_total), grossTotal);
    logStep("created tour package", packageId);

    const booking = await request("/api/bookings", {
      token: dmc.token,
      method: "POST",
      expected: [201],
      body: {
        provider_id: String(supplier.provider.id),
        dates: [startDate],
        pax_adult: 1,
        pax_child: 0,
        language: "en",
        message: `[E2E] ${packageId}`,
        source: "tour_builder",
        type: "guide",
        tb_kind: "guide",
        group_id: packageId,
        currency: "UZS",
        details: { from_city: "Tashkent", to_city: "Samarkand", e2e: true },
      },
    });
    bookingId = Number(booking.id);
    assert.ok(bookingId);
    assert.equal(booking.status, "pending");
    logStep("created supplier component", bookingId);

    const quote = await request(`/api/bookings/${bookingId}/quote`, {
      token: supplier.token,
      method: "POST",
      body: { price: netTotal, currency: "UZS", note: "E2E fixed quote" },
    });
    assert.equal(quote.booking.status, "quoted");
    logStep("supplier quoted component");

    const acceptedBooking = await request(`/api/bookings/${bookingId}/confirm-by-requester`, {
      token: dmc.token,
      method: "POST",
      body: {},
    });
    assert.equal(acceptedBooking.status, "awaiting_payment");
    logStep("DMC accepted supplier quote");

    const paidBooking = await request(`/api/bookings/${bookingId}/pay`, {
      token: dmc.token,
      method: "POST",
      body: {},
    });
    assert.equal(paidBooking.status, "confirmed");
    logStep("simulated payment callback and confirmed component");

    const shared = await request(`/api/tour-packages/${packageId}/share`, {
      token: dmc.token,
      method: "POST",
      body: {},
    });
    assert.ok(shared.token);
    assert.equal(shared.status, "proposed");
    logStep("published client proposal", `revision ${shared.current_revision}`);

    const publicProposal = await request(`/api/tour-packages/public/${encodeURIComponent(shared.token)}`);
    assert.equal(publicProposal.id, packageId);
    assert.equal(publicProposal.title, title);
    await request(`/api/tour-packages/public/${encodeURIComponent(shared.token)}/respond`, {
      method: "POST",
      body: { response: "accepted", message: "Accepted by automated E2E" },
    });
    logStep("client accepted proposal");

    const sale = await request(`/api/tour-packages/${packageId}/confirm-sale`, {
      token: dmc.token,
      method: "POST",
      body: {},
    });
    assert.equal(sale.status, "booked");
    assert.ok(sale.booking_reference);
    assert.equal(sale.readiness.ready, true);
    logStep("confirmed package sale", sale.booking_reference);

    await request(`/api/tour-packages/${packageId}/travelers`, {
      token: dmc.token,
      method: "PUT",
      body: { travelers: [{ full_name: "E2E Traveler", traveler_type: "adult", citizenship: "UZ" }] },
    });
    await request(`/api/tour-packages/${packageId}/components/${bookingId}`, {
      token: dmc.token,
      method: "PATCH",
      body: {
        confirmation_reference: `E2E-${bookingId}`,
        supplier_payment_due_at: futureDate(10),
        supplier_paid: true,
        operational_note: "E2E confirmed",
        actual_supplier_cost: netTotal,
      },
    });
    const paidPackage = await request(`/api/tour-packages/${packageId}/payment`, {
      token: dmc.token,
      method: "PATCH",
      body: { payment_status: "paid", paid_amount: grossTotal, payment_note: "E2E payment" },
    });
    assert.equal(paidPackage.status, "paid");
    assert.equal(paidPackage.payment_status, "paid");
    logStep("recorded travelers, supplier operations and client payment");

    const detail = await request(`/api/tour-packages/${packageId}`, { token: dmc.token });
    assert.equal(detail.status, "paid");
    assert.equal(detail.components.length, 1);
    assert.equal(detail.travelers.length, 1);
    assert.equal(detail.components[0].confirmation_reference, `E2E-${bookingId}`);
    assert.equal(detail.components[0].supplier_paid, true);

    const audit = await request(`/api/tour-packages/${packageId}/audit?limit=100`, { token: dmc.token });
    const actions = new Set((audit.items || []).map((event) => event.action));
    for (const action of [
      "proposal_published",
      "proposal_response_received",
      "sale_confirmed",
      "travelers_updated",
      "component_operations_updated",
      "client_payment_updated",
    ]) assert.ok(actions.has(action), `audit action missing: ${action}`);
    logStep("verified package state and audit trail", `${actions.size} action types`);

    await request(`/api/bookings/${bookingId}/cancel-by-requester`, {
      token: dmc.token,
      method: "POST",
      body: { reason: "Automated E2E cleanup" },
    });
    const cancelled = await request(`/api/tour-packages/${packageId}/cancel`, {
      token: dmc.token,
      method: "POST",
      body: { reason: "Automated E2E cleanup", reason_code: "other", initiator: "dmc" },
    });
    packageCancelled = true;
    assert.equal(cancelled.status, "cancelled");
    await request(`/api/tour-packages/${packageId}/refund`, {
      token: dmc.token,
      method: "PATCH",
      body: { refund_due_amount: grossTotal, refunded_amount: grossTotal, refund_note: "E2E cleanup refund" },
    });
    await request(`/api/tour-packages/${packageId}/components/${bookingId}/refund`, {
      token: dmc.token,
      method: "PATCH",
      body: { supplier_refund_due_amount: netTotal, supplier_refunded_amount: netTotal, supplier_refund_note: "E2E cleanup refund" },
    });
    logStep("verified cancellation and refund settlement");
    console.log(`\nTour Builder E2E passed (${packageId})`);
  } finally {
    if (bookingId && !packageCancelled) {
      await request(`/api/bookings/${bookingId}/cancel-by-requester`, {
        token: dmc.token,
        method: "POST",
        body: { reason: "Automated E2E failure cleanup" },
        expected: [200, 409],
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`Tour Builder E2E failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
