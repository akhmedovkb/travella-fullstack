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
  return new Date().toISOString().slice(0, 10);
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

    const usedQ = await db.query(
      `SELECT 1 FROM travel_daily_sales WHERE agent_id = $1 LIMIT 1`,
      [id]
    );

    if (usedQ.rows.length) {
      return res.status(409).json({
        ok: false,
        message: "Agent already used in sales",
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
      rows,
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
      row: rows[0],
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
      row: rows[0],
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

async function updatePayment(req, res) {
  try {
    await ensureTables();

    const id = Number(req.params?.id);
    const payment = toNum(req.body?.payment);
    const paymentDate = validateDate(req.body?.payment_date) || todayIso();
    const comment = toStr(req.body?.comment);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Bad id" });
    }

    if (!Number.isFinite(payment) || payment < 0) {
      return res.status(400).json({ ok: false, message: "Bad payment" });
    }

    const { rows } = await db.query(
      `
      UPDATE travel_daily_sales
      SET
        payment = $1,
        payment_date = $2::date,
        comment = $3,
        updated_at = NOW()
      WHERE id = $4
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
      [payment, paymentDate, comment, id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Sale not found" });
    }

    return res.json({
      ok: true,
      row: rows[0],
    });
  } catch (e) {
    console.error("updatePayment error:", e);
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
      rows,
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
      WITH base AS (
        SELECT
          s.id,
          s.sale_date,
          s.agent_id,
          a.name AS agent,
          s.service_type,
          s.direction,
          s.traveller_name,
          s.sale_amount,
          s.net_amount,
          s.payment,
          s.payment_date,
          s.comment,
          SUM(COALESCE(s.sale_amount, 0) - COALESCE(s.payment, 0))
            OVER (
              PARTITION BY s.agent_id
              ORDER BY s.sale_date ASC, s.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS balance
        FROM travel_daily_sales s
        JOIN travel_agents a ON a.id = s.agent_id
        WHERE ($1::bigint IS NULL OR s.agent_id = $1)
          AND ($2::date IS NULL OR s.sale_date >= $2::date)
          AND ($3::date IS NULL OR s.sale_date <= $3::date)
          AND ($4::text = '' OR s.service_type = $4)
      )
      SELECT
        id,
        sale_date,
        agent_id,
        agent,
        service_type,
        direction,
        traveller_name,
        sale_amount,
        net_amount,
        payment,
        payment_date,
        comment,
        balance
      FROM base
      ORDER BY sale_date DESC, id DESC
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
      rows,
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
  updatePayment,

  getSalesReport,
  getAgentBalanceReport,
};
