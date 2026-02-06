// backend/routes/donasShareRoutes.js

const express = require("express");
const crypto = require("crypto");
const db = require("../db");

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const SLUG_DEFAULT = "donas-dosas";

/**
 * =========
 * base64url
 * =========
 */
function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecodeToString(s) {
  const str = String(s || "");
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

function getShareSecret() {
  // Можно задать в env. Если нет — будет dev fallback.
  return process.env.DONAS_PUBLIC_TOKEN_SECRET || process.env.DONAS_PUBLIC_KEY || "donas-dev-secret";
}

function signShareToken(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const body = b64urlEncode(json);
  const sig = b64urlEncode(crypto.createHmac("sha256", getShareSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function verifyShareToken(token) {
  const t = String(token || "");
  const [body, sig] = t.split(".");
  if (!body || !sig) return { ok: false, error: "bad_format" };

  const expected = b64urlEncode(crypto.createHmac("sha256", getShareSecret()).update(body).digest());

  // constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_sig" };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(body));
  } catch {
    return { ok: false, error: "bad_payload" };
  }

  const now = Date.now();
  const exp = Number(payload?.exp || 0);
  if (!exp || now > exp) return { ok: false, error: "expired" };

  if (payload?.scope !== "donas_investor_range") {
    return { ok: false, error: "bad_scope" };
  }

  return { ok: true, payload };
}

/**
 * =========
 * ym helpers
 * =========
 */
function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function ymToFirstDayIso(ym) {
  const s = String(ym || "").trim();
  if (!isYm(s)) return null;
  return `${s}-01`;
}

function isoToYm(iso) {
  return String(iso || "").slice(0, 7);
}

function parseIsoDateOrNull(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function clampInt(n, lo, hi, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

function monthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d, k) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * =========
 * Ensure tables exist (safe)
 * =========
 */
async function ensureFinanceSettings() {
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

  const q = await db.query(`SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`, [SLUG_DEFAULT]);
  if (q.rows?.[0]) return q.rows[0];

  const ins = await db.query(
    `
    INSERT INTO donas_finance_settings
      (slug, currency, cash_start, fixed_opex_month, variable_opex_month, loan_payment_month, reserve_target_months)
    VALUES
      ($1,'UZS',0,0,0,0,0)
    RETURNING *
    `,
    [SLUG_DEFAULT]
  );
  return ins.rows[0];
}

async function ensureFinanceMonths() {
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

/**
 * =======================================================
 * ADMIN: issue share token
 * POST /api/admin/donas/share-token
 *
 * Body supports:
 *  A) { from:"YYYY-MM-01", to:"YYYY-MM-01", ttl_hours?: 168, slug?: "donas-dosas" }
 *  B) { months?: 12, end?: "YYYY-MM", ttl_days?: 7, slug?: "donas-dosas" }
 * =======================================================
 */
router.post("/api/admin/donas/share-token", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const slug = String(b.slug || SLUG_DEFAULT).trim() || SLUG_DEFAULT;

    const ttlHours = clampInt(b.ttl_hours, 1, 24 * 60, null); // up to 60 days
    const ttlDays = clampInt(b.ttl_days, 1, 60, null);
    const ttlMs =
      ttlHours != null
        ? ttlHours * 60 * 60 * 1000
        : (ttlDays != null ? ttlDays : 7) * 24 * 60 * 60 * 1000;

    let fromIso = null;
    let toIso = null;

    const fromD = parseIsoDateOrNull(b.from);
    const toD = parseIsoDateOrNull(b.to);

    if (fromD && toD) {
      const a = monthStart(fromD);
      const c = monthStart(toD);
      const lo = a.getTime() <= c.getTime() ? a : c;
      const hi = a.getTime() <= c.getTime() ? c : a;
      fromIso = toIsoDate(lo);
      toIso = toIsoDate(hi);
    } else {
      const months = clampInt(b.months, 1, 60, 12);
      const endYm = String(b.end || "").trim();
      if (!isYm(endYm)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid end (use YYYY-MM) or provide from/to" });
      }
      const end = monthStart(new Date(`${endYm}-01T00:00:00Z`));
      const start = addMonths(end, -(months - 1));
      fromIso = toIsoDate(start);
      toIso = toIsoDate(end);
    }

    const exp = Date.now() + ttlMs;

    const token = signShareToken({
      scope: "donas_investor_range",
      slug,
      from: fromIso,
      to: toIso,
      exp,
    });

    const base = process.env.FRONTEND_URL || "";
    const url = base
      ? `${base.replace(/\/+$/, "")}/public/donas/investor?t=${encodeURIComponent(token)}`
      : null;

    return res.json({ ok: true, token, url, exp, meta: { slug, from: fromIso, to: toIso } });
  } catch (e) {
    console.error("share-token error:", e);
    return res.status(500).json({ ok: false, error: "Failed" });
  }
});

/**
 * =======================================================
 * PUBLIC: investor summary by share-token (read-only)
 * GET /api/public/donas/summary-range-token?t=TOKEN
 *
 * IMPORTANT:
 * - НИЧЕГО НЕ ПЕРЕСЧИТЫВАЕМ, только читаем готовые months/settings
 * - #locked и stop-chain остаются на стороне агрегатора (у тебя уже есть)
 * =======================================================
 */
router.get("/api/public/donas/summary-range-token", async (req, res) => {
  try {
    const t = String(req.query.t || "");
    const v = verifyShareToken(t);
    if (!v.ok) return res.status(401).json({ ok: false, error: "Unauthorized", reason: v.error });

    const payload = v.payload || {};
    const slug = String(payload.slug || SLUG_DEFAULT).trim() || SLUG_DEFAULT;

    const fromIso = String(payload.from || "").trim();
    const toIso = String(payload.to || "").trim();

    const fromYm = isoToYm(fromIso);
    const toYm = isoToYm(toIso);

    if (!isYm(fromYm) || !isYm(toYm)) {
      return res.status(400).json({ ok: false, error: "Bad token range" });
    }

    await ensureFinanceSettings();
    await ensureFinanceMonths();

    const settingsQ = await db.query(`SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`, [slug]);
    const settings = settingsQ.rows?.[0] || (await ensureFinanceSettings());

    // берём все версии строк за диапазон и выбираем latest per month (как listMonths)
    const q = await db.query(
      `
      SELECT *
      FROM donas_finance_months
      WHERE slug=$1
        AND month >= ($2)::date
        AND month <= ($3)::date
      ORDER BY month ASC, id ASC
      `,
      [slug, ymToFirstDayIso(fromYm), ymToFirstDayIso(toYm)]
    );

    const byMonth = new Map();
    for (const r of q.rows || []) {
      const ym = String(r.month || "").slice(0, 7);
      const prev = byMonth.get(ym);
      if (!prev || Number(r.id) > Number(prev.id)) byMonth.set(ym, r);
    }

    const months = Array.from(byMonth.values()).sort((a, b) =>
      String(a.month).localeCompare(String(b.month))
    );

    return res.json({
      ok: true,
      meta: { slug, from: fromYm, to: toYm },
      settings,
      months,
    });
  } catch (e) {
    console.error("public summary-range-token error:", e);
    return res.status(500).json({ ok: false, error: "Failed" });
  }
});

module.exports = router;
