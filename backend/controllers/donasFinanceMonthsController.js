// backend/controllers/donasFinanceMonthsController.js
const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function monthToDate(ym) {
  return `${ym}-01`;
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function addLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (hasLockedTag(s)) return s;
  return `${s}\n#locked`;
}

function removeLockedTag(notes) {
  const s = String(notes || "");
  return s
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "#locked")
    .join("\n")
    .trim();
}

function jsonSafe(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

// фиксируем slug для Dona's Dosas
const SLUG = "donas-dosas";

/**
 * ВАЖНО:
 * В проде может не быть unique constraint на (slug, month),
 * поэтому "idempotent insert" через WHERE NOT EXISTS.
 */
async function ensureMonthRow(ym) {
  const d = monthToDate(ym);
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    SELECT
      $2, $1::date, 0, 0, 0, 0, 0, 0, ''
    WHERE NOT EXISTS (
      SELECT 1
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      LIMIT 1
    )
    `,
    [d, SLUG]
  );
}

/**
 * Авто-суммы по месяцу:
 * - OPEX/CAPEX: из donas_purchases
 * - Revenue/COGS: из donas_sales (revenue_total, cogs_total)
 */
async function getAutoSumsByMonth() {
  const { rows } = await db.query(
    `
    WITH p AS (
      SELECT
        to_char(date_trunc('month', date)::date, 'YYYY-MM') as month,
        SUM(CASE WHEN type='opex'  THEN COALESCE(total, qty*price, 0) ELSE 0 END) as opex,
        SUM(CASE WHEN type='capex' THEN COALESCE(total, qty*price, 0) ELSE 0 END) as capex
      FROM donas_purchases
      GROUP BY 1
    ),
    s AS (
      SELECT
        to_char(date_trunc('month', sold_at)::date, 'YYYY-MM') as month,
        COALESCE(SUM(COALESCE(cogs_total, 0)), 0) as cogs,
        COALESCE(SUM(COALESCE(revenue_total, 0)), 0) as revenue
      FROM donas_sales
      GROUP BY 1
    )
    SELECT
      COALESCE(p.month, s.month) as month,
      COALESCE(p.opex, 0) as opex,
      COALESCE(p.capex, 0) as capex,
      COALESCE(s.cogs, 0) as cogs,
      COALESCE(s.revenue, 0) as revenue
    FROM p
    FULL JOIN s ON s.month = p.month
    ORDER BY 1 ASC
    `
  );

  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.month), {
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      cogs: toNum(r.cogs),
      revenue: toNum(r.revenue),
    });
  }
  return map;
}

/**
 * Список месяцев, которые должны быть в finance:
 * - из purchases
 * - из sales
 * - из donas_finance_months
 */
async function getAllRelevantMonthsYms() {
  const { rows } = await db.query(
    `
    WITH m AS (
      SELECT to_char(date_trunc('month', date)::date, 'YYYY-MM') as month
      FROM donas_purchases
      GROUP BY 1

      UNION

      SELECT to_char(date_trunc('month', sold_at)::date, 'YYYY-MM') as month
      FROM donas_sales
      GROUP BY 1

      UNION

      SELECT to_char(month::date, 'YYYY-MM') as month
      FROM donas_finance_months
      WHERE slug=$1
      GROUP BY 1
    )
    SELECT month
    FROM m
    ORDER BY month ASC
    `,
    [SLUG]
  );

  return (rows || []).map((r) => String(r.month));
}

async function getSettingsRow() {
  try {
    const { rows } = await db.query(
      `SELECT * FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Базовые stored-строки finance_months (как в таблице).
 */
async function getStoredMonthsAsc() {
  const { rows } = await db.query(
    `
    SELECT
      id,
      slug,
      to_char(month,'YYYY-MM') as month,
      revenue, cogs, opex, capex, loan_paid, cash_end,
      notes,
      updated_at
    FROM donas_finance_months
    WHERE slug=$1
    ORDER BY month ASC
    `,
    [SLUG]
  );
  return rows || [];
}

/**
 * Сборка Months view:
 * - locked: берём stored revenue/cogs/opex/capex/cash_end
 * - unlocked: revenue/cogs/opex/capex = auto, cash_end считается по цепочке
 * - loan_paid: всегда stored (ручное)
 * - notes: stored
 */
async function computeMonthsView() {
  const allMonths = await getAllRelevantMonthsYms();
  for (const ym of allMonths) {
    if (isYm(ym)) await ensureMonthRow(ym);
  }

  const settings = await getSettingsRow();
  const openingCash = toNum(settings?.opening_cash);

  const autoMap = await getAutoSumsByMonth();
  const stored = await getStoredMonthsAsc();

  const out = [];
  let prevCashEnd = openingCash;

  for (const r of stored) {
    const ym = String(r.month);
    const locked = hasLockedTag(r.notes);

    const loanPaid = toNum(r.loan_paid);
    const auto = autoMap.get(ym) || { opex: 0, capex: 0, cogs: 0, revenue: 0 };

    // revenue/cogs:
    // locked -> stored
    // unlocked -> auto from sales
    const revenue = locked ? toNum(r.revenue) : toNum(auto.revenue);
    const cogs = locked ? toNum(r.cogs) : toNum(auto.cogs);
    const opex = locked ? toNum(r.opex) : toNum(auto.opex);
    const capex = locked ? toNum(r.capex) : toNum(auto.capex);

    const opening = prevCashEnd;

    let cf = 0;
    let cashEnd = 0;

    if (locked) {
      cashEnd = toNum(r.cash_end);
      cf = cashEnd - opening;
    } else {
      cf = revenue - cogs - opex - capex - loanPaid;
      cashEnd = opening + cf;
    }

    const diff = cashEnd - opening;

    out.push({
      id: r.id,
      slug: r.slug,
      month: ym,
      revenue,
      cogs,
      opex,
      capex,
      loan_paid: loanPaid,
      cf,
      cash_end: cashEnd,
      diff,
      notes: r.notes || "",
      updated_at: r.updated_at,
      locked,
    });

    prevCashEnd = cashEnd;
  }

  return { settings, months: out, autoMap };
}

/**
 * =========================
 * AUDIT
 * =========================
 * Таблица: donas_finance_audit
 * id, slug, ym, action, diff(jsonb), actor_name, actor_email, created_at
 */
async function auditLog({ ym, action, diff, actor_name, actor_email }) {
  try {
    await db.query(
      `
      INSERT INTO donas_finance_audit (slug, ym, action, diff, actor_name, actor_email)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      `,
      [SLUG, ym || null, action || "", jsonSafe(diff || {}), actor_name || null, actor_email || null]
    );
  } catch (e) {
    // audit не должен ломать основной поток
    console.error("auditLog error:", e);
  }
}

function getActor(req) {
  // Если у тебя в middleware кладётся req.user — подхватим
  const u = req?.user || {};
  const actor_name = u?.name || u?.full_name || u?.username || null;
  const actor_email = u?.email || null;
  return { actor_name, actor_email };
}

/**
 * =========================
 * PREVIEW HELPERS
 * =========================
 * Строим "planned" для lockUpTo / resnapshotUpTo.
 */
function pickByYm(months) {
  const m = new Map();
  for (const r of months || []) m.set(String(r.month), r);
  return m;
}

async function computePlannedLockPreview(targetYm, scope) {
  const view = await computeMonthsView();
  const months = view.months;
  const autoMap = view.autoMap;

  const all = months.map((m) => String(m.month));
  const targetWasLocked = !!months.find((x) => x.month === targetYm)?.locked;

  const affected =
    scope === "upto" ? all.filter((ym) => ym <= targetYm) : all.filter((ym) => ym === targetYm);

  // current by ym
  const curMap = pickByYm(months);

  // planned: для affected месяцев делаем "locked snapshot по auto" с пересчётом цепочки
  // ВАЖНО: цепочка cash_end должна идти последовательно, и planned cash_end влияет на opening следующего месяца.
  const planned = new Map();

  // opening_cash
  const settings = view.settings || {};
  const openingCash = toNum(settings.opening_cash);

  let prevCashEnd = openingCash;

  for (const ym of all) {
    const cur = curMap.get(ym) || null;
    const auto = autoMap.get(ym) || { revenue: 0, cogs: 0, opex: 0, capex: 0 };

    const isAffected = affected.includes(ym);

    let next = null;

    if (!cur) {
      next = {
        locked: false,
        revenue: 0,
        cogs: 0,
        opex: 0,
        capex: 0,
        loan_paid: 0,
        cash_end: prevCashEnd,
        notes: "",
      };
    } else if (isAffected) {
      // planned locked snapshot = значения auto + cash chain (как unlocked), но фиксируем как locked
      const revenue = toNum(auto.revenue);
      const cogs = toNum(auto.cogs);
      const opex = toNum(auto.opex);
      const capex = toNum(auto.capex);
      const loanPaid = toNum(cur.loan_paid);

      const cf = revenue - cogs - opex - capex - loanPaid;
      const cashEnd = prevCashEnd + cf;

      next = {
        locked: true,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid: loanPaid,
        cash_end: cashEnd,
        notes: addLockedTag(cur.notes || ""),
      };
    } else {
      // not affected: сохраняем текущий "режим"
      if (cur.locked) {
        // locked: cash_end фиксирован
        next = {
          locked: true,
          revenue: toNum(cur.revenue),
          cogs: toNum(cur.cogs),
          opex: toNum(cur.opex),
          capex: toNum(cur.capex),
          loan_paid: toNum(cur.loan_paid),
          cash_end: toNum(cur.cash_end),
          notes: addLockedTag(cur.notes || ""),
        };
      } else {
        // unlocked: auto + chain
        const revenue = toNum(auto.revenue);
        const cogs = toNum(auto.cogs);
        const opex = toNum(auto.opex);
        const capex = toNum(auto.capex);
        const loanPaid = toNum(cur.loan_paid);

        const cf = revenue - cogs - opex - capex - loanPaid;
        const cashEnd = prevCashEnd + cf;

        next = {
          locked: false,
          revenue,
          cogs,
          opex,
          capex,
          loan_paid: loanPaid,
          cash_end: cashEnd,
          notes: cur.notes || "",
        };
      }
    }

    planned.set(ym, next);
    prevCashEnd = toNum(next.cash_end);
  }

  // items: показываем только affected (чтобы не перегружать), но можно легко расширить
  const items = affected.map((ym) => {
    const cur = curMap.get(ym);
    const pl = planned.get(ym);
    const auto = autoMap.get(ym) || { opex: 0, capex: 0 };

    return {
      ym,
      current: {
        locked: !!cur?.locked,
        cash_end: toNum(cur?.cash_end),
        opex: toNum(cur?.opex),
        capex: toNum(cur?.capex),
        notes: cur?.notes || "",
      },
      planned: {
        locked: !!pl?.locked,
        cash_end: toNum(pl?.cash_end),
        opex: toNum(pl?.opex),
        capex: toNum(pl?.capex),
        notes: pl?.notes || "",
      },
      purchases: {
        opex: toNum(auto.opex),
        capex: toNum(auto.capex),
      },
      diff: {
        opex: toNum(auto.opex) - toNum(cur?.opex),
        capex: toNum(auto.capex) - toNum(cur?.capex),
      },
    };
  });

  const deltaCashEndAtTarget =
    toNum(planned.get(targetYm)?.cash_end) - toNum(curMap.get(targetYm)?.cash_end);

  // сколько среди affected было locked
  const affectedLockedCount = affected.filter((ym) => !!curMap.get(ym)?.locked).length;

  return {
    scope: scope === "upto" ? "upto" : "single",
    summary: {
      deltaCashEndAtTarget,
      affectedLockedCount,
      targetWasLocked,
    },
    items,
  };
}

async function computeResnapshotUpToPreview(targetYm) {
  const view = await computeMonthsView();
  const months = view.months;
  const autoMap = view.autoMap;

  const all = months.map((m) => String(m.month));
  const affected = all.filter((ym) => ym <= targetYm);

  const curMap = pickByYm(months);
  const settings = view.settings || {};
  const openingCash = toNum(settings.opening_cash);

  // planned: пересчитываем цепочку, но "перезаписываем" только locked месяцы <= target
  const planned = new Map();

  let prevCashEnd = openingCash;

  let updatedLocked = 0;

  for (const ym of all) {
    const cur = curMap.get(ym);
    const auto = autoMap.get(ym) || { revenue: 0, cogs: 0, opex: 0, capex: 0 };

    if (!cur) {
      planned.set(ym, {
        locked: false,
        cash_end: prevCashEnd,
        opex: 0,
        capex: 0,
        notes: "",
      });
      continue;
    }

    const inScope = ym <= targetYm;

    if (inScope && cur.locked) {
      // переснимаем снепшот (locked only)
      const revenue = toNum(auto.revenue);
      const cogs = toNum(auto.cogs);
      const opex = toNum(auto.opex);
      const capex = toNum(auto.capex);
      const loanPaid = toNum(cur.loan_paid);

      const cf = revenue - cogs - opex - capex - loanPaid;
      const cashEnd = prevCashEnd + cf;

      planned.set(ym, {
        locked: true,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid: loanPaid,
        cash_end: cashEnd,
        notes: addLockedTag(cur.notes || ""),
      });

      updatedLocked += 1;
      prevCashEnd = cashEnd;
    } else if (cur.locked) {
      // locked (unchanged)
      planned.set(ym, {
        locked: true,
        revenue: toNum(cur.revenue),
        cogs: toNum(cur.cogs),
        opex: toNum(cur.opex),
        capex: toNum(cur.capex),
        loan_paid: toNum(cur.loan_paid),
        cash_end: toNum(cur.cash_end),
        notes: addLockedTag(cur.notes || ""),
      });
      prevCashEnd = toNum(cur.cash_end);
    } else {
      // unlocked (auto)
      const revenue = toNum(auto.revenue);
      const cogs = toNum(auto.cogs);
      const opex = toNum(auto.opex);
      const capex = toNum(auto.capex);
      const loanPaid = toNum(cur.loan_paid);

      const cf = revenue - cogs - opex - capex - loanPaid;
      const cashEnd = prevCashEnd + cf;

      planned.set(ym, {
        locked: false,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid: loanPaid,
        cash_end: cashEnd,
        notes: cur.notes || "",
      });
      prevCashEnd = cashEnd;
    }
  }

  const items = affected.map((ym) => {
    const cur = curMap.get(ym);
    const pl = planned.get(ym);
    const auto = autoMap.get(ym) || { opex: 0, capex: 0 };

    return {
      ym,
      current: {
        locked: !!cur?.locked,
        cash_end: toNum(cur?.cash_end),
        opex: toNum(cur?.opex),
        capex: toNum(cur?.capex),
        notes: cur?.notes || "",
      },
      planned: {
        locked: !!pl?.locked,
        cash_end: toNum(pl?.cash_end),
        opex: toNum(pl?.opex),
        capex: toNum(pl?.capex),
        notes: pl?.notes || "",
      },
      purchases: {
        opex: toNum(auto.opex),
        capex: toNum(auto.capex),
      },
      diff: {
        opex: toNum(auto.opex) - toNum(cur?.opex),
        capex: toNum(auto.capex) - toNum(cur?.capex),
      },
    };
  });

  const deltaCashEndAtTarget =
    toNum(planned.get(targetYm)?.cash_end) - toNum(curMap.get(targetYm)?.cash_end);

  return {
    scope: "resnapshot_upto_locked",
    summary: {
      deltaCashEndAtTarget,
      affectedLockedCount: updatedLocked,
      targetWasLocked: !!curMap.get(targetYm)?.locked,
    },
    items,
  };
}

/**
 * =========================
 * SETTINGS
 * =========================
 */
exports.getSettings = async (_req, res) => {
  try {
    const row = await getSettingsRow();
    return res.json(row);
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};

    const { rows: curRows } = await db.query(
      `SELECT id FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );

    let id = curRows?.[0]?.id;

    if (!id) {
      const ins = await db.query(`INSERT INTO donas_finance_settings DEFAULT VALUES RETURNING id`);
      id = ins.rows?.[0]?.id;
    }

    const keys = Object.keys(body || {}).filter((k) => k !== "id");
    if (!keys.length) {
      const { rows } = await db.query(`SELECT * FROM donas_finance_settings WHERE id=$1`, [id]);
      return res.json(rows?.[0] || null);
    }

    const sets = [];
    const vals = [];
    let k = 2;

    for (const key of keys) {
      sets.push(`${key}=$${k++}`);
      vals.push(body[key]);
    }

    const q = `
      UPDATE donas_finance_settings
      SET ${sets.join(", ")}, updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `;

    const { rows } = await db.query(q, [id, ...vals]);
    return res.json(rows?.[0] || null);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

/**
 * =========================
 * MONTHS
 * =========================
 */
exports.listMonths = async (_req, res) => {
  try {
    const view = await computeMonthsView();
    return res.json(view.months);
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

exports.syncMonths = async (req, res) => {
  try {
    const allMonths = await getAllRelevantMonthsYms();
    let created = 0;

    for (const ym of allMonths) {
      if (!isYm(ym)) continue;
      await ensureMonthRow(ym);
      created += 1;
    }

    const actor = getActor(req);
    await auditLog({
      ym: null,
      action: "sync_months",
      diff: { created },
      ...actor,
    });

    const view = await computeMonthsView();
    return res.json({ ok: true, created, months: view.months });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/**
 * PUT /api/admin/donas/finance/months/:month
 * чисто: сохраняем только revenue (override) и loan_paid/notes — НО
 * в твоей новой логике мы оставляем только loan_paid/notes.
 */
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows: curRows } = await db.query(
      `SELECT notes, loan_paid, revenue FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const cur = curRows?.[0] || {};
    const curNotes = String(cur.notes || "");

    if (hasLockedTag(curNotes)) {
      return res.status(409).json({ error: "Month is locked (#locked). Remove tag to edit." });
    }

    const b = req.body || {};
    const loanPaid = toNum(b.loan_paid);
    const notes = String(b.notes ?? "");

    await db.query(
      `
      UPDATE donas_finance_months
      SET loan_paid=$3, notes=$4, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [monthToDate(month), SLUG, loanPaid, notes]
    );

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "update_month",
      diff: {
        loan_paid: { from: toNum(cur.loan_paid), to: loanPaid },
        notes: { from: String(cur.notes || ""), to: notes },
      },
      ...actor,
    });

    const view = await computeMonthsView();
    const row = view.months.find((x) => x.month === month) || null;
    return res.json({ ok: true, month: row });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/lock-preview?scope=single|upto
 */
exports.lockPreview = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const scope = String(req.query.scope || "single");
    const s = scope === "upto" ? "upto" : "single";
    const preview = await computePlannedLockPreview(month, s);
    return res.json(preview);
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to load lock preview" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/lock
 */
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    // считаем план (single)
    const planned = await computePlannedLockPreview(month, "single");
    const it = planned.items?.[0];
    if (!it) return res.status(404).json({ error: "Month not found" });

    // обновляем snapshot
    await db.query(
      `
      UPDATE donas_finance_months
      SET
        opex=$3,
        capex=$4,
        cash_end=$5,
        notes=$6,
        updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(it.planned.opex),
        toNum(it.planned.capex),
        toNum(it.planned.cash_end),
        addLockedTag(it.planned.notes || ""),
      ]
    );

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "lock_month",
      diff: {
        opex: { from: toNum(it.current.opex), to: toNum(it.planned.opex) },
        capex: { from: toNum(it.current.capex), to: toNum(it.planned.capex) },
        cash_end: { from: toNum(it.current.cash_end), to: toNum(it.planned.cash_end) },
      },
      ...actor,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/unlock
 */
exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const oldNotes = String(rows?.[0]?.notes || "");
    const newNotes = removeLockedTag(oldNotes);

    await db.query(
      `UPDATE donas_finance_months SET notes=$3, updated_at=NOW() WHERE slug=$2 AND month=$1::date`,
      [monthToDate(month), SLUG, newNotes]
    );

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "unlock_month",
      diff: { notes: { from: oldNotes, to: newNotes } },
      ...actor,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/resnapshot
 * переснимаем снапшот выбранного месяца (если он locked)
 */
exports.resnapshotMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const view = await computeMonthsView();
    const cur = view.months.find((x) => x.month === month);
    if (!cur) return res.status(404).json({ error: "Month not found" });

    // если не locked — просто фиксируем как locked по текущим auto
    const planned = await computePlannedLockPreview(month, "single");
    const it = planned.items?.[0];
    if (!it) return res.status(404).json({ error: "Month not found" });

    await db.query(
      `
      UPDATE donas_finance_months
      SET
        opex=$3,
        capex=$4,
        cash_end=$5,
        notes=$6,
        updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(it.planned.opex),
        toNum(it.planned.capex),
        toNum(it.planned.cash_end),
        addLockedTag(it.planned.notes || ""),
      ]
    );

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "resnapshot_month",
      diff: {
        opex: { from: toNum(it.current.opex), to: toNum(it.planned.opex) },
        capex: { from: toNum(it.current.capex), to: toNum(it.planned.capex) },
        cash_end: { from: toNum(it.current.cash_end), to: toNum(it.planned.cash_end) },
      },
      ...actor,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/lock-up-to
 * lock + snapshot ALL months <= target по правильной cash chain
 */
exports.lockUpTo = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const preview = await computePlannedLockPreview(month, "upto");
    const items = preview.items || [];

    let lockedCount = 0;

    // применяем по каждому affected месяцу planned snapshot
    for (const it of items) {
      const ym = it.ym;

      await ensureMonthRow(ym);

      await db.query(
        `
        UPDATE donas_finance_months
        SET
          opex=$3,
          capex=$4,
          cash_end=$5,
          notes=$6,
          updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(ym),
          SLUG,
          toNum(it.planned.opex),
          toNum(it.planned.capex),
          toNum(it.planned.cash_end),
          addLockedTag(it.planned.notes || ""),
        ]
      );

      lockedCount += 1;
    }

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "lock_up_to",
      diff: { lockedCount },
      ...actor,
    });

    return res.json({ ok: true, locked: lockedCount });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to month" });
  }
};

/**
 * GET /api/admin/donas/finance/months/:month/resnapshot-up-to-preview
 * preview "bulk resnapshot locked months <= target"
 */
exports.resnapshotUpToPreview = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const preview = await computeResnapshotUpToPreview(month);
    return res.json(preview);
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed to load resnapshot preview" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/resnapshot-up-to
 * bulk resnapshot locked months <= target
 */
exports.resnapshotUpTo = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const preview = await computeResnapshotUpToPreview(month);
    const items = preview.items || [];

    let updatedCount = 0;

    for (const it of items) {
      // только если current locked
      if (!it.current?.locked) continue;

      const ym = it.ym;
      await ensureMonthRow(ym);

      await db.query(
        `
        UPDATE donas_finance_months
        SET
          opex=$3,
          capex=$4,
          cash_end=$5,
          notes=$6,
          updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(ym),
          SLUG,
          toNum(it.planned.opex),
          toNum(it.planned.capex),
          toNum(it.planned.cash_end),
          addLockedTag(it.planned.notes || ""),
        ]
      );

      updatedCount += 1;
    }

    const actor = getActor(req);
    await auditLog({
      ym: month,
      action: "resnapshot_up_to",
      diff: { updatedCount },
      ...actor,
    });

    return res.json({ ok: true, updatedCount });
  } catch (e) {
    console.error("resnapshotUpTo error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
};

/**
 * =========================
 * EXPORT MONTHS CSV
 * =========================
 */
exports.exportCsv = async (_req, res) => {
  try {
    const view = await computeMonthsView();

    const header = [
      "month",
      "revenue",
      "cogs",
      "opex",
      "capex",
      "loan_paid",
      "cf",
      "cash_end",
      "diff",
      "locked",
      "notes",
    ].join(",");

    const lines = [header];

    for (const r of view.months) {
      const notes = String(r.notes || "").replace(/\"/g, "\"\"");
      const notesCell = `"${notes}"`;

      lines.push(
        [
          r.month,
          toNum(r.revenue),
          toNum(r.cogs),
          toNum(r.opex),
          toNum(r.capex),
          toNum(r.loan_paid),
          toNum(r.cf),
          toNum(r.cash_end),
          toNum(r.diff),
          r.locked ? "1" : "0",
          notesCell,
        ].join(",")
      );
    }

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_months.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export CSV" });
  }
};

/**
 * =========================
 * AUDIT API
 * =========================
 * GET /api/admin/donas/finance/audit?limit=200
 * GET /api/admin/donas/finance/audit/export.csv?limit=200
 * GET /api/admin/donas/finance/months/:ym/audit?limit=200
 * GET /api/admin/donas/finance/months/:ym/audit/export.csv?limit=200
 */
exports.audit = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);

    const { rows } = await db.query(
      `
      SELECT
        id,
        ym,
        action,
        diff,
        actor_name,
        actor_email,
        created_at
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    return res.json(rows || []);
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
};

exports.auditForMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);

    const { rows } = await db.query(
      `
      SELECT
        id,
        ym,
        action,
        diff,
        actor_name,
        actor_email,
        created_at
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $3
      `,
      [SLUG, month, limit]
    );

    return res.json(rows || []);
  } catch (e) {
    console.error("auditForMonth error:", e);
    return res.status(500).json({ error: "Failed to load month audit" });
  }
};

function auditRowsToCsv(rows) {
  const header = ["created_at", "ym", "action", "actor_name", "actor_email", "diff"].join(",");
  const lines = [header];

  for (const r of rows || []) {
    const created = String(r.created_at || "").replace("T", " ").slice(0, 19);
    const ym = String(r.ym || "");
    const action = String(r.action || "").replace(/\"/g, "\"\"");
    const actorName = String(r.actor_name || "").replace(/\"/g, "\"\"");
    const actorEmail = String(r.actor_email || "").replace(/\"/g, "\"\"");
    const diff = String(jsonSafe(r.diff || {})).replace(/\"/g, "\"\"");

    lines.push(
      [
        `"${created}"`,
        `"${ym}"`,
        `"${action}"`,
        `"${actorName}"`,
        `"${actorEmail}"`,
        `"${diff}"`,
      ].join(",")
    );
  }

  return lines.join("\n");
}

exports.exportAuditCsv = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);

    const { rows } = await db.query(
      `
      SELECT ym, action, diff, actor_name, actor_email, created_at
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    const csv = auditRowsToCsv(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit CSV" });
  }
};

exports.exportMonthAuditCsv = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);

    const { rows } = await db.query(
      `
      SELECT ym, action, diff, actor_name, actor_email, created_at
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $3
      `,
      [SLUG, month, limit]
    );

    const csv = auditRowsToCsv(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit_${month}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportMonthAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit CSV" });
  }
};
