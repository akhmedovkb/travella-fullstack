// backend/tests/paymeMerchant.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const pool = require("../db");

const PORT = String(5900 + Math.floor(Math.random() * 200));
const BASE = `http://127.0.0.1:${PORT}`;
const RPC_URL = `${BASE}/api/merchant/payme`;

const PAYME_LOGIN = "sandbox_login_test";
const PAYME_KEY = "sandbox_key_test";

function basicAuthHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitServerUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/`, { method: "GET" });
      if (r.ok) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error("Server did not start in time");
}

async function rpc(method, params, id = 1) {
  const body = { jsonrpc: "2.0", id, method, params };
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: basicAuthHeader(PAYME_LOGIN, PAYME_KEY),
    },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return json;
}

function isRpcError(res) {
  return !!res && typeof res === "object" && !!res.error;
}

function getErrCode(res) {
  return res?.error?.code;
}

async function ensurePaymeSchema() {
  // Мини-схема, чтобы тесты были самодостаточными (если миграции ещё не прогнаны)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payme_topup_orders (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS payme_transactions (
      payme_id TEXT PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES payme_topup_orders(id) ON DELETE RESTRICT,
      amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
      state INTEGER NOT NULL,
      create_time BIGINT NOT NULL,
      perform_time BIGINT NULL,
      cancel_time BIGINT NULL,
      reason INTEGER NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS payme_transactions_order_id_idx ON payme_transactions (order_id);
    CREATE INDEX IF NOT EXISTS payme_transactions_create_time_idx ON payme_transactions (create_time);
  `);
}

/**
 * Создаём “минимального клиента” максимально совместимо:
 * - берём NOT NULL колонки без DEFAULT
 * - заполняем типобезопасными значениями
 * Это нужно, чтобы тесты работали в твоей реальной схеме clients.
 */
async function createClientCompat() {
  const suffix = String(Date.now()) + "_" + String(Math.floor(Math.random() * 1e9));

  const { rows: cols } = await pool.query(
    `
    SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='clients'
     ORDER BY ordinal_position ASC
  `
  );

  if (!cols.length) {
    throw new Error("Table public.clients not found. Check DATABASE_URL and migrations.");
  }

  const required = cols.filter(
    (c) =>
      c.column_name !== "id" &&
      String(c.is_nullable).toUpperCase() === "NO" &&
      (c.column_default == null || String(c.column_default).trim() === "")
  );

  const data = {};
  for (const c of required) {
    const name = c.column_name;
    const dt = String(c.data_type || "").toLowerCase();
    const udt = String(c.udt_name || "").toLowerCase();

    if (dt.includes("timestamp") || dt.includes("date")) data[name] = new Date();
    else if (dt.includes("boolean")) data[name] = false;
    else if (dt.includes("integer") || dt.includes("bigint") || udt.includes("int")) data[name] = 0;
    else if (dt.includes("numeric") || dt.includes("double") || dt.includes("real")) data[name] = 0;
    else if (dt.includes("json")) data[name] = {};
    else {
      // text/varchar
      if (name.includes("phone")) data[name] = `99890${suffix.slice(-7)}`; // похож на UZ
      else if (name.includes("email")) data[name] = `payme_test_${suffix}@example.com`;
      else if (name.includes("password")) data[name] = `hash_${suffix}`; // если ожидается hash — не важно, тестам нужен id
      else if (name.includes("name")) data[name] = `Payme Test ${suffix}`;
      else data[name] = `test_${suffix}`;
    }
  }

// Собираем INSERT динамически
const keys = Object.keys(data);

// ✅ если не нашлось ни одной колонки для вставки — делаем DEFAULT VALUES
// (иначе получится INSERT INTO clients () VALUES () и Postgres падает на ")")
if (keys.length === 0) {
  const r0 = await pool.query(`INSERT INTO public.clients DEFAULT VALUES RETURNING id`);
  return Number(r0.rows[0].id);
}

const vals = keys.map((k) => data[k]);

const colsSql = keys.map((k) => `"${k}"`).join(", ");
const phSql = keys.map((_, i) => `$${i + 1}`).join(", ");

const q = `
  INSERT INTO public.clients (${colsSql})
  VALUES (${phSql})
  RETURNING id
`;

const r = await pool.query(q, vals);
return Number(r.rows[0].id);

async function getClientBalance(clientId) {
  // contact_balance может отсутствовать (редко), поэтому читаем по колонкам
  const { rows: cols } = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='clients'
  `);
  const has = new Set(cols.map((r) => r.column_name));

  if (has.has("contact_balance")) {
    const { rows } = await pool.query(`SELECT COALESCE(contact_balance,0) AS v FROM clients WHERE id=$1`, [
      Number(clientId),
    ]);
    return Number(rows[0]?.v || 0);
  }

  // fallback: если баланса в clients нет — считаем по ledger
  const { rows } = await pool.query(
    `
    SELECT COALESCE(SUM(amount),0) AS v
      FROM contact_balance_ledger
     WHERE client_id=$1
  `,
    [Number(clientId)]
  );
  return Number(rows[0]?.v || 0);
}

async function createOrder(clientId, amountTiyin) {
  const { rows } = await pool.query(
    `INSERT INTO payme_topup_orders (client_id, amount_tiyin, status)
     VALUES ($1,$2,'new')
     RETURNING id`,
    [Number(clientId), Number(amountTiyin)]
  );
  return Number(rows[0].id);
}

async function cleanupPaymeTestData() {
  // чистим только “наши” записи, не трогая прод данные
  // (payme_id префикс "tst_" + order.status created/paid/cancelled остаются)
  await pool.query(`DELETE FROM payme_transactions WHERE payme_id LIKE 'tst_%'`);
  // orders — только те, где client_id указывался в тестах (в пределах запуска)
  // мы не знаем их заранее, поэтому удаляем старые created/paid/cancelled "recent"
  await pool.query(
    `DELETE FROM payme_topup_orders
      WHERE created_at > now() - interval '2 hours'
        AND status IN ('new','created','paid','cancelled')`
  );
}

/** ===================== server lifecycle ===================== */

let proc = null;

test.before(async () => {
  await ensurePaymeSchema();

  const backendDir = path.resolve(__dirname, "..");
  proc = spawn(process.execPath, ["index.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT,
      PAYME_MODE: "sandbox",
      PAYME_MERCHANT_LOGIN_SANDBOX: PAYME_LOGIN,
      PAYME_MERCHANT_KEY_SANDBOX: PAYME_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (d) => {
    // можно раскомментировать для дебага
    // process.stdout.write(String(d));
  });
  proc.stderr.on("data", (d) => {
    // process.stderr.write(String(d));
  });

  await waitServerUp();
});

test.after(async () => {
  try {
    await cleanupPaymeTestData();
  } catch {}

  try {
    if (proc && !proc.killed) proc.kill("SIGTERM");
  } catch {}

  try {
    await pool.end();
  } catch {}
});

/** ===================== tests ===================== */

test("Payme: CheckPerformTransaction -> allow=true on valid order", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 10000);

  const res = await rpc("CheckPerformTransaction", {
    amount: 10000,
    account: { order_id: String(orderId) },
  });

  assert.equal(isRpcError(res), false, JSON.stringify(res));
  assert.equal(res.result?.allow, true);
});

test("Payme: CreateTransaction -> state=1, and idempotent on retry", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 7777);

  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const r1 = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 7777,
    account: { order_id: String(orderId) },
  });

  assert.equal(isRpcError(r1), false, JSON.stringify(r1));
  assert.equal(r1.result?.transaction, paymeId);
  assert.equal(r1.result?.state, 1);

  const r2 = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 7777,
    account: { order_id: String(orderId) },
  });

  assert.equal(isRpcError(r2), false, JSON.stringify(r2));
  assert.equal(r2.result?.transaction, paymeId);
  assert.equal(r2.result?.state, 1);
});

test("Payme: PerformTransaction -> credits once, retry does not double credit", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 5000);
  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const b0 = await getClientBalance(clientId);

  const cr = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 5000,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(cr), false, JSON.stringify(cr));

  const p1 = await rpc("PerformTransaction", { id: paymeId });
  assert.equal(isRpcError(p1), false, JSON.stringify(p1));
  assert.equal(p1.result?.state, 2);

  const b1 = await getClientBalance(clientId);
  assert.equal(b1, b0 + 5000);

  // retry perform
  const p2 = await rpc("PerformTransaction", { id: paymeId });
  assert.equal(isRpcError(p2), false, JSON.stringify(p2));
  assert.equal(p2.result?.state, 2);

  const b2 = await getClientBalance(clientId);
  assert.equal(b2, b0 + 5000);
});

test("Payme: race safety -> 2 parallel PerformTransaction still credits once", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 9000);
  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const b0 = await getClientBalance(clientId);

  const cr = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 9000,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(cr), false, JSON.stringify(cr));

  const [a, b] = await Promise.all([
    rpc("PerformTransaction", { id: paymeId }, 101),
    rpc("PerformTransaction", { id: paymeId }, 102),
  ]);

  assert.equal(isRpcError(a), false, JSON.stringify(a));
  assert.equal(isRpcError(b), false, JSON.stringify(b));
  assert.equal(a.result?.state, 2);
  assert.equal(b.result?.state, 2);

  const b1 = await getClientBalance(clientId);
  assert.equal(b1, b0 + 9000);
});

test("Payme: CancelTransaction after Perform -> state=-2 and balance rollback once", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 3000);
  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const b0 = await getClientBalance(clientId);

  const cr = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 3000,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(cr), false, JSON.stringify(cr));

  const p = await rpc("PerformTransaction", { id: paymeId });
  assert.equal(isRpcError(p), false, JSON.stringify(p));
  const b1 = await getClientBalance(clientId);
  assert.equal(b1, b0 + 3000);

  const c1 = await rpc("CancelTransaction", { id: paymeId, reason: 1 });
  assert.equal(isRpcError(c1), false, JSON.stringify(c1));
  assert.equal(c1.result?.state, -2);

  const b2 = await getClientBalance(clientId);
  assert.equal(b2, b0);

  // повторный cancel не должен списать второй раз
  const c2 = await rpc("CancelTransaction", { id: paymeId, reason: 1 });
  assert.equal(isRpcError(c2), false, JSON.stringify(c2));
  assert.equal(c2.result?.state, -2);

  const b3 = await getClientBalance(clientId);
  assert.equal(b3, b0);
});

test("Payme: CheckTransaction returns state/times", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 1111);
  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const cr = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 1111,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(cr), false, JSON.stringify(cr));

  const ck1 = await rpc("CheckTransaction", { id: paymeId });
  assert.equal(isRpcError(ck1), false, JSON.stringify(ck1));
  assert.equal(ck1.result?.transaction, paymeId);
  assert.equal(ck1.result?.state, 1);

  const p = await rpc("PerformTransaction", { id: paymeId });
  assert.equal(isRpcError(p), false, JSON.stringify(p));

  const ck2 = await rpc("CheckTransaction", { id: paymeId });
  assert.equal(isRpcError(ck2), false, JSON.stringify(ck2));
  assert.equal(ck2.result?.state, 2);
  assert.ok(Number(ck2.result?.perform_time || 0) > 0);
});

test("Payme: GetStatement returns created tx in range", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 2222);
  const paymeId = `tst_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const t = Date.now();

  const cr = await rpc("CreateTransaction", {
    id: paymeId,
    time: t,
    amount: 2222,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(cr), false, JSON.stringify(cr));

  const from = t - 60_000;
  const to = t + 60_000;

  const st = await rpc("GetStatement", { from, to });
  assert.equal(isRpcError(st), false, JSON.stringify(st));

  const list = st.result?.transactions || [];
  assert.ok(Array.isArray(list));
  assert.ok(list.some((x) => String(x.id) === paymeId));
});

test("Payme: conflict -> second active tx for same order returns -31099", async () => {
  const clientId = await createClientCompat();
  const orderId = await createOrder(clientId, 3333);
  const t = Date.now();

  const paymeId1 = `tst_${Date.now()}_a_${Math.floor(Math.random() * 1e9)}`;
  const paymeId2 = `tst_${Date.now()}_b_${Math.floor(Math.random() * 1e9)}`;

  const r1 = await rpc("CreateTransaction", {
    id: paymeId1,
    time: t,
    amount: 3333,
    account: { order_id: String(orderId) },
  });
  assert.equal(isRpcError(r1), false, JSON.stringify(r1));

  const r2 = await rpc("CreateTransaction", {
    id: paymeId2,
    time: t,
    amount: 3333,
    account: { order_id: String(orderId) },
  });

  assert.equal(isRpcError(r2), true, JSON.stringify(r2));
  assert.equal(getErrCode(r2), -31099);
});
