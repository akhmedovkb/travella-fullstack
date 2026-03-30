// backend/controllers/clientBillingController.js
const pool = require("../db");

const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");
const { logUnlockFunnel } = require("../utils/contactUnlockFunnel");

let _clientsBalanceColumn = null;

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function toIntOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function getSessionKey(req) {
  return req.headers["x-session-key"] || null;
}

async function safeLogUnlockFunnel(dbOrPayload, maybePayload = null) {
  try {
    await logUnlockFunnel(dbOrPayload, maybePayload);
  } catch (e) {
    console.error("[unlock-funnel] log error:", e?.message || e);
  }
}

async function getClientsBalanceColumn(client) {
  if (_clientsBalanceColumn !== null) return _clientsBalanceColumn;

  const r = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `);

  const names = r.rows.map((x) => x.column_name);

  const candidates = [
    "contact_balance",
    "contact_balance_tiyin",
    "balance_tiyin",
    "balance",
    "wallet_balance",
  ];

  for (const c of candidates) {
    if (names.includes(c)) {
      _clientsBalanceColumn = c;
      return c;
    }
  }

  _clientsBalanceColumn = null;
  return null;
}

async function getBalanceFromLedger(client, clientId) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(amount),0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id=$1
  `,
    [clientId]
  );

  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(client, clientId) {
  const col = await getClientsBalanceColumn(client);
  const balance = await getBalanceFromLedger(client, clientId);

  if (col) {
    await client.query(
      `
      UPDATE clients
      SET ${col}=$2
      WHERE id=$1
      `,
      [clientId, balance]
    );
  }

  return balance;
}

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

  if (callbackUrl) {
    parts.push(`c=${callbackUrl}`);
  }

  const params = parts.join(";");
  const encoded = Buffer.from(params, "utf8").toString("base64");

  return `${String(checkoutBase || "https://checkout.paycom.uz").replace(/\/+$/, "")}/${encoded}`;
}

async function clientBalance(req, res) {
  const clientId = req.user?.id;
  console.log("[clientBalance] req.user =", req.user);

  if (!clientId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  try {
    const client = await pool.connect();

    try {
      const balance = await getBalanceFromLedger(client, clientId);
      console.log("[clientBalance] ledger balance for", clientId, "=", balance);

      const who = await client.query(`
        SELECT
          current_database() AS db,
          current_user AS db_user,
          inet_server_addr()::text AS server_addr,
          inet_server_port() AS server_port
      `);
      console.log("[clientBalance] db info =", who.rows[0]);
      console.log("[clientBalance] DATABASE_URL =", process.env.DATABASE_URL);

      const unlockSettings = await getContactUnlockSettings(client);

      return res.json({
        ok: true,
        balance,
        unlock_price: unlockSettings.effective_price,
        unlock_is_paid: unlockSettings.is_paid,
        unlock_base_price: unlockSettings.price,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("clientBalance error:", e);
    return res.status(500).json({ ok: false });
  }
}

async function clientBalanceLedger(req, res) {
  const clientId = req.user?.id;

  if (!clientId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const limit = clampInt(req.query.limit, 50, 1, 200);
  const offset = clampInt(req.query.offset, 0, 0, 1000000);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        l.id,
        l.client_id,
        l.amount,
        l.reason,
        l.source,
        l.service_id,
        l.meta,
        l.created_at,

        pt.payme_id,
        pt.state AS payme_state,
        pt.amount_tiyin,
        pt.perform_time,
        pt.fiscal_receipt_id,
        pt.fiscal_sign,
        pt.fiscal_terminal_id,
        pt.fiscal_received_at

      FROM contact_balance_ledger l
      LEFT JOIN payme_transactions pt
        ON pt.payme_id = l.meta->>'payme_id'
      WHERE l.client_id = $1
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2 OFFSET $3
      `,
      [clientId, limit, offset]
    );

    const payload = await (async () => {
      const client = await pool.connect();
      try {
        const balance = await getBalanceFromLedger(client, clientId);
        const unlockSettings = await getContactUnlockSettings(client);

        return {
          balance,
          unlock_price: unlockSettings.effective_price,
          unlock_is_paid: unlockSettings.is_paid,
          unlock_base_price: unlockSettings.price,
        };
      } finally {
        client.release();
      }
    })();

    return res.json({
      ok: true,
      rows,
      limit,
      offset,
      balance: payload.balance,
      unlock_price: payload.unlock_price,
      unlock_is_paid: payload.unlock_is_paid,
      unlock_base_price: payload.unlock_base_price,
    });
  } catch (e) {
    console.error("clientBalanceLedger error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function createTopupOrder(req, res) {
  const clientId = req.user?.id;

  if (!clientId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const amountSum = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amountSum) || amountSum <= 0) {
    return res.status(400).json({ ok: false, message: "Bad amount" });
  }

  const amountTiyin = amountSum * 100;

  const MERCHANT_ID = process.env.PAYME_MERCHANT_ID || "";
  const CHECKOUT_URL =
    process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz";
  const SITE_PUBLIC =
    process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "";

  if (!MERCHANT_ID || !SITE_PUBLIC) {
    return res.status(500).json({
      ok: false,
      message: "Payme is not configured",
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

    const rawServiceId = toIntOrNull(req.body?.service_id);
    if (rawServiceId && rawServiceId > 0) {
      await safeLogUnlockFunnel(db, {
        clientId,
        serviceId: rawServiceId,
        source: "web",
        step: "topup_order_created",
        status: "info",
        priceTiyin: amountTiyin,
        orderId: Number(order.id),
        sessionKey: getSessionKey(req),
        meta: {
          flow: "client_balance_topup",
          provider: "payme",
          callback_path: "/client/balance",
        },
      });
    }

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
  const clientId = req.user?.id;
  const serviceId = Number(req.body?.service_id);

  if (!clientId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  if (!serviceId) {
    return res.status(400).json({ ok: false, message: "Bad service_id" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const unlockSettings = await getContactUnlockSettings(client);
    const price = Number(unlockSettings.effective_price || 0);

    await safeLogUnlockFunnel(client, {
      clientId,
      serviceId,
      source: "web",
      step: "unlock_clicked",
      status: "info",
      priceTiyin: price,
      sessionKey: getSessionKey(req),
      meta: {
        channel: "web",
        route: "/api/client/unlock-contact",
      },
    });

    await client.query(`SELECT id FROM clients WHERE id=$1 FOR UPDATE`, [clientId]);

    const existing = await client.query(
      `
      SELECT id
      FROM client_service_contact_unlocks
      WHERE client_id=$1
      AND service_id=$2
      LIMIT 1
      `,
      [clientId, serviceId]
    );

    if (existing.rows.length) {
      const balance = await getBalanceFromLedger(client, clientId);

      await safeLogUnlockFunnel(client, {
        clientId,
        serviceId,
        source: "web",
        step: "unlock_already_opened",
        status: "success",
        priceTiyin: price,
        balanceBefore: balance,
        balanceAfter: balance,
        sessionKey: getSessionKey(req),
        meta: {
          channel: "web",
          already: true,
        },
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        already: true,
        unlocked: true,
        charged: 0,
        charged_sum: 0,
        balance,
        unlock_price: price,
        unlock_price_sum: Math.round(Number(price || 0) / 100),
        unlock_is_paid: unlockSettings.is_paid,
      });
    }

    const balance = await getBalanceFromLedger(client, clientId);

    if (price > 0 && balance < price) {
      await safeLogUnlockFunnel(client, {
        clientId,
        serviceId,
        source: "web",
        step: "unlock_no_balance",
        status: "fail",
        priceTiyin: price,
        balanceBefore: balance,
        balanceAfter: balance,
        sessionKey: getSessionKey(req),
        meta: {
          channel: "web",
          need: price,
          shortfall: Math.max(0, price - balance),
        },
      });

      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        error: "not_enough_balance",
        balance,
        need: price,
      });
    }

    const unlockInsert = await client.query(
      `
      INSERT INTO client_service_contact_unlocks
      (client_id, service_id, price_charged)
      VALUES ($1,$2,$3)
      ON CONFLICT (client_id, service_id) DO NOTHING
      RETURNING id
      `,
      [clientId, serviceId, price]
    );

    if (!unlockInsert.rows.length) {
      const newBalance = await getBalanceFromLedger(client, clientId);

      await safeLogUnlockFunnel(client, {
        clientId,
        serviceId,
        source: "web",
        step: "unlock_already_opened",
        status: "success",
        priceTiyin: price,
        balanceBefore: newBalance,
        balanceAfter: newBalance,
        sessionKey: getSessionKey(req),
        meta: {
          channel: "web",
          conflict_after_insert: true,
        },
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        already: true,
        unlocked: true,
        charged: 0,
        charged_sum: 0,
        balance: newBalance,
        unlock_price: price,
        unlock_price_sum: Math.round(Number(price || 0) / 100),
        unlock_is_paid: unlockSettings.is_paid,
      });
    }

    if (price > 0) {
      await client.query(
        `
        INSERT INTO contact_balance_ledger
        (client_id, amount, reason, service_id, source, meta)
        VALUES ($1,$2,'unlock_contact',$3,'web',$4::jsonb)
        `,
        [
          clientId,
          -price,
          serviceId,
          JSON.stringify({
            service_id: serviceId,
            unlock_id: unlockInsert.rows[0].id,
            channel: "web",
          }),
        ]
      );
    }

    const newBalance =
      price > 0
        ? await syncClientBalanceMirror(client, clientId)
        : await getBalanceFromLedger(client, clientId);

    await safeLogUnlockFunnel(client, {
      clientId,
      serviceId,
      source: "web",
      step: "unlock_success",
      status: "success",
      priceTiyin: price,
      balanceBefore: balance,
      balanceAfter: newBalance,
      sessionKey: getSessionKey(req),
      meta: {
        channel: "web",
        charged: price,
        unlock_id: unlockInsert.rows[0]?.id || null,
        is_paid_mode: !!unlockSettings.is_paid,
      },
    });

    await client.query("COMMIT");

    return res.json({
      ok: true,
      unlocked: true,
      already: false,
      charged: price,
      charged_sum: Math.round(Number(price || 0) / 100),
      balance: newBalance,
      unlock_price: price,
      unlock_price_sum: Math.round(Number(price || 0) / 100),
      unlock_is_paid: unlockSettings.is_paid,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    try {
      await safeLogUnlockFunnel({
        clientId,
        serviceId,
        source: "web",
        step: "unlock_error",
        status: "fail",
        priceTiyin: 0,
        sessionKey: getSessionKey(req),
        meta: {
          channel: "web",
          error: e?.message || String(e),
        },
      });
    } catch {}

    console.error("unlockContact error:", e);
    return res.status(500).json({ ok: false });
  } finally {
    client.release();
  }
}

module.exports = {
  clientBalance,
  clientBalanceLedger,
  createTopupOrder,
  unlockContact,
};
