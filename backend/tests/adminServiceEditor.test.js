const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { buildServiceEditChanges, writeServiceEditHistory } = require("../utils/serviceEditHistory");
function harness(options = {}) {
  const routes = [], queries = [];
  const before = { id: 12, provider_id: 3, title: "Original", description: "", category: "refused_tour", price: "100", net_price: null, gross_price: null, country: null, city: null, location: null, expiration_at: null, vehicle_model: "", currency: "USD", images: [], availability: [], details: {}, edit_version: "2026-10-29T10:00:00.123456Z" };
  const provider = { telegram_refused_chat_id: "100", telegram_web_chat_id: null, telegram_chat_id: null, provider_edit_version: "2026-10-29T10:00:00.111111Z" };
  const client = { release() { queries.push({ sql: "RELEASE" }); }, async query(sql, values) {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT s.*")) return { rows: options.missing ? [] : [before] };
    if (sql.startsWith("SELECT telegram_")) return { rows: [provider] };
    if (sql.includes("UPDATE services")) return { rows: [{ ...before, title: values[1], description: values[2], details: JSON.parse(values[7]), images: JSON.parse(values[5]), availability: JSON.parse(values[6]), edit_version: "new-version" }] };
    if (sql.includes("INSERT INTO service_moderation_events") && options.auditFails) throw new Error("audit insert failed");
    return { rows: [] };
  } };
  const pool = { connect: async () => client, query: async (sql) => { queries.push({ sql }); return { rows: [{ pending: 1, rejected: 2, published: 3 }] }; } };
  const router = new Proxy({}, { get: (_, method) => (route, ...handlers) => routes.push({ method, route, handler: handlers.at(-1), middleware: handlers.slice(0, -1) }) });
  const multer = () => ({ array: () => () => {} }); multer.memoryStorage = () => ({});
  const requireMock = (name) => {
    if (name === "express") return { Router: () => router };
    if (name === "multer") return multer;
    if (name === "../db") return pool;
    if (name === "../utils/serviceEditHistory") return { writeServiceEditHistory };
    if (name === "../utils/serviceModerationEvents") return { ensureServiceModerationEvents: async () => {}, listServiceModerationEvents: async () => [], logServiceModerationEvent: async () => {} };
    if (name.includes("middleware")) return () => {};
    return {};
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../routes/adminRoutes.js"), "utf8"), { require: requireMock, module: { exports: {} }, console: { error() {} } });
  async function invoke(body = {}, method = "put", route) {
    let status = 200, result;
    const entry = routes.find((r) => r.method === method && (route ? r.route === route : r.route.startsWith("/services/:id") && !r.route.includes("/price")));
    const res = { status(value) { status = value; return this; }, json(value) { result = value; return this; } };
    await entry.handler({ params: { id: "12" }, body, user: { id: 7 } }, res);
    return { status, result, middleware: entry.middleware };
  }
  return { invoke, queries, before, provider };
}
test("stale microsecond version returns conflict with no writes and releases lock", async () => {
  const h = harness(); const response = await h.invoke({ expected_edit_version: "2026-10-29T10:00:00.123455Z", title: "Lost update" });
  assert.equal(response.status, 409); assert.equal(response.result.code, "SERVICE_EDIT_CONFLICT");
  assert.ok(!h.queries.some((q) => /^\s*UPDATE\s/.test(q.sql)));
  assert.ok(h.queries.some((q) => q.sql === "ROLLBACK")); assert.equal(h.queries.at(-1).sql, "RELEASE");
});
test("service update and field diff commit together with actor", async () => {
  const h = harness(); const response = await h.invoke({ expected_edit_version: h.before.edit_version, title: "Updated" });
  assert.equal(response.status, 200);
  const audit = h.queries.find((q) => q.sql.includes("INSERT INTO service_moderation_events"));
  assert.equal(audit.values[1], 7); assert.deepEqual(JSON.parse(audit.values[2]).changes.find((c) => c.field === "title"), { field: "title", before: "Original", after: "Updated" });
  assert.ok(h.queries.some((q) => q.sql === "COMMIT")); assert.ok(!h.queries.some((q) => q.sql === "ROLLBACK"));
});
test("audit failure rolls back service and contacts instead of reporting success", async () => {
  const h = harness({ auditFails: true }); const response = await h.invoke({ title: "Updated" });
  assert.equal(response.status, 500); assert.ok(h.queries.some((q) => q.sql === "ROLLBACK")); assert.ok(!h.queries.some((q) => q.sql === "COMMIT"));
});
test("stale provider contacts conflict; untouched contacts preserve current data", async () => {
  const h = harness(); const response = await h.invoke({ expected_provider_edit_version: "stale", telegram_chat_id: "200" });
  assert.equal(response.status, 409); assert.equal(response.result.code, "PROVIDER_EDIT_CONFLICT");
  const fresh = harness(); assert.equal((await fresh.invoke({ expected_provider_edit_version: "stale", title: "Updated" })).status, 200);
});
test("invalid price rolls back; missing service releases transaction", async () => {
  const h = harness(); assert.equal((await h.invoke({ price: "bad" })).status, 400); assert.ok(h.queries.some((q) => q.sql === "ROLLBACK"));
  const missing = harness({ missing: true }); assert.equal((await missing.invoke()).status, 404); assert.equal(missing.queries.at(-1).sql, "RELEASE");
});
test("counts endpoint is protected and returns summary without loading service rows", async () => {
  const h = harness(); const response = await h.invoke({}, "get", "/services/counts");
  assert.equal(response.status, 200); assert.equal(response.middleware.length, 2); assert.equal(response.result.counts.published, 3);
  assert.equal(h.queries.length, 1); assert.ok(h.queries[0].sql.includes("COUNT(*) FILTER")); assert.ok(!h.queries[0].sql.includes("s.*"));
});
test("history covers details and media changes without copying proof URLs", () => {
  const changes = buildServiceEditChanges({ details: { hotel: "Old", proofImages: ["private-old"] }, images: [] }, { details: { hotel: "New", proofImages: ["private-new"] }, images: [] });
  assert.ok(changes.some((c) => c.field === "details.hotel" && c.before === "Old" && c.after === "New"));
  assert.ok(changes.some((c) => c.field === "details.proofImages")); assert.ok(!JSON.stringify(changes).includes("private-"));
});
