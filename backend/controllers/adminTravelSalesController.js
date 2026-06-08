// backend/controllers/adminTravelSalesController.js

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

function normalizeDateRow(row, keys = []) {
  if (!row) return row;
  const out = { ...row };
  keys.forEach((key) => {
    out[key] = formatDateOnly(out[key]);
  });
  return out;
}

function normalizeRows(rows, keys = []) {
  return Array.isArray(rows) ? rows.map((row) => normalizeDateRow(row, keys)) : [];
}

function normalizeServiceType(v) {
  const s = toStr(v).toLowerCase();
  if (["airticket", "railticket", "visa", "tourpackage"].includes(s)) return s;
  return "";
}

function normalizeAgentKind(v) {
  const s = toStr(v).toLowerCase();
  if (["agent", "supplier", "both"].includes(s)) return s;
  return "agent";
}

function nullablePositiveId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function calculateSaleFinance({ fare_amount, taxes_amount, commission_percent, sale_amount, vat_percent, net_amount }) {
  const fare = Math.max(0, toNum(fare_amount));
  const taxes = Math.max(0, toNum(taxes_amount));
  const commissionPercent = Math.max(0, toNum(commission_percent));
  const sale = Math.max(0, toNum(sale_amount));
  const vatPercent = Math.max(0, toNum(vat_percent));

  const commissionAmount = roundMoney((fare * commissionPercent) / 100);
  const calculatedNet = roundMoney(fare + taxes - commissionAmount);
  const fallbackNet = Math.max(0, toNum(net_amount));
  const net = calculatedNet > 0 || fare > 0 || taxes > 0 || commissionPercent > 0 ? calculatedNet : fallbackNet;

  const baseWithoutVat = vatPercent > 0 ? roundMoney(sale / (1 + vatPercent / 100)) : sale;
  const markup = roundMoney(Math.max(0, baseWithoutVat - net));
  const vatAmount = roundMoney(Math.max(0, sale - net - markup));

  return {
    fareAmount: roundMoney(fare),
    taxesAmount: roundMoney(taxes),
    commissionPercent: roundMoney(commissionPercent),
    commissionAmount,
    netAmount: roundMoney(net),
    vatPercent: roundMoney(vatPercent),
    vatAmount,
    markupAmount: markup,
    saleAmount: roundMoney(sale),
  };
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

  await db.query(`ALTER TABLE travel_agents ADD COLUMN IF NOT EXISTS agent_kind TEXT NOT NULL DEFAULT 'agent';`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_agents_agent_kind ON travel_agents(agent_kind);`);

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

  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS traveller_name TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS payment_date DATE NOT NULL DEFAULT CURRENT_DATE;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS supplier_agent_id BIGINT REFERENCES travel_agents(id) ON DELETE RESTRICT;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS fare_amount NUMERIC(14,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS taxes_amount NUMERIC(14,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS vat_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE travel_daily_sales ADD COLUMN IF NOT EXISTS markup_amount NUMERIC(14,2) NOT NULL DEFAULT 0;`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_agent_id ON travel_daily_sales(agent_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_supplier_agent_id ON travel_daily_sales(supplier_agent_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_sale_date ON travel_daily_sales(sale_date);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_daily_sales_service_type ON travel_daily_sales(service_type);`);

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
  await db.query(`ALTER TABLE travel_agent_payments ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'payment';`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_agent_payments_agent_id ON travel_agent_payments(agent_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_travel_agent_payments_payment_date ON travel_agent_payments(payment_date);`);
}

async function getAgents(req, res) {
  try {
    await ensureTables();
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const q = toStr(req.query.q);
    const kind = ["agent", "supplier", "both"].includes(toStr(req.query.kind).toLowerCase()) ? toStr(req.query.kind).toLowerCase() : "";

    const { rows } = await db.query(
      `
      SELECT id, name, contact, address, COALESCE(NULLIF(agent_kind, ''), 'agent') AS agent_kind, created_at, updated_at
      FROM travel_agents
      WHERE (
        $1::text IS NULL
        OR name ILIKE $1
        OR contact ILIKE $1
        OR address ILIKE $1
        OR CAST(id AS text) ILIKE $1
      )
        AND (
          $4::text = ''
          OR ($4::text = 'agent' AND COALESCE(NULLIF(agent_kind, ''), 'agent') IN ('agent', 'both'))
          OR ($4::text = 'supplier' AND COALESCE(NULLIF(agent_kind, ''), 'agent') IN ('supplier', 'both'))
          OR ($4::text = 'both' AND COALESCE(NULLIF(agent_kind, ''), 'agent') = 'both')
        )
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
      `,
      [q ? `%${q}%` : null, limit, offset, kind]
    );

    return res.json({ ok: true, rows, limit, offset });
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
    const agentKind = normalizeAgentKind(req.body?.agent_kind);
    if (!name) return res.status(400).json({ ok: false, message: "name is required" });

    const { rows } = await db.query(
      `
      INSERT INTO travel_agents (name, contact, address, agent_kind)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, contact, address, COALESCE(NULLIF(agent_kind, ''), 'agent') AS agent_kind, created_at, updated_at
      `,
      [name, contact, address, agentKind]
    );
    return res.json({ ok: true, row: rows[0] });
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
    const agentKind = normalizeAgentKind(req.body?.agent_kind);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    if (!name) return res.status(400).json({ ok: false, message: "name is required" });

    const { rows } = await db.query(
      `
      UPDATE travel_agents
      SET name = $1, contact = $2, address = $3, agent_kind = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, contact, address, COALESCE(NULLIF(agent_kind, ''), 'agent') AS agent_kind, created_at, updated_at
      `,
      [name, contact, address, agentKind, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: "Agent not found" });
    return res.json({ ok: true, row: rows[0] });
  } catch (e) {
    console.error("updateAgent error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deleteAgent(req, res) {
  try {
    await ensureTables();
    const id = Number(req.params?.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    const usedSalesQ = await db.query(`SELECT 1 FROM travel_daily_sales WHERE agent_id = $1 OR supplier_agent_id = $1 LIMIT 1`, [id]);
    if (usedSalesQ.rows.length) return res.status(409).json({ ok: false, message: "Agent already used in sales" });
    const usedPaymentsQ = await db.query(`SELECT 1 FROM travel_agent_payments WHERE agent_id = $1 LIMIT 1`, [id]);
    if (usedPaymentsQ.rows.length) return res.status(409).json({ ok: false, message: "Agent already used in payments" });
    const { rowCount } = await db.query(`DELETE FROM travel_agents WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, message: "Agent not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteAgent error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function validateAgentExists(id, role = "agent") {
  const q = await db.query(
    `
    SELECT id, name, COALESCE(NULLIF(agent_kind, ''), 'agent') AS agent_kind
    FROM travel_agents
    WHERE id = $1
      AND (
        $2::text = ''
        OR ($2::text = 'agent' AND COALESCE(NULLIF(agent_kind, ''), 'agent') IN ('agent', 'both'))
        OR ($2::text = 'supplier' AND COALESCE(NULLIF(agent_kind, ''), 'agent') IN ('supplier', 'both'))
      )
    LIMIT 1
    `,
    [id, role]
  );
  return q.rows[0] || null;
}

function saleReturnFields() {
  return `
    id,
    sale_date,
    agent_id,
    supplier_agent_id,
    service_type,
    direction,
    traveller_name,
    fare_amount,
    taxes_amount,
    commission_percent,
    commission_amount,
    sale_amount,
    net_amount,
    vat_percent,
    vat_amount,
    markup_amount,
    payment,
    payment_date,
    comment,
    created_at,
    updated_at
  `;
}

async function getDailySales(req, res) {
  try {
    await ensureTables();
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const supplierAgentId = req.query.supplier_agent_id ? Number(req.query.supplier_agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const serviceType = normalizeServiceType(req.query.service_type);

    const { rows } = await db.query(
      `
      SELECT
        s.id, s.sale_date, s.agent_id, a.name AS agent_name,
        s.supplier_agent_id, sup.name AS supplier_agent_name,
        s.service_type, s.direction, s.traveller_name,
        s.fare_amount, s.taxes_amount, s.commission_percent, s.commission_amount,
        s.sale_amount, s.net_amount, s.vat_percent, s.vat_amount, s.markup_amount,
        s.payment, s.payment_date, s.comment, s.created_at, s.updated_at
      FROM travel_daily_sales s
      JOIN travel_agents a ON a.id = s.agent_id
      LEFT JOIN travel_agents sup ON sup.id = s.supplier_agent_id
      WHERE ($1::bigint IS NULL OR s.agent_id = $1)
        AND ($2::date IS NULL OR s.sale_date >= $2::date)
        AND ($3::date IS NULL OR s.sale_date <= $3::date)
        AND ($4::text = '' OR s.service_type = $4)
        AND ($7::bigint IS NULL OR s.supplier_agent_id = $7)
      ORDER BY s.sale_date DESC, s.id DESC
      LIMIT $5 OFFSET $6
      `,
      [Number.isFinite(agentId) ? agentId : null, dateFrom, dateTo, serviceType, limit, offset, Number.isFinite(supplierAgentId) ? supplierAgentId : null]
    );
    return res.json({ ok: true, rows: normalizeRows(rows, ["sale_date", "payment_date"]), limit, offset });
  } catch (e) {
    console.error("getDailySales error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

function buildSalePayload(body) {
  const saleDate = validateDate(body?.sale_date) || null;
  const agentId = Number(body?.agent_id);
  const supplierAgentId = nullablePositiveId(body?.supplier_agent_id);
  const serviceType = normalizeServiceType(body?.service_type);
  const direction = toStr(body?.direction);
  const travellerName = toStr(body?.traveller_name);
  const finance = calculateSaleFinance(body || {});
  return { saleDate, agentId, supplierAgentId, serviceType, direction, travellerName, finance };
}

function validateSalePayload(payload, requireDate = false) {
  if (requireDate && !payload.saleDate) return "sale_date is required";
  if (!Number.isFinite(payload.agentId) || payload.agentId <= 0) return "agent_id is required";
  if (!payload.supplierAgentId) return "supplier_agent_id is required";
  if (!payload.serviceType) return "service_type is required";
  if (!payload.direction) return "direction is required";
  if (!Number.isFinite(payload.finance.saleAmount) || payload.finance.saleAmount < 0) return "Bad sale_amount";
  if (!Number.isFinite(payload.finance.netAmount) || payload.finance.netAmount < 0) return "Bad net_amount";
  return "";
}

async function createDailySale(req, res) {
  try {
    await ensureTables();
    const payload = buildSalePayload(req.body);
    const err = validateSalePayload(payload, false);
    if (err) return res.status(400).json({ ok: false, message: err });
    if (!(await validateAgentExists(payload.agentId, "agent"))) return res.status(404).json({ ok: false, message: "Agent not found" });
    if (!(await validateAgentExists(payload.supplierAgentId, "supplier"))) return res.status(404).json({ ok: false, message: "Supplier not found" });

    const f = payload.finance;
    const { rows } = await db.query(
      `
      INSERT INTO travel_daily_sales (
        sale_date, agent_id, supplier_agent_id, service_type, direction, traveller_name,
        fare_amount, taxes_amount, commission_percent, commission_amount,
        sale_amount, net_amount, vat_percent, vat_amount, markup_amount,
        payment, payment_date, comment
      )
      VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, CURRENT_DATE, '')
      RETURNING ${saleReturnFields()}
      `,
      [payload.saleDate, payload.agentId, payload.supplierAgentId, payload.serviceType, payload.direction, payload.travellerName, f.fareAmount, f.taxesAmount, f.commissionPercent, f.commissionAmount, f.saleAmount, f.netAmount, f.vatPercent, f.vatAmount, f.markupAmount]
    );
    return res.json({ ok: true, row: normalizeDateRow(rows[0], ["sale_date", "payment_date"]) });
  } catch (e) {
    console.error("createDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function updateDailySale(req, res) {
  try {
    await ensureTables();
    const id = Number(req.params?.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    const payload = buildSalePayload(req.body);
    const err = validateSalePayload(payload, true);
    if (err) return res.status(400).json({ ok: false, message: err });
    if (!(await validateAgentExists(payload.agentId, "agent"))) return res.status(404).json({ ok: false, message: "Agent not found" });
    if (!(await validateAgentExists(payload.supplierAgentId, "supplier"))) return res.status(404).json({ ok: false, message: "Supplier not found" });

    const f = payload.finance;
    const { rows } = await db.query(
      `
      UPDATE travel_daily_sales
      SET sale_date = $1::date,
          agent_id = $2,
          supplier_agent_id = $3,
          service_type = $4,
          direction = $5,
          traveller_name = $6,
          fare_amount = $7,
          taxes_amount = $8,
          commission_percent = $9,
          commission_amount = $10,
          sale_amount = $11,
          net_amount = $12,
          vat_percent = $13,
          vat_amount = $14,
          markup_amount = $15,
          updated_at = NOW()
      WHERE id = $16
      RETURNING ${saleReturnFields()}
      `,
      [payload.saleDate, payload.agentId, payload.supplierAgentId, payload.serviceType, payload.direction, payload.travellerName, f.fareAmount, f.taxesAmount, f.commissionPercent, f.commissionAmount, f.saleAmount, f.netAmount, f.vatPercent, f.vatAmount, f.markupAmount, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: "Sale not found" });
    return res.json({ ok: true, row: normalizeDateRow(rows[0], ["sale_date", "payment_date"]) });
  } catch (e) {
    console.error("updateDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deleteDailySale(req, res) {
  try {
    await ensureTables();
    const id = Number(req.params?.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    const { rowCount } = await db.query(`DELETE FROM travel_daily_sales WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, message: "Sale not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteDailySale error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getPayments(req, res) {
  try {
    await ensureTables();
    const limit = clampInt(req.query.limit, 500, 1, 5000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const entryType = req.query.entry_type === "refund" ? "refund" : req.query.entry_type === "payment" ? "payment" : "";
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const { rows } = await db.query(
      `
      SELECT p.id, p.payment_date, p.agent_id, a.name AS agent_name, p.amount, p.comment,
             COALESCE(NULLIF(p.entry_type, ''), 'payment') AS entry_type, p.created_at, p.updated_at
      FROM travel_agent_payments p
      JOIN travel_agents a ON a.id = p.agent_id
      WHERE ($1::bigint IS NULL OR p.agent_id = $1)
        AND ($2::text = '' OR COALESCE(NULLIF(p.entry_type, ''), 'payment') = $2)
        AND ($3::date IS NULL OR p.payment_date >= $3::date)
        AND ($4::date IS NULL OR p.payment_date <= $4::date)
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT $5 OFFSET $6
      `,
      [Number.isFinite(agentId) ? agentId : null, entryType, dateFrom, dateTo, limit, offset]
    );
    return res.json({ ok: true, rows: normalizeRows(rows, ["payment_date"]), limit, offset });
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
    if (!Number.isFinite(agentId) || agentId <= 0) return res.status(400).json({ ok: false, message: "agent_id is required" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, message: "Bad amount" });
    if (!(await validateAgentExists(agentId, ""))) return res.status(404).json({ ok: false, message: "Agent not found" });
    const { rows } = await db.query(
      `
      INSERT INTO travel_agent_payments (payment_date, agent_id, amount, comment, entry_type)
      VALUES ($1::date, $2, $3, $4, $5)
      RETURNING id, payment_date, agent_id, amount, comment, entry_type, created_at, updated_at
      `,
      [paymentDate, agentId, amount, comment, entryType]
    );
    return res.json({ ok: true, row: normalizeDateRow(rows[0], ["payment_date"]) });
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
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    if (!paymentDate) return res.status(400).json({ ok: false, message: "payment_date is required" });
    if (!Number.isFinite(agentId) || agentId <= 0) return res.status(400).json({ ok: false, message: "agent_id is required" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, message: "Bad amount" });
    if (!(await validateAgentExists(agentId, ""))) return res.status(404).json({ ok: false, message: "Agent not found" });
    const { rows } = await db.query(
      `
      UPDATE travel_agent_payments
      SET payment_date = $1::date, agent_id = $2, amount = $3, comment = $4, entry_type = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING id, payment_date, agent_id, amount, comment, entry_type, created_at, updated_at
      `,
      [paymentDate, agentId, amount, comment, entryType, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: "Payment not found" });
    return res.json({ ok: true, row: normalizeDateRow(rows[0], ["payment_date"]) });
  } catch (e) {
    console.error("updatePayment error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function deletePayment(req, res) {
  try {
    await ensureTables();
    const id = Number(req.params?.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Bad id" });
    const { rowCount } = await db.query(`DELETE FROM travel_agent_payments WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, message: "Payment not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("deletePayment error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getSalesReport(req, res) {
  try {
    await ensureTables();
    const limit = clampInt(req.query.limit, 500, 1, 5000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const supplierAgentId = req.query.supplier_agent_id ? Number(req.query.supplier_agent_id) : null;
    const dateFrom = validateDate(req.query.date_from);
    const dateTo = validateDate(req.query.date_to);
    const serviceType = normalizeServiceType(req.query.service_type);
    const { rows } = await db.query(
      `
      SELECT
        s.id, s.sale_date,
        a.name AS agent,
        s.supplier_agent_id,
        sup.name AS supplier_agent,
        s.service_type, s.direction, s.traveller_name,
        s.fare_amount, s.taxes_amount, s.commission_percent, s.commission_amount,
        s.sale_amount, s.net_amount, s.vat_percent, s.vat_amount, s.markup_amount,
        s.markup_amount AS margin
      FROM travel_daily_sales s
      JOIN travel_agents a ON a.id = s.agent_id
      LEFT JOIN travel_agents sup ON sup.id = s.supplier_agent_id
      WHERE ($1::bigint IS NULL OR s.agent_id = $1)
        AND ($2::date IS NULL OR s.sale_date >= $2::date)
        AND ($3::date IS NULL OR s.sale_date <= $3::date)
        AND ($4::text = '' OR s.service_type = $4)
        AND ($7::bigint IS NULL OR s.supplier_agent_id = $7)
      ORDER BY s.sale_date DESC, s.id DESC
      LIMIT $5 OFFSET $6
      `,
      [Number.isFinite(agentId) ? agentId : null, dateFrom, dateTo, serviceType, limit, offset, Number.isFinite(supplierAgentId) ? supplierAgentId : null]
    );
    return res.json({ ok: true, rows: normalizeRows(rows, ["sale_date"]), limit, offset });
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
          ('supply-' || s.id::text) AS row_key,
          s.supplier_agent_id AS agent_id,
          sup.name AS agent,
          s.sale_date AS txn_date,
          'supply'::text AS entry_type,
          s.id AS sale_id,
          NULL::bigint AS payment_id,
          s.sale_date,
          NULL::date AS payment_date,
          s.service_type,
          s.direction,
          s.traveller_name,
          s.sale_amount::numeric(14,2) AS sale_amount,
          s.net_amount::numeric(14,2) AS supply_amount,
          0::numeric(14,2) AS payment_amount,
          0::numeric(14,2) AS refund_amount,
          NULL::text AS comment,
          s.net_amount::numeric(14,2) AS delta_amount,
          s.fare_amount,
          s.taxes_amount,
          s.commission_percent,
          s.commission_amount,
          s.vat_percent,
          s.vat_amount,
          s.markup_amount
        FROM travel_daily_sales s
        JOIN travel_agents sup ON sup.id = s.supplier_agent_id
        WHERE s.supplier_agent_id IS NOT NULL
          AND ($1::bigint IS NULL OR s.supplier_agent_id = $1)
          AND ($2::date IS NULL OR s.sale_date >= $2::date)
          AND ($3::date IS NULL OR s.sale_date <= $3::date)
          AND ($4::text = '' OR s.service_type = $4)

        UNION ALL

        SELECT
          ('legacy-sale-' || s.id::text) AS row_key,
          s.agent_id,
          a.name AS agent,
          s.sale_date AS txn_date,
          'legacy_sale'::text AS entry_type,
          s.id AS sale_id,
          NULL::bigint AS payment_id,
          s.sale_date,
          NULL::date AS payment_date,
          s.service_type,
          s.direction,
          s.traveller_name,
          s.sale_amount::numeric(14,2) AS sale_amount,
          0::numeric(14,2) AS supply_amount,
          0::numeric(14,2) AS payment_amount,
          0::numeric(14,2) AS refund_amount,
          NULL::text AS comment,
          s.sale_amount::numeric(14,2) AS delta_amount,
          s.fare_amount,
          s.taxes_amount,
          s.commission_percent,
          s.commission_amount,
          s.vat_percent,
          s.vat_amount,
          s.markup_amount
        FROM travel_daily_sales s
        JOIN travel_agents a ON a.id = s.agent_id
        WHERE s.supplier_agent_id IS NULL
          AND ($1::bigint IS NULL OR s.agent_id = $1)
          AND ($2::date IS NULL OR s.sale_date >= $2::date)
          AND ($3::date IS NULL OR s.sale_date <= $3::date)
          AND ($4::text = '' OR s.service_type = $4)

        UNION ALL

        SELECT
          ('legacy-payment-' || s.id::text) AS row_key,
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
          0::numeric(14,2) AS supply_amount,
          s.payment::numeric(14,2) AS payment_amount,
          0::numeric(14,2) AS refund_amount,
          s.comment,
          (0 - s.payment)::numeric(14,2) AS delta_amount,
          s.fare_amount,
          s.taxes_amount,
          s.commission_percent,
          s.commission_amount,
          s.vat_percent,
          s.vat_amount,
          s.markup_amount
        FROM travel_daily_sales s
        JOIN travel_agents a ON a.id = s.agent_id
        WHERE s.supplier_agent_id IS NULL
          AND COALESCE(s.payment, 0) > 0
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
          0::numeric(14,2) AS supply_amount,
          CASE WHEN COALESCE(NULLIF(p.entry_type, ''), 'payment') = 'refund' THEN 0::numeric(14,2) ELSE p.amount::numeric(14,2) END AS payment_amount,
          CASE WHEN COALESCE(NULLIF(p.entry_type, ''), 'payment') = 'refund' THEN p.amount::numeric(14,2) ELSE 0::numeric(14,2) END AS refund_amount,
          p.comment,
          CASE WHEN COALESCE(NULLIF(p.entry_type, ''), 'payment') = 'refund' THEN p.amount::numeric(14,2) ELSE (0 - p.amount)::numeric(14,2) END AS delta_amount,
          0::numeric(14,2) AS fare_amount,
          0::numeric(14,2) AS taxes_amount,
          0::numeric(5,2) AS commission_percent,
          0::numeric(14,2) AS commission_amount,
          0::numeric(5,2) AS vat_percent,
          0::numeric(14,2) AS vat_amount,
          0::numeric(14,2) AS markup_amount
        FROM travel_agent_payments p
        JOIN travel_agents a ON a.id = p.agent_id
        WHERE ($1::bigint IS NULL OR p.agent_id = $1)
          AND ($2::date IS NULL OR p.payment_date >= $2::date)
          AND ($3::date IS NULL OR p.payment_date <= $3::date)
      ),
      ledger_with_balance AS (
        SELECT *,
          SUM(delta_amount) OVER (
            PARTITION BY agent_id
            ORDER BY txn_date ASC, row_key ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance
        FROM ledger_source
      )
      SELECT *
      FROM ledger_with_balance
      ORDER BY txn_date DESC, row_key DESC
      LIMIT $5 OFFSET $6
      `,
      [Number.isFinite(agentId) ? agentId : null, dateFrom, dateTo, serviceType, limit, offset]
    );

    return res.json({ ok: true, rows: normalizeRows(rows, ["txn_date", "sale_date", "payment_date"]), limit, offset });
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
