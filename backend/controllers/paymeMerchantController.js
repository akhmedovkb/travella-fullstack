// backend/controllers/clientBillingController.js
const pool = require("../db");

const CONTACT_UNLOCK_PRICE = Number(process.env.CONTACT_UNLOCK_PRICE || "10000");

let _clientsBalanceColumn = undefined;

function buildPaymeCheckoutUrl({
  merchantId,
  checkoutBase,
  orderId,
  amountTiyin,
  lang,
  callbackUrl,
}) {
  const parts = [
    `m=${merchantId}`,
    `ac.order_id=${orderId}`,
    `a=${amountTiyin}`,
    `l=${lang || "ru"}`,
  ];
  if (callbackUrl) parts.push(`c=${callbackUrl}`);
  const params = parts.join(";");
  const b64 = Buffer.from(params, "utf8").toString("base64");
  return `${String(checkoutBase || "https://checkout.paycom.uz").replace(/\/+$/, "")}/${b64}`;
}

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function getClientId(req) {
  const role = String(req.user?.role || "").toLowerCase();
  const id = Number(req.user?.id);
  if (role !== "client") return null;
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

async function getClientsBalanceColumn(client) {
  if (_clientsBalanceColumn !== undefined) return _clientsBalanceColumn;

  const { rows } = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `
  );

  const cols = new Set(rows.map((r) => r.column_name));
  const candidates = [
    "contact_balance",
    "contact_balance_tiyin",
    "balance_tiyin",
    "balance",
  ];

  _clientsBalanceColumn = candidates.find((c) => cols.has(c)) || null;
  return _clientsBalanceColumn;
}

async function getBalanceFromLedger(client, clientId) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(amount), 0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id = $1
  `,
    [clientId]
  );

  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(client, clientId) {
  const balanceCol = await getClientsBalanceColumn(client);
  const balance = await getBalanceFromLedger(client, clientId);

  if (balanceCol) {
    await client.query(
      `UPDATE clients
          SET ${balanceCol} = $2
        WHERE id = $1`,
      [clientId, balance]
    );
  }

  return balance;
}

async function getClientBalanceSnapshot(client, clientId) {
  const balance = await getBalanceFromLedger(client, clientId);

  return {
    balance,
    unlock_price: CONTACT_UNLOCK_PRICE,
  };
}

async function clientBalance(req, res) {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(403).json({ ok: false, message: "Client only" });
  }

  const db = await pool.connect();
  try {
    const snapshot = await getClientBalanceSnapshot(db, clientId);

    return res.json({
      ok: true,
      client_id: clientId,
      ...snapshot,
    });
  } catch (e) {
    console.error("clientBalance error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    db.release();
  }
}

async function clientBalanceLedger(req, res) {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(403).json({ ok: false, message: "Client only" });
  }

  const limit = clampInt(req.query.limit, 50, 1, 200);
  const offset = clampInt(req.query.offset, 0, 0, 1000000);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        client_id,
        amount,
        reason,
        source,
        service_id,
        meta,
        created_at
      FROM contact_balance_ledger
      WHERE client_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
      [clientId, limit, offset]
    );

    const snapDb = await pool.connect();
    try {
      const snapshot = await getClientBalanceSnapshot(snapDb, clientId);
      return res.json({
        ok: true,
        rows,
        limit,
        offset,
        balance: snapshot.balance,
        unlock_price: snapshot.unlock_price,
      });
    } finally {
      snapDb.release();
    }
  } catch (e) {
    console.error("clientBalanceLedger error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function createTopupOrder(req, res) {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(403).json({ ok: false, message: "Client only" });
  }

  const amountRaw = Number(req.body?.amount);
  const amountSum = Math.trunc(amountRaw);

  if (!Number.isFinite(amountSum) || amountSum <= 0) {
    return res.status(400).json({ ok: false, message: "Bad amount" });
  }

  const amountTiyin = amountSum * 100;

  const MERCHANT_ID = process.env.PAYME_MERCHANT_ID || "";
  const CHECKOUT_URL =
    process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz";
  const SITE_PUBLIC = process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "";

  if (!MERCHANT_ID || !SITE_PUBLIC) {
    return res.status(500).json({
      ok: false,
      message: "Payme is not configured (PAYME_MERCHANT_ID / SITE_PUBLIC_URL)",
    });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const existsQ = await db.query(
      `SELECT id FROM clients WHERE id = $1 LIMIT 1`,
      [clientId]
    );

    if (!existsQ.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const ins = await db.query(
      `
      INSERT INTO topup_orders (client_id, amount_tiyin, provider, status)
      VALUES ($1, $2, 'payme', 'new')
      RETURNING id, client_id, amount_tiyin, status, created_at
    `,
      [clientId, amountTiyin]
    );

    const order = ins.rows[0];

    const callbackUrl = `${String(SITE_PUBLIC).replace(/\/+$/, "")}/client/balance?order_id=${order.id}`;

    const pay_url = buildPaymeCheckoutUrl({
      merchantId: MERCHANT_ID,
      checkoutBase: CHECKOUT_URL,
      orderId: order.id,
      amountTiyin,
      lang: "ru",
      callbackUrl,
    });

    await db.query("COMMIT");

    return res.json({
      ok: true,
      order: {
        id: Number(order.id),
        client_id: Number(order.client_id),
        amount_tiyin: Number(order.amount_tiyin),
        amount_sum: Math.trunc(Number(order.amount_tiyin) / 100),
        status: order.status,
        created_at: order.created_at,
      },
      pay_url,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("createTopupOrder error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    db.release();
  }
}

async function unlockContact(req, res) {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(403).json({ ok: false, message: "Client only" });
  }

  const serviceId = Number(req.body?.service_id);
  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad service_id" });
  }

  const price = Math.trunc(Number(req.body?.price || CONTACT_UNLOCK_PRICE));
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ ok: false, message: "Bad unlock price" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    await db.query(`SELECT id FROM clients WHERE id = $1 FOR UPDATE`, [clientId]);

    const serviceQ = await db.query(
      `
      SELECT id, provider_id
      FROM services
      WHERE id = $1
      LIMIT 1
    `,
      [serviceId]
    );

    if (!serviceQ.rows.length) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Service not found" });
    }

    const alreadyQ = await db.query(
      `
      SELECT id
      FROM client_service_contact_unlocks
      WHERE client_id = $1 AND service_id = $2
      LIMIT 1
    `,
      [clientId, serviceId]
    );

    if (alreadyQ.rows.length) {
      const snap = await getClientBalanceSnapshot(db, clientId);
      await db.query("COMMIT");
      return res.json({
        ok: true,
        already: true,
        unlocked: true,
        charged: 0,
        balance: snap.balance,
      });
    }

    const balance = await getBalanceFromLedger(db, clientId);

    if (balance < price) {
      await db.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance",
        balance,
        need: price,
      });
    }

    const unlockQ = await db.query(
      `
      INSERT INTO client_service_contact_unlocks
        (client_id, service_id, price_charged)
      VALUES ($1, $2, $3)
      ON CONFLICT (client_id, service_id) DO NOTHING
      RETURNING id
    `,
      [clientId, serviceId, price]
    );

    if (!unlockQ.rows.length) {
      const snap = await getClientBalanceSnapshot(db, clientId);
      await db.query("COMMIT");
      return res.json({
        ok: true,
        already: true,
        unlocked: true,
        charged: 0,
        balance: snap.balance,
      });
    }

    await db.query(
      `
      INSERT INTO contact_balance_ledger
        (client_id, amount, reason, service_id, source, meta)
      VALUES ($1, $2, 'unlock_contact', $3, 'web', $4::jsonb)
    `,
      [
        clientId,
        -price,
        serviceId,
        JSON.stringify({
          unlock_id: unlockQ.rows[0].id,
          channel: "web",
          service_id: serviceId,
        }),
      ]
    );

    const newBalance = await syncClientBalanceMirror(db, clientId);

    await db.query("COMMIT");

    return res.json({
      ok: true,
      unlocked: true,
      already: false,
      charged: price,
      balance: newBalance,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("unlockContact error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    db.release();
  }
}

module.exports = {
  clientBalance,
  clientBalanceLedger,
  createTopupOrder,
  unlockContact,
};
