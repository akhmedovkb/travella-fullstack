// backend/controllers/adminPaymeAutoFixController.js

const pool = require("../db");

function toBool(v) {
  return v === true || String(v || "").toLowerCase() === "true" || String(v || "") === "1";
}

async function tableColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
       ORDER BY ordinal_position
    `,
    [tableName]
  );
  return new Set(rows.map((r) => r.column_name));
}

async function adminPaymeAutoFix(req, res) {
  const client = await pool.connect();
  const apply = toBool(req.query?.apply || req.body?.apply);

  const report = {
    success: true,
    mode: apply ? "apply_safe" : "audit_only",
    warning:
      "Dangerous auto-fix is disabled. This endpoint does not force Payme state=2 and does not create ledger rows manually. Payme must be finalized only through PerformTransaction or a reviewed manual recovery.",
    schema: {},
    candidates: {
      stuck_state1_older_than_10_min: 0,
      completed_missing_perform_time: 0,
      completed_missing_topup_paid: 0,
      completed_without_ledger_effect: 0,
      duplicate_payme_id_groups: 0,
    },
    fixed: {
      topup_paid_synced: 0,
    },
    errors: [],
  };

  try {
    const txCols = await tableColumns(client, "payme_transactions");
    const orderCols = await tableColumns(client, "topup_orders");
    const effectCols = await tableColumns(client, "payme_ledger_effects");

    report.schema.payme_transactions = Array.from(txCols);
    report.schema.topup_orders = Array.from(orderCols);
    report.schema.payme_ledger_effects = Array.from(effectCols);

    if (!txCols.has("payme_id") || !txCols.has("state")) {
      return res.status(400).json({
        ...report,
        success: false,
        errors: ["payme_transactions schema is missing payme_id/state"],
      });
    }

    const tenMinutesAgoMs = Date.now() - 10 * 60 * 1000;

    if (txCols.has("create_time")) {
      const { rows } = await client.query(
        `
          SELECT COUNT(*)::int AS count
            FROM payme_transactions
           WHERE state = 1
             AND create_time IS NOT NULL
             AND create_time < $1
        `,
        [tenMinutesAgoMs]
      );
      report.candidates.stuck_state1_older_than_10_min = Number(rows[0]?.count || 0);
    }

    if (txCols.has("perform_time")) {
      const { rows } = await client.query(
        `
          SELECT COUNT(*)::int AS count
            FROM payme_transactions
           WHERE state = 2
             AND perform_time IS NULL
        `
      );
      report.candidates.completed_missing_perform_time = Number(rows[0]?.count || 0);
    }

    if (txCols.has("order_id") && orderCols.has("id") && orderCols.has("status")) {
      const { rows } = await client.query(
        `
          SELECT COUNT(*)::int AS count
            FROM payme_transactions p
            JOIN topup_orders o ON o.id = p.order_id
           WHERE p.state = 2
             AND LOWER(COALESCE(o.status, '')) <> 'paid'
        `
      );
      report.candidates.completed_missing_topup_paid = Number(rows[0]?.count || 0);
    }

    if (effectCols.has("transaction_id")) {
      const { rows } = await client.query(
        `
          SELECT COUNT(*)::int AS count
            FROM payme_transactions p
            LEFT JOIN payme_ledger_effects e ON e.transaction_id = p.payme_id
           WHERE p.state = 2
             AND e.transaction_id IS NULL
        `
      );
      report.candidates.completed_without_ledger_effect = Number(rows[0]?.count || 0);
    }

    const { rows: duplicateRows } = await client.query(
      `
        SELECT COUNT(*)::int AS count
          FROM (
            SELECT payme_id
              FROM payme_transactions
             WHERE payme_id IS NOT NULL
             GROUP BY payme_id
            HAVING COUNT(*) > 1
          ) d
      `
    );
    report.candidates.duplicate_payme_id_groups = Number(duplicateRows[0]?.count || 0);

    // Safe optional repair: sync topup_orders.status='paid' only for already completed Payme transactions.
    // This does NOT create ledger rows and does NOT force transaction completion.
    if (apply && txCols.has("order_id") && orderCols.has("id") && orderCols.has("status")) {
      await client.query("BEGIN");
      try {
        const paidAtExpr = orderCols.has("paid_at") ? ", paid_at = COALESCE(paid_at, NOW())" : "";
        const { rowCount } = await client.query(
          `
            UPDATE topup_orders o
               SET status = 'paid'
                   ${paidAtExpr}
              FROM payme_transactions p
             WHERE p.order_id = o.id
               AND p.state = 2
               AND LOWER(COALESCE(o.status, '')) NOT IN ('paid', 'refunded')
          `
        );
        report.fixed.topup_paid_synced = rowCount;
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    return res.json(report);
  } catch (err) {
    report.success = false;
    report.errors.push(err?.message || String(err));
    return res.status(500).json(report);
  } finally {
    client.release();
  }
}

module.exports = {
  adminPaymeAutoFix,
};
