// backend/controllers/paymeMerchantController.js
const pool = require("../db");
const crypto = require("crypto");
const { recordPaymeEvent } = require("../utils/paymeEvents");

function getPaymeCreds() {
  const mode = String(process.env.PAYME_MODE || "").trim().toLowerCase();

  // sandbox/test mode
  if (mode === "sandbox" || mode === "test" || mode === "dev") {
    return {
      login:
        process.env.PAYME_MERCHANT_LOGIN_SANDBOX ||
        process.env.PAYME_MERCHANT_LOGIN ||
        "",
      key:
        process.env.PAYME_MERCHANT_KEY_SANDBOX ||
        process.env.PAYME_MERCHANT_KEY ||
        "",
    };
  }

  // prod/default
  return {
    login: process.env.PAYME_MERCHANT_LOGIN || "",
    key: process.env.PAYME_MERCHANT_KEY || "",
  };
}

/**
 * Payme Merchant API (Paycom): JSON-RPC 2.0 via HTTP POST
 * Auth: Basic base64(login:password)
 *
 * ENV:
 *   PAYME_MODE=live|sandbox
 *   PAYME_MERCHANT_LOGIN / PAYME_MERCHANT_KEY
 *   PAYME_MERCHANT_LOGIN_SANDBOX / PAYME_MERCHANT_KEY_SANDBOX
 */

const TX_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h

function logPayme(event, extra = {}) {
  try {
    console.log(
      JSON.stringify({
        tag: "payme",
        ts: new Date().toISOString(),
        event,
        ...extra,
      })
    );
  } catch {}
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: "2.0", id, error: e };
}

function nowMs() {
  return Date.now();
}

function toIntAmountTiyin(x) {
  // Payme sends "amount" in tiyin (integer). Be strict to avoid float bugs.
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  if (i !== n) return null; // reject fractional values
  return i;
}

/** ===== auth ===== */
function parseBasicAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    return { login: raw.slice(0, idx), key: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireAuth(req) {
  const { login: expLogin, key: expKey } = getPaymeCreds();
  const got = parseBasicAuth(req);

  // если кредов нет — всегда запрещаем (чтобы не открыть дыру)
  if (!expLogin || !expKey) return false;

  return !!got && got.login === expLogin && got.key === expKey;
}

/** ===== normalization (bank-grade) ===== */

function normalizePaymeId(x) {
  // Payme id может прилететь с пробелами/невидимыми символами из тестов/инструментов
  // Нормализуем одинаково везде.
  const s = String(x ?? "")
    .replace(/\u0000/g, "") // null bytes
    .trim();

  // collapse whitespace inside (на случай "pm_tx_123 " / "pm_tx_ 123")
  return s.replace(/\s+/g, " ");
}

/** ===== Payme account =====
 * We use account.order_id (topup order id)
 */
function extractOrderId(params) {
  const oid = params?.account?.order_id ?? params?.account?.["order_id"];
  const n = Number(oid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ===== advisory locks ===== */

async function lockKeyTx(client, keyStr) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(keyStr)]);
}

/** ===== DB helpers ===== */

async function getOrderTx(client, orderId) {
  // ✅ Single source of truth: topup_orders (FK target for payme_transactions.order_id)
  const { rows } = await client.query(
    `SELECT id, client_id, amount_tiyin, status, paid_at
       FROM topup_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId]
  );
  return rows[0] || null;
}

async function getTxForUpdate(client, paymeId) {
  const { rows } = await client.query(
    `SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
       FROM payme_transactions
      WHERE payme_id = $1
      FOR UPDATE`,
    [paymeId]
  );
  return rows[0] || null;
}

// fallback read (без FOR UPDATE) — чтобы диагностировать “почему не нашли”

async function insertTxIfAbsent(client, { paymeId, orderId, amount, createTime }) {
  const { rows } = await client.query(
    `INSERT INTO payme_transactions
      (payme_id, order_id, amount_tiyin, state, create_time, updated_at)
     VALUES ($1,$2,$3,1,$4,now())
     ON CONFLICT (payme_id) DO NOTHING
     RETURNING payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason`,
    [paymeId, orderId, amount, createTime]
  );
  return rows[0] || null;
}

async function setTxState(client, paymeId, patch) {
  const state = Number.isFinite(patch?.state) ? patch.state : null;
  const perform_time = Number.isFinite(patch?.perform_time) ? patch.perform_time : null;
  const cancel_time = Number.isFinite(patch?.cancel_time) ? patch.cancel_time : null;
  const reason =
    patch && Object.prototype.hasOwnProperty.call(patch, "reason") ? patch.reason : null;

  const { rows } = await client.query(
    `UPDATE payme_transactions
        SET state = COALESCE($2, state),
            perform_time = COALESCE($3, perform_time),
            cancel_time = COALESCE($4, cancel_time),
            reason = COALESCE($5, reason),
            updated_at = now()
      WHERE payme_id = $1
      RETURNING payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason`,
    [paymeId, state, perform_time, cancel_time, reason]
  );
  return rows[0] || null;
}

async function markOrderStatusTx(client, orderId, status, paidAt = null) {
  await client.query(
    `UPDATE topup_orders
        SET status = $2,
            paid_at = COALESCE($3, paid_at)
      WHERE id = $1`,
    [orderId, status, paidAt]
  );
}
// ===== contact_balance_ledger helpers (schema-safe) =====
const _ledgerColsCache = { cols: null };

async function getLedgerCols(client) {
  if (_ledgerColsCache.cols) return _ledgerColsCache.cols;

  const { rows } = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_balance_ledger'
  `
  );

  const set = new Set(rows.map((r) => r.column_name));
  _ledgerColsCache.cols = set;
  return set;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function buildInsert(table, data, conflictCols) {
  const cols = Object.keys(data);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const sql =
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")}) ` +
    (conflictCols?.length
      ? `ON CONFLICT (${conflictCols.join(", ")}) DO NOTHING`
      : "");
  const args = cols.map((c) => data[c]);
  return { sql, args };
}

// ===== schema-aware helpers (no more "column does not exist") =====
const _schemaCache = {
  cols: new Map(), // key: "schema.table" -> Set(col)
  balanceCol: null, // cached chosen column name in clients
};

async function getColumns(client, table, schema = "public") {
  const key = `${schema}.${table}`;
  if (_schemaCache.cols.has(key)) return _schemaCache.cols.get(key);

  const { rows } = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
  `,
    [schema, table]
  );

  const set = new Set(rows.map((r) => r.column_name));
  _schemaCache.cols.set(key, set);
  return set;
}

async function pickClientsBalanceColumn(client) {
  if (_schemaCache.balanceCol) return _schemaCache.balanceCol;

  const cols = await getColumns(client, "clients");
  // пробуем самые вероятные варианты
  const candidates = ["contact_balance", "contact_balance_tiyin", "balance_tiyin", "balance"];
  const found = candidates.find((c) => cols.has(c)) || null;

  _schemaCache.balanceCol = found;
  return found;
}

async function bumpClientBalanceIfExists(client, clientId, deltaTiyin) {
  // ✅ Variant B:
  // clients.* balance columns are NOT used in this project.
  // Single source of truth is contact_balance_ledger.
  return;
}

/**
 * Ledger idempotency:
 * We do NOT rely on "ON CONFLICT" with expression keys (it is not supported in PG syntax).
 * Instead we guarantee idempotency via:
 *  - pg_advisory_xact_lock(payme:<id>) around Perform/Cancel
 *  - explicit existence check inside the same DB transaction
 */
// ===== idempotent credit (write amount_tiyin always) =====
// ===== idempotent credit/debit for contact_balance_ledger (schema-safe) =====

// helper: does ON CONFLICT work? (requires unique/exclusion constraint)
function isOnConflictNoConstraintErr(e) {
  // "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  return String(e?.code || "") === "42P10";
}

async function ledgerExistsTx(client, cols, { paymeId, orderId, sourceHint }) {
  // Prefer explicit columns if they exist
  if (cols.has("payme_id") && cols.has("order_id")) {
    const { rows } = await client.query(
      `SELECT 1 FROM contact_balance_ledger WHERE payme_id=$1 AND order_id=$2 LIMIT 1`,
      [String(paymeId), Number(orderId)]
    );
    return rows.length > 0;
  }

  // Fallback to meta json
  if (cols.has("meta")) {
    // If source exists, narrow a bit (optional)
    if (cols.has("source")) {
      const { rows } = await client.query(
        `
        SELECT 1
          FROM contact_balance_ledger
         WHERE source = $1
           AND (meta->>'payme_id') = $2
           AND (meta->>'order_id') = $3
         LIMIT 1
        `,
        [String(sourceHint || "payme"), String(paymeId), String(orderId)]
      );
      return rows.length > 0;
    }

    const { rows } = await client.query(
      `
      SELECT 1
        FROM contact_balance_ledger
       WHERE (meta->>'payme_id') = $1
         AND (meta->>'order_id') = $2
       LIMIT 1
      `,
      [String(paymeId), String(orderId)]
    );
    return rows.length > 0;
  }

  // If neither payme_id/order_id nor meta exist, idempotency by existence is impossible:
  // in that case we still rely on payme advisory lock, and insert once per tx execution.
  return false;
}

async function insertLedgerTx(client, cols, data, conflictCols) {
  const { sql, args } = buildInsert("contact_balance_ledger", data, conflictCols);
  return await client.query(sql, args);
}

async function creditLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  const amt = Number(amountTiyin);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("creditLedgerOnceTx: bad amountTiyin");

  const cols = await getLedgerCols(client);

  // ✅ idempotency for your schema: meta->>'payme_id' + meta->>'order_id'
  if (cols.has("meta")) {
    const { rows: ex } = await client.query(
      `
      SELECT 1
      FROM contact_balance_ledger
      WHERE source = 'payme'
        AND reason = 'topup'
        AND meta->>'payme_id' = $1
        AND meta->>'order_id' = $2
      LIMIT 1
      `,
      [String(paymeId), String(orderId)]
    );
    if (ex.length) return;
  }

  const row = {};
  if (cols.has("client_id")) row.client_id = Number(clientId);
  if (cols.has("amount")) row.amount = amt; // ✅ your DB uses amount (tiyin)
  if (cols.has("reason")) row.reason = "topup";
  if (cols.has("source")) row.source = "payme";
  if (cols.has("service_id")) row.service_id = null;

  if (cols.has("meta")) {
    row.meta = {
      payme_id: String(paymeId),
      order_id: String(orderId),
      kind: "topup",
    };
  }

  const { sql, args } = buildInsert("contact_balance_ledger", row, null);
  await client.query(sql, args);
}


// ===== idempotent debit (reversal) =====
async function debitLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId, reasonCode }) {
  const amt = Number(amountTiyin);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("debitLedgerOnceTx: bad amountTiyin");

  const cols = await getLedgerCols(client);

  // ✅ idempotency for refund row
  if (cols.has("meta")) {
    const { rows: ex } = await client.query(
      `
      SELECT 1
      FROM contact_balance_ledger
      WHERE source = 'payme_refund'
        AND reason = 'refund'
        AND meta->>'payme_id' = $1
        AND meta->>'order_id' = $2
      LIMIT 1
      `,
      [String(paymeId), String(orderId)]
    );
    if (ex.length) return;
  }

  const row = {};
  if (cols.has("client_id")) row.client_id = Number(clientId);
  if (cols.has("amount")) row.amount = -amt; // ✅ negative for reversal
  if (cols.has("reason")) row.reason = "refund";
  if (cols.has("source")) row.source = "payme_refund";
  if (cols.has("service_id")) row.service_id = null;

  if (cols.has("meta")) {
    row.meta = {
      payme_id: String(paymeId),
      order_id: String(orderId),
      kind: "refund",
      reason_code: Number.isFinite(Number(reasonCode)) ? Number(reasonCode) : null,
    };
  }

  const { sql, args } = buildInsert("contact_balance_ledger", row, null);
  await client.query(sql, args);
}

/** ===== rpc validation ===== */

function validateRpc(body) {
  const jsonrpc = body?.jsonrpc;
  const id = body?.id;
  const method = body?.method;
  const params = body?.params;

  if (jsonrpc !== "2.0") {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32600, "Invalid Request") };
  }
  if (typeof method !== "string" || !method) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32600, "Invalid Request") };
  }
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32602, "Invalid params") };
  }
  return { ok: true, id, method, params: params || {} };
}

/** ===== main handler ===== */

async function paymeMerchantRpc(req, res) {
    // ===== Payme Events logging (bank-grade, one place) =====
  const __paymeStart = Date.now();
  const __paymeIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
  const __paymeUa = req.headers["user-agent"] || null;

  // body может быть undefined в некоторых случаях (например, если парсер упал)
  const __paymeBody = req.body || {};
  const __paymeRpcId = __paymeBody?.id ?? null;
  const __paymeMethod = __paymeBody?.method ?? null;

  // вытащим order_id / payme_id если есть (чтобы в списке логов было удобно фильтровать)
  const __paymeOrderId =
    (__paymeBody?.params?.account?.order_id ??
      __paymeBody?.params?.account?.["order_id"]) ?? null;

  const __paymePaymeId =
    __paymeBody?.params?.id ??
    __paymeBody?.params?.transaction ??
    __paymeBody?.id ??
    null;

  // 1) begin (best-effort, не ломает процессинг)
  try {
    await recordPaymeEvent({
      method: __paymeMethod ? String(__paymeMethod) : null,
      stage: "begin",
      payme_id: __paymePaymeId ? String(__paymePaymeId) : null,
      order_id: __paymeOrderId ? Number(__paymeOrderId) : null,
      rpc_id: __paymeRpcId !== undefined && __paymeRpcId !== null ? String(__paymeRpcId) : null,
      ip: __paymeIp ? String(__paymeIp) : null,
      user_agent: __paymeUa ? String(__paymeUa) : null,
      req_json: __paymeBody,
    });
  } catch {}

  // 2) перехватываем res.json, чтобы логировать ВСЕ ответы в одном месте
  const __origStatus = res.status.bind(res);
  const __origJson = res.json.bind(res);

  let __httpStatus = 200;
  res.status = (code) => {
    __httpStatus = Number(code) || __httpStatus;
    return __origStatus(code);
  };

  res.json = (payload) => {
    // payload может быть объектом ok()/rpcError()
    (async () => {
      try {
        const errCode =
          payload?.error?.code !== undefined && payload?.error?.code !== null
            ? Number(payload.error.code)
            : null;
        const errMsg =
          payload?.error?.message !== undefined && payload?.error?.message !== null
            ? String(payload.error.message)
            : null;

        await recordPaymeEvent({
          method: __paymeMethod ? String(__paymeMethod) : null,
          stage: errCode ? "error" : "end",
          payme_id: __paymePaymeId ? String(__paymePaymeId) : null,
          order_id: __paymeOrderId ? Number(__paymeOrderId) : null,
          rpc_id: __paymeRpcId !== undefined && __paymeRpcId !== null ? String(__paymeRpcId) : null,
          http_status: __httpStatus,
          error_code: Number.isFinite(errCode) ? errCode : null,
          error_message: errMsg || null,
          duration_ms: Date.now() - __paymeStart,
          res_json: payload,
        });
      } catch {}
    })();

    return __origJson(payload);
  };
  // ===== /Payme Events logging =====
  try {
    if (!requireAuth(req)) {
      const reqId = req?.body?.id ?? null;
      return res.status(200).json(rpcError(reqId, -32504, "Unauthorized"));
    }

    const v = validateRpc(req.body || {});
    if (!v.ok) return res.status(200).json(v.err);

    const { id, method, params } = v;

    /** ---- CheckPerformTransaction ---- */
    if (method === "CheckPerformTransaction") {
      const orderId = extractOrderId(params);
      const amount = toIntAmountTiyin(params.amount);

      if (!orderId) return res.status(200).json(rpcError(id, -31050, "Invalid account"));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(200).json(rpcError(id, -32602, "Invalid params.amount"));
      }

      const { rows } = await pool.query(
        `SELECT id, amount_tiyin, status
           FROM topup_orders
          WHERE id = $1`,
        [orderId]
      );
      const order = rows[0];
      if (!order) return res.status(200).json(rpcError(id, -31050, "Order not found"));
      if (Number(order.amount_tiyin) !== amount)
        return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
      if (order.status === "paid") return res.status(200).json(rpcError(id, -31008, "Already paid"));
      if (order.status === "cancelled")
        return res.status(200).json(rpcError(id, -31008, "Order cancelled"));

      return res.status(200).json(ok(id, { allow: true }));
    }

    /** ---- CreateTransaction ---- */
    if (method === "CreateTransaction") {
      const orderId = extractOrderId(params);
      const amount = toIntAmountTiyin(params.amount);
      const paymeIdRaw = params.id;
      const paymeId = normalizePaymeId(paymeIdRaw);
      const time = Number(params.time);

      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));
      if (!orderId) return res.status(200).json(rpcError(id, -31050, "Invalid account"));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(200).json(rpcError(id, -32602, "Invalid params.amount"));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await lockKeyTx(client, `payme:${paymeId}`);
        await lockKeyTx(client, `order:${orderId}`);

        logPayme("CreateTransaction.begin", { paymeId, orderId, amount });

        // Edge-case guard: one order must not have 2 active transactions
        const { rows: orderTxRows } = await client.query(
          `SELECT payme_id, state
             FROM payme_transactions
            WHERE order_id = $1
              AND state IN (1,2)
            LIMIT 1
            FOR UPDATE`,
          [orderId]
        );
        const activeForOrder = orderTxRows[0] || null;

        const existing = await getTxForUpdate(client, paymeId);
        if (existing) {
          if (Number(existing.order_id) !== Number(orderId)) {
            await client.query("ROLLBACK");
            return res.status(200).json(rpcError(id, -31099, "Transaction conflict (order mismatch)"));
          }
          if (Number(existing.amount_tiyin) !== Number(amount)) {
            await client.query("ROLLBACK");
            return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
          }

          await client.query("COMMIT");
          return res.status(200).json(
            ok(id, {
              create_time: Number(existing.create_time) || (Number.isFinite(time) ? time : nowMs()),
              transaction: paymeId,
              state: Number(existing.state),
              receivers: null,
            })
          );
        }

        if (activeForOrder && String(activeForOrder.payme_id) !== String(paymeId)) {
          await client.query("ROLLBACK");
          return res
            .status(200)
            .json(rpcError(id, -31099, "Transaction conflict (another active tx for order)"));
        }

        const order = await getOrderTx(client, orderId);
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31050, "Order not found"));
        }
        if (Number(order.amount_tiyin) !== amount) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
        }
        if (order.status === "paid") {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Already paid"));
        }
        if (order.status === "cancelled") {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Order cancelled"));
        }

        const createTime = Number.isFinite(time) && time > 0 ? time : nowMs();

        // Payme spec: do not allow creating too-old transactions
        if (nowMs() - createTime > TX_TIMEOUT_MS) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Transaction expired"));
        }

        await insertTxIfAbsent(client, {
          paymeId,
          orderId,
          amount,
          createTime,
        });

        // Keep compatibility with older bot statuses: 'new' -> 'created'
        if (order.status === "new" || order.status === "created" || !order.status) {
          await markOrderStatusTx(client, orderId, "created");
        }

        await client.query("COMMIT");

        return res.status(200).json(
          ok(id, {
            create_time: createTime,
            transaction: paymeId,
            state: 1,
            receivers: null,
          })
        );
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        console.error("[payme] CreateTransaction error:", e?.message || e);
        return res.status(200).json(rpcError(id, -32400, "Internal error"));
      } finally {
        client.release();
      }
    }

/** ---- PerformTransaction ---- */
if (method === "PerformTransaction") {
  const paymeId = normalizePaymeId(params.id);

  if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // serialize all operations per payme transaction id
    await lockKeyTx(client, `payme:${paymeId}`);

    logPayme("PerformTransaction.begin", { paymeId });

    // Strict row lock ONLY
    const tx = await getTxForUpdate(client, paymeId);
    if (!tx) {
      await client.query("ROLLBACK");
      const raw = String(params.id ?? "");
      const hex = Buffer.from(raw, "utf8").toString("hex").slice(0, 80);
      logPayme("PerformTransaction.not_found", {
        paymeId_norm: paymeId,
        paymeId_raw_len: raw.length,
        paymeId_raw_hex_prefix: hex,
      });
      return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
    }

    // lock order too
    if (tx?.order_id) {
      await lockKeyTx(client, `order:${tx.order_id}`);
    }

    // cancelled => refuse perform
    if (Number(tx.state) === -1 || Number(tx.state) === -2) {
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Transaction cancelled"));
    }

    // expired => cancel as -1 and refuse
    const ct = Number(tx.create_time) || 0;
    if (ct && nowMs() - ct > TX_TIMEOUT_MS) {
      const cancelTime = nowMs();
      await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Transaction expired"));
    }

    // idempotent: already performed
    if (Number(tx.state) === 2) {
      const pt = Number(tx.perform_time) || 0;
      await client.query("COMMIT");
      return res.status(200).json(
        ok(id, {
          transaction: paymeId,
          perform_time: pt,
          state: 2,
        })
      );
    }

    const orderId = Number(tx.order_id);
    const order = await getOrderTx(client, orderId);
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31050, "Order not found"));
    }

    // if our order is cancelled => cancel tx and refuse
    if (order.status === "cancelled") {
      const cancelTime = nowMs();
      await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Order cancelled"));
    }

    // If order already paid (by some other flow), finalize tx as performed idempotently
    if (order.status === "paid") {
      const performTime = order.paid_at ? new Date(order.paid_at).getTime() : nowMs();
      await setTxState(client, paymeId, { state: 2, perform_time: performTime });
      await client.query("COMMIT");
      return res.status(200).json(
        ok(id, {
          transaction: paymeId,
          perform_time: performTime,
          state: 2,
        })
      );
    }

    // FK safety: client must exist
    const { rows: cRows } = await client.query(`SELECT id FROM clients WHERE id=$1`, [
      Number(order.client_id),
    ]);
    if (!cRows.length) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31050, "Client not found"));
    }

    // Perform time now
    const performTime = nowMs();

    // 1) set tx performed
    await setTxState(client, paymeId, { state: 2, perform_time: performTime });

    // 2) mark order paid
    await markOrderStatusTx(client, orderId, "paid", new Date(performTime));

    // 3) credit once (idempotent via existence check under same advisory lock)
    await creditLedgerOnceTx(client, {
      clientId: Number(order.client_id),
      amountTiyin: Number(order.amount_tiyin),
      orderId,
      paymeId,
    });

    await client.query("COMMIT");

    return res.status(200).json(
      ok(id, {
        transaction: paymeId,
        perform_time: performTime,
        state: 2,
      })
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[payme] PerformTransaction error:", e?.message || e);
    return res.status(200).json(rpcError(id, -32400, "Internal error"));
  } finally {
    client.release();
  }
}
/** ---- CancelTransaction ---- */
if (method === "CancelTransaction") {
  const paymeId = normalizePaymeId(params.id);
  const reason = Number(params.reason);

  if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock by payme id (serializes cancel/perform/check flows for same tx)
    await lockKeyTx(client, `payme:${paymeId}`);

    const tx = await getTxForUpdate(client, paymeId);
    if (!tx) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
    }

    // lock by order too (serializes anything that touches the same order)
    if (tx?.order_id) {
      await lockKeyTx(client, `order:${tx.order_id}`);
    }

    // already cancelled => idempotent reply, no extra debits
    if (Number(tx.state) === -1 || Number(tx.state) === -2) {
      await client.query("COMMIT");
      return res.status(200).json(
        ok(id, {
          transaction: paymeId,
          cancel_time: Number(tx.cancel_time) || nowMs(),
          state: Number(tx.state),
          reason: tx.reason ?? null,
        })
      );
    }

    const cancelTime = nowMs();
    const newState = Number(tx.state) === 2 ? -2 : -1;

    // update tx state (single source of truth)
    const updated = await setTxState(client, paymeId, {
      state: newState,
      cancel_time: cancelTime,
      reason: Number.isFinite(reason) ? reason : null,
    });

    // ===== bank-grade reversal decision =====
    const prevState = Number(tx.state);
    const newStateDb = Number(updated?.state ?? newState);

    // reversal only if THIS request moved state from 2 -> -2
    if (prevState === 2 && newStateDb === -2) {
      const orderId = Number(tx.order_id);
      const order = await getOrderTx(client, orderId);

      if (order) {
        await debitLedgerOnceTx(client, {
          clientId: Number(order.client_id),
          amountTiyin: Number(order.amount_tiyin),
          orderId,
          paymeId,
          reasonCode: Number.isFinite(reason) ? reason : null,
        });

        await markOrderStatusTx(client, orderId, "cancelled");
      }
    }

    await client.query("COMMIT");

    return res.status(200).json(
      ok(id, {
        transaction: paymeId,
        cancel_time: cancelTime,
        state: Number(updated?.state ?? newState),
        reason: updated?.reason ?? (Number.isFinite(reason) ? reason : null),
      })
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[payme] CancelTransaction error:", e?.message || e);
    return res.status(200).json(rpcError(id, -32400, "Internal error"));
  } finally {
    client.release();
  }
}

    /** ---- CheckTransaction ---- */
    if (method === "CheckTransaction") {
      const paymeId = normalizePaymeId(params.id);
      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

      const { rows } = await pool.query(
        `SELECT payme_id, order_id, state, create_time, perform_time, cancel_time, reason
           FROM payme_transactions
          WHERE payme_id = $1`,
        [paymeId]
      );
      const tx = rows[0];
      if (!tx) return res.status(200).json(rpcError(id, -31003, "Transaction not found"));

      return res.status(200).json(
        ok(id, {
          create_time: Number(tx.create_time) || 0,
          perform_time: Number(tx.perform_time) || 0,
          cancel_time: Number(tx.cancel_time) || 0,
          transaction: String(tx.payme_id),
          state: Number(tx.state),
          reason: tx.reason ?? null,
        })
      );
    }

    /** ---- GetStatement ---- */
    if (method === "GetStatement") {
      const from = Number(params.from);
      const to = Number(params.to);

      const { rows } = await pool.query(
        `
        SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
          FROM payme_transactions
         WHERE ($1::bigint IS NULL OR create_time >= $1)
           AND ($2::bigint IS NULL OR create_time <= $2)
         ORDER BY create_time ASC
         LIMIT 5000
        `,
        [Number.isFinite(from) ? from : null, Number.isFinite(to) ? to : null]
      );

      const result = rows.map((r) => ({
        id: String(r.payme_id),
        time: Number(r.create_time) || 0,
        amount: Number(r.amount_tiyin) || 0,
        account: { order_id: String(r.order_id) },
        create_time: Number(r.create_time) || 0,
        perform_time: Number(r.perform_time) || 0,
        cancel_time: Number(r.cancel_time) || 0,
        transaction: String(r.payme_id),
        state: Number(r.state),
        reason: r.reason ?? null,
      }));

      return res.status(200).json(ok(id, { transactions: result }));
    }

    /** ---- SetFiscalData (optional) ---- */
    if (method === "SetFiscalData") {
      return res.status(200).json(ok(id, { success: true }));
    }

    return res.status(200).json(rpcError(id, -32601, "Method not found"));
  } catch (e) {
    console.error("[payme] handler fatal:", e?.message || e);
    return res.status(200).json(rpcError(null, -32400, "Internal error"));
  }
}

module.exports = {
  paymeMerchantRpc,
};
