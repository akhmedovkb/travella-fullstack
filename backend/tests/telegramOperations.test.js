const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATEGORIES,
  TOGGLES,
  createTicket,
  togglePreference,
} = require("../services/telegramOperationsService");

test("telegram operations expose the complete support and notification taxonomy", () => {
  assert.deepEqual([...CATEGORIES].sort(), ["booking", "general", "payment", "review", "technical"]);
  assert.ok(TOGGLES.has("booking_updates"));
  assert.ok(TOGGLES.has("learning_updates"));
  assert.ok(TOGGLES.has("marketing_updates"));
});

test("support ticket keeps only a booking owned by the actor", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id,name FROM providers")) return { rows: [{ id: 12, name: "Provider" }], rowCount: 1 };
      if (sql.includes("SELECT id FROM bookings")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO telegram_support_tickets")) return { rows: [{ id: 9, booking_id: params[4], category: params[3], message: params[6] }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const ticket = await createTicket({ role: "provider", telegramId: 777, category: "booking", bookingId: 55, message: "Не вижу ответ по брони" }, db);
  assert.equal(ticket.booking_id, null);
  assert.equal(ticket.actor_name, "Provider");
  assert.ok(calls.some((call) => call.sql.includes("requester_provider_id")));
});

test("notification toggle only changes an allow-listed preference", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("SELECT id,COALESCE")) return { rows: [{ id: 4, name: "Client" }], rowCount: 1 };
      if (sql.includes("INSERT INTO telegram_notification_preferences")) return { rows: [{ actor_id: 4, learning_updates: true }], rowCount: 1 };
      if (sql.includes("UPDATE telegram_notification_preferences")) return { rows: [{ actor_id: 4, learning_updates: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await togglePreference("client", 888, "learning_updates", db);
  assert.equal(result.learning_updates, false);
  await assert.rejects(() => togglePreference("client", 888, "sql_injection", db), /invalid_preference/);
});
