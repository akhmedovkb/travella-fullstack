const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isHotelBookingOrder,
  isHotelBookingPayable,
  syncHotelBookingPaid,
  syncHotelBookingCanceled,
  cancelTransaction,
} = require("../controllers/paymeMerchantController");

test("recognizes only hotel booking Payme orders", () => {
  assert.equal(isHotelBookingOrder({ order_type: "hotel_booking" }), true);
  assert.equal(isHotelBookingOrder({ order_type: "balance_topup" }), false);
});

test("leaves non-hotel Payme orders unchanged", async () => {
  let queried = false;
  const client = { query: async () => { queried = true; return { rowCount: 0 }; } };
  assert.equal(await isHotelBookingPayable(client, { order_type: "balance_topup" }), true);
  assert.equal(queried, false);
});

test("allows only a live awaiting-payment hotel booking", async () => {
  const activeClient = { query: async () => ({ rowCount: 1 }) };
  const inactiveClient = { query: async () => ({ rowCount: 0 }) };
  const order = { order_type: "hotel_booking", booking_id: 77 };

  assert.equal(await isHotelBookingPayable(activeClient, order), true);
  assert.equal(await isHotelBookingPayable(inactiveClient, order), false);
  assert.equal(await isHotelBookingPayable(activeClient, { order_type: "hotel_booking" }), false);
});

test("payment confirms the hotel booking exactly from an active hold", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [{ id: 77 }] };
    },
  };

  await syncHotelBookingPaid({ client, order: { order_type: "hotel_booking", booking_id: 77 } });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /SET status='confirmed', hold_until=NULL/);
  assert.deepEqual(queries[0].params, [77]);
});

test("cancel before payment releases booking as cancelled_unpaid", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  await syncHotelBookingCanceled({
    client,
    order: { order_type: "hotel_booking", booking_id: 77 },
    refunded: false,
  });

  const update = queries.find(({ sql }) => /UPDATE bookings/.test(sql));
  assert.ok(update);
  assert.match(update.sql, /'cancelled_unpaid'/);
  assert.deepEqual(update.params, [77, false]);
});

test("cancel after payment marks refund and remains idempotent", async () => {
  const queries = [];
  const client = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/UPDATE payme_transactions/.test(sql)) {
        return { rows: [{ payme_id: "hotel_refund_1", state: -2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const order = { id: 501, order_type: "hotel_booking", booking_id: 77 };
  const transaction = { payme_id: "hotel_refund_1", state: 2, amount: 100000 };

  const result = await cancelTransaction({ client, transaction, order, reason: 1 });

  assert.equal(result.state, -2);
  const bookingUpdate = queries.find(({ sql }) => /UPDATE bookings/.test(sql));
  assert.ok(bookingUpdate);
  assert.deepEqual(bookingUpdate.params, [77, true]);
  assert.match(bookingUpdate.sql, /refund_status=CASE WHEN \$2::boolean THEN 'refunded'/);

  queries.length = 0;
  const repeated = await cancelTransaction({
    client,
    transaction: { ...transaction, state: -2 },
    order,
    reason: 1,
  });
  assert.equal(repeated.state, -2);
  assert.equal(queries.length, 0);
});
