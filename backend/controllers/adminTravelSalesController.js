//backend/controllers/adminTravelSalesController.js

const db = require("../db");

function toStr(v) {
  return String(v ?? "").trim();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function validateDate(v) {
  const s = toStr(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateOnly(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeSaleRow(row) {
  if (!row) return row;
  return {
    ...row,
    sale_date: formatDateOnly(row.sale_date),
    payment_date: formatDateOnly(row.payment_date),
  };
}

function normalizeSaleRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizeSaleRow) : [];
}

function normalizePaymentRow(row) {
  if (!row) return row;
  return {
    ...row,
    payment_date: formatDateOnly(row.payment_date),
  };
}

function normalizePaymentRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizePaymentRow) : [];
}

function normalizeLedgerRow(row) {
  if (!row) return row;
  return {
    ...row,
    txn_date: formatDateOnly(row.txn_date),
    sale_date: formatDateOnly(row.sale_date),
    payment_date: formatDateOnly(row.payment_date),
  };
}

function normalizeLedgerRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizeLedgerRow) : [];
}

function normalizeServiceType(v) {
  const s = toStr(v).toLowerCase();
  if (["airticket", "visa", "tourpackage"].includes(s)) return s;
  return "";
}

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS travel_agents (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS travel_daily_sales (
      id BIGSERIAL PRIMARY KEY,
      sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
      agent_id BIGINT NOT NULL REFERENCES travel_agents(id) ON DELETE RESTRICT,
      service_type TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      traveller_name TEXT NOT NULL DEFAULT '',
      sale_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      payment NUMERIC(14,2) NOT NULL DEFAULT 0,
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      comment TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE travel_daily_sales
    ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT '';
  `);

  await db.query(`
    ALTER TABLE travel_daily_sales
    ADD COLUMN IF NOT EXISTS traveller_name TEXT NOT NULL DEFAULT '';
  `);

  await db.query(`
    ALTER TABLE travel_daily_sales
    ADD COLUMN IF NOT EXISTS payment_date DATE NOT NULL DEFAULT CURRENT_DATE;
  `);

  await db.query(`
    ALTER TABLE travel_daily_sales
    ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_agent_id
    ON travel_daily_sales(agent_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_sale_date
    ON travel_daily_sales(sale_date);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_service_type
    ON travel_daily_sales(service_type);
  `);

  await db.query(`
  CREATE TABLE IF NOT EXISTS travel_agent_payments (
    id BIGSERIAL PRIMARY KEY,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    agent_id BIGINT NOT NULL REFERENCES travel_agents(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    entry_type TEXT NOT NULL DEFAULT 'payment',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
  
  await db.query(`
  ALTER TABLE travel_agent_payments
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'payment';
`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_travel_agent_payments_agent_id
    ON travel_agent_payments(agent_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_travel_agent_payments_payment_date
    ON travel_agent_payments(payment_date);
  `);
}

/**
 * АГЕНТЫ
 */

async function getAgents(req, res) {
  try {
    await ensureTables();

    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const q = toStr(req.query.q);

    const { rows } = await db.query(
      `
      SELECT
        id,
        name,
        contact,
        address,
        created_at,
        updated_at
      FROM travel_agents
      WHERE (
        $1::text IS NULL
        OR name ILIKE $1
        OR contact ILIKE $1
        OR address ILIKE $1
        OR CAST(id AS text) ILIKE $1
      )
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
      `,
      [q ? `%${q}%` : null, limit, offset]
    );

    return res.json({
      ok: true,
      rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("getAgents error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function createAgent(req, res) {
  try {
    await ensureTables();

    const name = toStr(req.body?.name);
    const contact = toStr(req.body?.contact);
    const address = toStr(req.body?.address);

    if (!name) {
      return res.status(400).json({ ok: false, message: "name is required" });
    }

    const { rows } = await db.query(
      `
      INSERT INTO travel_agents (name, contact, address)
      VALUES ($1, $2, $3)
      RETURNING id, name, contact, address, created_at, updated_at
      `,
      [name, contact, address]
    );

    return res.json({
      ok: true,
      row: rows[0],
    });
  } catch (e) {
    console.error("createAgent error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function updateAgent(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);
    const name = toStr(req.body?.name);
    const contact = toStr(req.body?.contact);
    const address = toStr(req.body?.address);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    if (!name) {
      return res.status(400).json({ ok: false, message: "name is required" });
    }

    const { rows } = await db.query(
      `
      UPDATE travel_agents
      SET
        name = $1,
        contact = $2,
        address = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING id, name, contact, address, created_at, updated_at
      `,
      [name, contact, address, id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    return res.json({
      ok: true,
      row: rows[0],
    });
  } catch (e) {
    console.error("updateAgent error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deleteAgent(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    const usedSalesQ = await db.query(
      `SELECT 1 FROM travel_daily_sales WHERE agent_id = $1 LIMIT 1`,
      [id]
    );

    if (usedSalesQ.rows.length) {
      return res.status(409).json({
        ok: false,
        message: "Agent already used in sales",
      });
    }

    const usedPaymentsQ = await db.query(
      `SELECT 1 FROM travel_agent_payments WHERE agent_id = $1 LIMIT 1`,
      [id]
    );

    if (usedPaymentsQ.rows.length) {
      return res.status(409).json({
        ok: false,
        message: "Agent already used in payments",
      });
    }

    const { rowCount } = await db.query(
      `DELETE FROM travel_agents WHERE id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteAgent error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

/**
 * ДНЕВНЫЕ ПРОДАЖИ
 */

async function getDailySales(req, res) {
  try {
    await ensureTables();

    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const serviceType = normalizeServiceType(req.query.service_type);

    const { rows } = await db.query(
      `
      SELECT
        s.id,
        s.sale_date,
        s.agent_id,
        a.name AS agent_name,
        s.service_type,
        s.direction,
        s.traveller_name,
        s.sale_amount,
        s.net_amount,
        s.payment,
        s.payment_date,
        s.comment,
        s.created_at,
        s.updated_at
      FROM travel_daily_sales s
      JOIN travel_agents a ON a.id = s.agent_id
      WHERE ($1::bigint IS NULL OR s.agent_id = $1)
        AND ($2::date IS NULL OR s.sale_date >= $2::date)
        AND ($3::date IS NULL OR s.sale_date <= $3::date)
        AND ($4::text = '' OR s.service_type = $4)
      ORDER BY s.sale_date DESC, s.id DESC
      LIMIT $5 OFFSET $6
      `,
      [
        Number.isFinite(agentId) ? agentId : null,
        dateFrom,
        dateTo,
        serviceType,
        limit,
        offset,
      ]
    );

    return res.json({
      ok: true,
      rows: normalizeSaleRows(rows),
      limit,
      offset,
    });
  } catch (e) {
    console.error("getDailySales error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function createDailySale(req, res) {
  try {
    await ensureTables();

    const saleDate = validateDate(req.body?.sale_date) || null;
    const agentId = Number(req.body?.agent_id);
    const serviceType = normalizeServiceType(req.body?.service_type);
    const direction = toStr(req.body?.direction);
    const travellerName = toStr(req.body?.traveller_name);
    const saleAmount = toNum(req.body?.sale_amount);
    const netAmount = toNum(req.body?.net_amount);

    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(400).json({ ok: false, message: "agent_id is required" });
    }

    if (!serviceType) {
      return res.status(400).json({ ok: false, message: "service_type is required" });
    }

    if (!direction) {
      return res.status(400).json({ ok: false, message: "direction is required" });
    }

    if (!Number.isFinite(saleAmount) || saleAmount < 0) {
      return res.status(400).json({ ok: false, message: "Bad sale_amount" });
    }

    if (!Number.isFinite(netAmount) || netAmount < 0) {
      return res.status(400).json({ ok: false, message: "Bad net_amount" });
    }

    const agentQ = await db.query(
      `SELECT id, name FROM travel_agents WHERE id = $1 LIMIT 1`,
      [agentId]
    );

    if (!agentQ.rows.length) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    const { rows } = await db.query(
      `
      INSERT INTO travel_daily_sales (
        sale_date,
        agent_id,
        service_type,
        direction,
        traveller_name,
        sale_amount,
        net_amount,
        payment,
        payment_date,
        comment
      )
      VALUES (
        COALESCE($1::date, CURRENT_DATE),
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        0,
        CURRENT_DATE,
        ''
      )
      RETURNING
        id,
        sale_date,
        agent_id,
        service_type,
        direction,
        traveller_name,
        sale_amount,
        net_amount,
        payment,
        payment_date,
        comment,
        created_at,
        updated_at
      `,
      [saleDate, agentId, serviceType, direction, travellerName, saleAmount, netAmount]
    );

    return res.json({
      ok: true,
      row: normalizeSaleRow(rows[0]),
    });
  } catch (e) {
    console.error("createDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function updateDailySale(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);
    const saleDate = validateDate(req.body?.sale_date);
    const agentId = Number(req.body?.agent_id);
    const serviceType = normalizeServiceType(req.body?.service_type);
    const direction = toStr(req.body?.direction);
    const travellerName = toStr(req.body?.traveller_name);
    const saleAmount = toNum(req.body?.sale_amount);
    const netAmount = toNum(req.body?.net_amount);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(400).json({ ok: false, message: "agent_id is required" });
    }

    if (!saleDate) {
      return res.status(400).json({ ok: false, message: "sale_date is required" });
    }

    if (!serviceType) {
      return res.status(400).json({ ok: false, message: "service_type is required" });
    }

    if (!direction) {
      return res.status(400).json({ ok: false, message: "direction is required" });
    }

    if (!Number.isFinite(saleAmount) || saleAmount < 0) {
      return res.status(400).json({ ok: false, message: "Bad sale_amount" });
    }

    if (!Number.isFinite(netAmount) || netAmount < 0) {
      return res.status(400).json({ ok: false, message: "Bad net_amount" });
    }

    const agentQ = await db.query(
      `SELECT id FROM travel_agents WHERE id = $1 LIMIT 1`,
      [agentId]
    );

    if (!agentQ.rows.length) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    const { rows } = await db.query(
      `
      UPDATE travel_daily_sales
      SET
        sale_date = $1::date,
        agent_id = $2,
        service_type = $3,
        direction = $4,
        traveller_name = $5,
        sale_amount = $6,
        net_amount = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING
        id,
        sale_date,
        agent_id,
        service_type,
        direction,
        traveller_name,
        sale_amount,
        net_amount,
        payment,
        payment_date,
        comment,
        created_at,
        updated_at
      `,
      [saleDate, agentId, serviceType, direction, travellerName, saleAmount, netAmount, id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Sale not found" });
    }

    return res.json({
      ok: true,
      row: normalizeSaleRow(rows[0]),
    });
  } catch (e) {
    console.error("updateDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deleteDailySale(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    const { rowCount } = await db.query(
      `DELETE FROM travel_daily_sales WHERE id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ ok: false, message: "Sale not found" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

/**
 * ОТДЕЛЬНЫЕ ОПЛАТЫ АГЕНТА
 */

async function getPayments(req, res) {
  try {
    await ensureTables();

    const limit = clampInt(req.query.limit, 500, 1, 5000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);

    const { rows } = await db.query(
      `
    SELECT
      p.id,
      p.payment_date,
      p.agent_id,
      a.name AS agent_name,
      p.amount,
      p.comment,
      COALESCE(NULLIF(p.entry_type, ''), 'payment') AS entry_type,
      p.created_at,
      p.updated_at
      FROM travel_agent_payments p
      JOIN travel_agents a ON a.id = p.agent_id
      WHERE ($1::bigint IS NULL OR p.agent_id = $1)
        AND ($2::date IS NULL OR p.payment_date >= $2::date)
        AND ($3::date IS NULL OR p.payment_date <= $3::date)
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT $4 OFFSET $5
      `,
      [
        Number.isFinite(agentId) ? agentId : null,
        dateFrom,
        dateTo,
        limit,
        offset,
      ]
    );

    return res.json({
      ok: true,
      rows: normalizePaymentRows(rows),
      limit,
      offset,
    });
  } catch (e) {
    console.error("getPayments error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function createPayment(req, res) {
  try {
    await ensureTables();

    const paymentDate = validateDate(req.body?.payment_date) || todayIso();
    const agentId = Number(req.body?.agent_id);
    const amount = toNum(req.body?.amount);
    const comment = toStr(req.body?.comment);
    const entryType = req.body?.entry_type === "refund" ? "refund" : "payment";

    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(400).json({ ok: false, message: "agent_id is required" });
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ ok: false, message: "Bad amount" });
    }

    const agentQ = await db.query(
      `SELECT id FROM travel_agents WHERE id = $1 LIMIT 1`,
      [agentId]
    );

    if (!agentQ.rows.length) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    const { rows } = await db.query(
      `
    INSERT INTO travel_agent_payments (
      payment_date,
      agent_id,
      amount,
      comment,
      entry_type
    )
    VALUES ($1::date, $2, $3, $4, $5)
    RETURNING
      id,
      payment_date,
      agent_id,
      amount,
      comment,
      entry_type,
      created_at,
      updated_at
      `,
      [paymentDate, agentId, amount, comment, entryType]
    );

    return res.json({
      ok: true,
      row: normalizePaymentRow(rows[0]),
    });
  } catch (e) {
    console.error("createPayment error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function updatePayment(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);
    const paymentDate = validateDate(req.body?.payment_date);
    const agentId = Number(req.body?.agent_id);
    const amount = toNum(req.body?.amount);
    const comment = toStr(req.body?.comment);
    const entryType = req.body?.entry_type === "refund" ? "refund" : "payment";

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    if (!paymentDate) {
      return res.status(400).json({ ok: false, message: "payment_date is required" });
    }

    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(400).json({ ok: false, message: "agent_id is required" });
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ ok: false, message: "Bad amount" });
    }

    const agentQ = await db.query(
      `SELECT id FROM travel_agents WHERE id = $1 LIMIT 1`,
      [agentId]
    );

    if (!agentQ.rows.length) {
      return res.status(404).json({ ok: false, message: "Agent not found" });
    }

    const { rows } = await db.query(
      `
    UPDATE travel_agent_payments
    SET
      payment_date = $1::date,
      agent_id = $2,
      amount = $3,
      comment = $4,
      entry_type = $5,
      updated_at = NOW()
    WHERE id = $6
    RETURNING
      id,
      payment_date,
      agent_id,
      amount,
      comment,
      entry_type,
      created_at,
      updated_at
      `,
      [paymentDate, agentId, amount, comment, entryType, id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Payment not found" });
    }

    return res.json({
      ok: true,
      row: normalizePaymentRow(rows[0]),
    });
  } catch (e) {
    console.error("updatePayment error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deletePayment(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    const { rowCount } = await db.query(
      `DELETE FROM travel_agent_payments WHERE id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ ok: false, message: "Payment not found" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("deletePayment error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

/**
 * ОТЧЁТЫ
 */

async function getSalesReport(req, res) {
  try {
    await ensureTables();

    const limit = clampInt(req.query.limit, 500, 1, 5000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const serviceType = normalizeServiceType(req.query.service_type);

    const { rows } = await db.query(
      `
      SELECT
        s.id,
        s.sale_date,
        a.name AS agent,
        s.service_type,
        s.direction,
        s.traveller_name,
        s.sale_amount,
        s.net_amount,
        (s.sale_amount - s.net_amount) AS margin
      FROM travel_daily_sales s
      JOIN travel_agents a ON a.id = s.agent_id
      WHERE ($1::bigint IS NULL OR s.agent_id = $1)
        AND ($2::date IS NULL OR s.sale_date >= $2::date)
        AND ($3::date IS NULL OR s.sale_date <= $3::date)
        AND ($4::text = '' OR s.service_type = $4)
      ORDER BY s.sale_date DESC, s.id DESC
      LIMIT $5 OFFSET $6
      `,
      [
        Number.isFinite(agentId) ? agentId : null,
        dateFrom,
        dateTo,
        serviceType,
        limit,
        offset,
      ]
    );

    return res.json({
      ok: true,
      rows: normalizeSaleRows(rows),
      limit,
      offset,
    });
  } catch (e) {
    console.error("getSalesReport error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getAgentBalanceReport(req, res) {
  try {
    await ensureTables();

    const limit = clampInt(req.query.limit, 1000, 1, 10000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const serviceType = normalizeServiceType(req.query.service_type);

    const { rows } = await db.query(
      `
      WITH ledger_source AS (
        SELECT
          s.id::text AS row_key,
          s.agent_id,
          a.name AS agent,
          s.sale_date AS txn_date,
          'sale'::text AS entry_type,
          s.id AS sale_id,
          NULL::bigint AS payment_id,
          s.sale_date,
          NULL::date AS payment_date,
          s.service_type,
          s.direction,
          s.traveller_name,
          s.sale_amount,
          0::numeric(14,2) AS payment_amount,
          0::numeric(14,2) AS refund_amount,
          NULL::text AS comment,
          s.sale_amount::numeric(14,2) AS delta_amount
        FROM travel_daily_sales s
        JOIN travel_agents a ON a.id = s.agent_id
        WHERE ($1::bigint IS NULL OR s.agent_id = $1)
          AND ($2::date IS NULL OR s.sale_date >= $2::date)
          AND ($3::date IS NULL OR s.sale_date <= $3::date)
          AND ($4::text = '' OR s.service_type = $4)
    
        UNION ALL
    
        SELECT
          ('legacy-' || s.id::text) AS row_key,
          s.agent_id,
          a.name AS agent,
          s.payment_date AS txn_date,
          'payment_legacy'::text AS entry_type,
          s.id AS sale_id,
          NULL::bigint AS payment_id,
          NULL::date AS sale_date,
          s.payment_date,
          s.service_type,
          s.direction,
          s.traveller_name,
          0::numeric(14,2) AS sale_amount,
          s.payment::numeric(14,2) AS payment_amount,
          0::numeric(14,2) AS refund_amount,
          s.comment,
          (0 - s.payment)::numeric(14,2) AS delta_amount
        FROM travel_daily_sales s
        JOIN travel_agents a ON a.id = s.agent_id
        WHERE COALESCE(s.payment, 0) > 0
          AND ($1::bigint IS NULL OR s.agent_id = $1)
          AND ($2::date IS NULL OR s.payment_date >= $2::date)
          AND ($3::date IS NULL OR s.payment_date <= $3::date)
          AND ($4::text = '' OR s.service_type = $4)
    
        UNION ALL
    
        SELECT
          ('payment-' || p.id::text) AS row_key,
          p.agent_id,
          a.name AS agent,
          p.payment_date AS txn_date,
          COALESCE(NULLIF(p.entry_type, ''), 'payment')::text AS entry_type,
          NULL::bigint AS sale_id,
          p.id AS payment_id,
          NULL::date AS sale_date,
          p.payment_date,
          ''::text AS service_type,
          ''::text AS direction,
          ''::text AS traveller_name,
          0::numeric(14,2) AS sale_amount,
          CASE
            WHEN COALESCE(NULLIF(p.entry_type, ''), 'payment') = 'refund'
              THEN 0::numeric(14,2)
            ELSE p.amount::numeric(14,2)
          END AS payment_amount,
          CASE
            WHEN COALESCE(NULLIF(p.entry_type, ''), 'payment') = 'refund'
              THEN p.amount::numeric(14,2)
            ELSE 0::numeric(14,2)
          END AS refund_amount,
          p.comment,
          (0 - p.amount)::numeric(14,2) AS delta_amount
        FROM travel_agent_payments p
        JOIN travel_agents a ON a.id = p.agent_id
        WHERE ($1::bigint IS NULL OR p.agent_id = $1)
          AND ($2::date IS NULL OR p.payment_date >= $2::date)
          AND ($3::date IS NULL OR p.payment_date <= $3::date)
      ),
      ledger_with_balance AS (
        SELECT
          row_key,
          agent_id,
          agent,
          txn_date,
          entry_type,
          sale_id,
          payment_id,
          sale_date,
          payment_date,
          service_type,
          direction,
          traveller_name,
          sale_amount,
          payment_amount,
          refund_amount,
          comment,
          delta_amount,
          SUM(delta_amount) OVER (
            PARTITION BY agent_id
            ORDER BY txn_date ASC, row_key ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance
        FROM ledger_source
      )
      SELECT
        row_key,
        agent_id,
        agent,
        txn_date,
        entry_type,
        sale_id,
        payment_id,
        sale_date,
        payment_date,
        service_type,
        direction,
        traveller_name,
        sale_amount,
        payment_amount,
        refund_amount,
        comment,
        delta_amount,
        balance
      FROM ledger_with_balance
      ORDER BY txn_date DESC, row_key DESC
      LIMIT $5 OFFSET $6
      `,
      [
        Number.isFinite(agentId) ? agentId : null,
        dateFrom,
        dateTo,
        serviceType,
        limit,
        offset,
      ]
    );

    return res.json({
      ok: true,
      rows: normalizeLedgerRows(rows),
      limit,
      offset,
    });
  } catch (e) {
    console.error("getAgentBalanceReport error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

module.exports = {
  getAgents,
  createAgent,
  updateAgent,
  deleteAgent,

  getDailySales,
  createDailySale,
  updateDailySale,
  deleteDailySale,

  getPayments,
  createPayment,
  updatePayment,
  deletePayment,

  getSalesReport,
  getAgentBalanceReport,
};
