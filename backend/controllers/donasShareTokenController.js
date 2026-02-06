// backend/controllers/donasShareTokenController.js

const crypto = require("crypto");
const db = require("../db");

const SLUG = "donas-dosas";

function isIsoMonthDate(s) {
  // expecting YYYY-MM-01
  return /^\d{4}-\d{2}-01$/.test(String(s || "").trim());
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function monthToYm(m) {
  return String(m || "").slice(0, 7);
}

async function ensureTables() {
  // share tokens table
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_share_tokens (
      id BIGSERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL,
      from_month DATE NOT NULL,
      to_month DATE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by BIGINT,
      created_by_email TEXT,
      created_by_name TEXT
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_share_tokens_slug_expires
    ON donas_share_tokens (slug, expires_at);
  `);

  // settings table (read-only here, but ensure for public)
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'UZS',
      cash_start NUMERIC NOT NULL DEFAULT 0,
      fixed_opex_month NUMERIC NOT NULL DEFAULT 0,
      variable_opex_month NUMERIC NOT NULL DEFAULT 0,
      loan_payment_month NUMERIC NOT NULL DEFAULT 0,
      reserve_target_months NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // months table (read-only here, but ensure for public)
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      month DATE NOT NULL,
      revenue NUMERIC NOT NULL DEFAULT 0,
      cogs NUMERIC NOT NULL DEFAULT 0,
      opex NUMERIC NOT NULL DEFAULT 0,
      capex NUMERIC NOT NULL DEFAULT 0,
      loan_paid NUMERIC NOT NULL DEFAULT 0,
      cash_end NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_slug_month
    ON donas_finance_months (slug, month);
  `);
}

function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || null,
  };
}

function genToken() {
  // url-safe token
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * POST /api/admin/donas/share-token
 * body: { slug, from:'YYYY-MM-01', to:'YYYY-MM-01', ttl_hours }
 */
exports.createShareToken = async (req, res) => {
  try {
    await ensureTables();

    const b = req.body || {};
    const slug = String(b.slug || "").trim() || SLUG;
    const from = String(b.from || "").trim();
    const to = String(b.to || "").trim();
    const ttl = Math.max(1, Math.floor(toNum(b.ttl_hours || 168))); // default 7d

    if (slug !== SLUG) return res.status(400).json({ error: "Bad slug" });
    if (!isIsoMonthDate(from) || !isIsoMonthDate(to)) {
      return res.status(400).json({ error: "Bad range. Expect from/to as YYYY-MM-01" });
    }

    // normalize order
    let fromMonth = from;
    let toMonth = to;
    if (String(fromMonth).localeCompare(String(toMonth)) > 0) {
      const tmp = fromMonth;
      fromMonth = toMonth;
      toMonth = tmp;
    }

    const actor = getActor(req);
    const token = genToken();

    const { rows } = await db.query(
      `
      INSERT INTO donas_share_tokens
        (token, slug, from_month, to_month, expires_at, created_by, created_by_email, created_by_name)
      VALUES
        ($1,$2,($3)::date,($4)::date, NOW() + ($5 || ' hours')::interval, $6, $7, $8)
      RETURNING token, slug, from_month, to_month, expires_at, created_at
      `,
      [token, slug, fromMonth, toMonth, String(ttl), actor.id, actor.email, actor.name]
    );

    return res.json({
      ok: true,
      token: rows?.[0]?.token || token,
      meta: rows?.[0] || null,
    });
  } catch (e) {
    console.error("createShareToken error:", e);
    return res.status(500).json({ error: "Failed to create share token" });
  }
};

/**
 * GET /api/public/donas/summary-range-token?t=TOKEN
 * returns: { ok, meta, settings, months }
 */
exports.getPublicSummaryByToken = async (req, res) => {
  try {
    await ensureTables();

    const t = String(req.query.t || "").trim();
    if (!t) return res.status(400).json({ error: "token required" });

    const tokQ = await db.query(
      `
      SELECT token, slug, from_month, to_month, expires_at, created_at
      FROM donas_share_tokens
      WHERE token=$1
      LIMIT 1
      `,
      [t]
    );

    const tok = tokQ.rows?.[0];
    if (!tok) return res.status(404).json({ error: "token not found" });

    // expiry check
    const now = new Date();
    const exp = new Date(tok.expires_at);
    if (Number.isFinite(exp.getTime()) && exp.getTime() < now.getTime()) {
      return res.status(410).json({ error: "token expired" });
    }

    if (tok.slug !== SLUG) return res.status(400).json({ error: "Bad slug" });

    // settings (ensure exists)
    const sQ = await db.query(`SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`, [SLUG]);
    const settings =
      sQ.rows?.[0] || {
        slug: SLUG,
        currency: "UZS",
        cash_start: 0,
        fixed_opex_month: 0,
        variable_opex_month: 0,
        loan_payment_month: 0,
        reserve_target_months: 0,
      };

    // months within range: take latest row per month (by id)
    const mQ = await db.query(
      `
      SELECT *
      FROM donas_finance_months
      WHERE slug=$1
        AND month >= ($2)::date
        AND month <= ($3)::date
      ORDER BY month ASC, id ASC
      `,
      [SLUG, tok.from_month, tok.to_month]
    );

    const byMonth = new Map();
    for (const r of mQ.rows || []) {
      const ym = monthToYm(r.month);
      const prev = byMonth.get(ym);
      if (!prev || Number(r.id) > Number(prev.id)) byMonth.set(ym, r);
    }

    const months = Array.from(byMonth.values()).sort((a, b) =>
      String(a.month).localeCompare(String(b.month))
    );

    return res.json({
      ok: true,
      meta: {
        slug: SLUG,
        from: monthToYm(tok.from_month),
        to: monthToYm(tok.to_month),
        expires_at: tok.expires_at,
      },
      settings,
      months,
    });
  } catch (e) {
    console.error("getPublicSummaryByToken error:", e);
    return res.status(500).json({ error: "Failed to load public summary" });
  }
};
