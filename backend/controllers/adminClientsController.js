//backend/controllers/adminClientsController.js

const pool = require("../db");
const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");

const colCache = new Map();

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function escLike(s) {
  return String(s || "").replace(/[\\%_]/g, "\\$&");
}

async function tableHasColumn(table, column) {
  const key = `${table}.${column}`;
  if (colCache.has(key)) return colCache.get(key);

  const { rows } = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  );

  const ok = rows.length > 0;
  colCache.set(key, ok);
  return ok;
}

async function getUnlockCols() {
  const [hasSource, hasNote, hasId] = await Promise.all([
    tableHasColumn("client_service_contact_unlocks", "source"),
    tableHasColumn("client_service_contact_unlocks", "note"),
    tableHasColumn("client_service_contact_unlocks", "id"),
  ]);

  return { hasSource, hasNote, hasId };
}

async function getLedgerCols() {
  const [hasMeta, hasReason, hasSource, hasServiceId] = await Promise.all([
    tableHasColumn("contact_balance_ledger", "meta"),
    tableHasColumn("contact_balance_ledger", "reason"),
    tableHasColumn("contact_balance_ledger", "source"),
    tableHasColumn("contact_balance_ledger", "service_id"),
  ]);

  return { hasMeta, hasReason, hasSource, hasServiceId };
}

async function getClientsCols() {
  const [hasIsNew, hasUpdatedAt, hasTelegram, hasTelegramChatId] = await Promise.all([
    tableHasColumn("clients", "is_new"),
    tableHasColumn("clients", "updated_at"),
    tableHasColumn("clients", "telegram"),
    tableHasColumn("clients", "telegram_chat_id"),
  ]);

  return { hasIsNew, hasUpdatedAt, hasTelegram, hasTelegramChatId };
}

async function ensureClientExists(clientId) {
  const { rows } = await pool.query(`SELECT id FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  return rows.length > 0;
}

async function ensureServiceExists(serviceId) {
  const { rows } = await pool.query(
    `SELECT id, provider_id, title, category FROM services WHERE id = $1 LIMIT 1`,
    [serviceId]
  );
  return rows[0] || null;
}

async function listClients(req, res) {
  const q = String(req.query.q || "").trim();
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
  const onlyNew = String(req.query.only_new || "").trim() === "1";

  try {
    const ccols = await getClientsCols();

    const sql = `
      WITH balances AS (
        SELECT
          l.client_id,
          COALESCE(SUM(l.amount), 0)::bigint AS balance_current
        FROM contact_balance_ledger l
        GROUP BY l.client_id
      ),
      unlocks AS (
        SELECT
          u.client_id,
          COUNT(*)::int AS unlock_count
        FROM client_service_contact_unlocks u
        GROUP BY u.client_id
      )
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        ${ccols.hasTelegram ? "c.telegram" : "NULL::text AS telegram"},
        ${ccols.hasTelegramChatId ? "c.telegram_chat_id" : "NULL::text AS telegram_chat_id"},
        c.created_at,
        ${ccols.hasUpdatedAt ? "c.updated_at" : "NULL::timestamp AS updated_at"},
        ${ccols.hasIsNew ? "COALESCE(c.is_new, false)" : "false"} AS is_new,
        COALESCE(b.balance_current, 0)::bigint AS balance_current,
        COALESCE(u.unlock_count, 0)::int AS unlock_count
      FROM clients c
      LEFT JOIN balances b ON b.client_id = c.id
      LEFT JOIN unlocks u ON u.client_id = c.id
      WHERE (
        $1::text IS NULL
        OR CAST(c.id AS text) ILIKE $1 ESCAPE '\\'
        OR COALESCE(c.name, '') ILIKE $1 ESCAPE '\\'
        OR COALESCE(c.email, '') ILIKE $1 ESCAPE '\\'
        OR COALESCE(c.phone, '') ILIKE $1 ESCAPE '\\'
        ${ccols.hasTelegram ? "OR COALESCE(c.telegram, '') ILIKE $1 ESCAPE '\\'" : ""}
        ${
          ccols.hasTelegramChatId
            ? "OR COALESCE(c.telegram_chat_id::text, '') ILIKE $1 ESCAPE '\\'"
            : ""
        }
      )
      AND (
        $2::bool = false
        OR ${ccols.hasIsNew ? "COALESCE(c.is_new, false) = true" : "false"}
      )
      ORDER BY c.id DESC
      LIMIT $3 OFFSET $4
    `;

    const like = q ? `%${escLike(q)}%` : null;
    const { rows } = await pool.query(sql, [like, onlyNew, limit, offset]);

    return res.json({
      ok: true,
      rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("listClients error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function resetNewClients(req, res) {
  try {
    const ccols = await getClientsCols();
    if (!ccols.hasIsNew) {
      return res.json({ ok: true, updated: 0, skipped: true, reason: "clients.is_new not found" });
    }

    const r = await pool.query(
      `
      UPDATE clients
      SET is_new = false
      ${ccols.hasUpdatedAt ? ", updated_at = NOW()" : ""}
      WHERE COALESCE(is_new, false) = true
      `
    );

    return res.json({ ok: true, updated: r.rowCount || 0 });
  } catch (e) {
    console.error("resetNewClients error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getClientSummary(req, res) {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  try {
    const ccols = await getClientsCols();

    const sql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        ${ccols.hasTelegram ? "c.telegram" : "NULL::text AS telegram"},
        ${ccols.hasTelegramChatId ? "c.telegram_chat_id" : "NULL::text AS telegram_chat_id"},
        c.created_at,
        ${ccols.hasUpdatedAt ? "c.updated_at" : "NULL::timestamp AS updated_at"},
        COALESCE(SUM(l.amount), 0)::bigint AS balance_current,
        COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 0)::bigint AS credited,
        COALESCE(SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0)::bigint AS debited,
        COALESCE((
          SELECT COUNT(*)
          FROM client_service_contact_unlocks u
          WHERE u.client_id = c.id
        ), 0)::int AS unlock_count
      FROM clients c
      LEFT JOIN contact_balance_ledger l ON l.client_id = c.id
      WHERE c.id = $1
      GROUP BY c.id
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [clientId]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    return res.json({ ok: true, client: rows[0] });
  } catch (e) {
    console.error("getClientSummary error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getClientLedger(req, res) {
  const clientId = Number(req.params.id);
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  try {
    const lcols = await getLedgerCols();

    const sql = `
      SELECT
        id,
        client_id,
        amount,
        ${lcols.hasReason ? "reason" : "NULL::text AS reason"},
        ${lcols.hasSource ? "source" : "NULL::text AS source"},
        ${lcols.hasServiceId ? "service_id" : "NULL::bigint AS service_id"},
        ${lcols.hasMeta ? "meta" : "NULL::jsonb AS meta"},
        created_at
      FROM contact_balance_ledger
      WHERE client_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(sql, [clientId, limit, offset]);
    return res.json({ ok: true, rows, limit, offset });
  } catch (e) {
    console.error("getClientLedger error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getClientUnlocks(req, res) {
  const clientId = Number(req.params.id);
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  try {
    const ucols = await getUnlockCols();

    const sql = `
      SELECT
        ${ucols.hasId ? "u.id" : "NULL::bigint AS id"},
        u.client_id,
        u.service_id,
        u.created_at AS opened_at,
        ${ucols.hasSource ? "u.source" : "NULL::text AS source"},
        ${ucols.hasNote ? "u.note" : "NULL::text AS note"},
        s.title,
        s.category,
        s.provider_id,
        p.name AS provider_name
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE u.client_id = $1
      ORDER BY u.created_at DESC, u.service_id DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(sql, [clientId, limit, offset]);
    return res.json({ ok: true, rows, limit, offset });
  } catch (e) {
    console.error("getClientUnlocks error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getClientAccessMatrix(req, res) {
  const clientId = Number(req.params.id);
  const q = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim() || null;
  const providerId = req.query.provider_id ? Number(req.query.provider_id) : null;
  const opened = String(req.query.opened || "").trim() || null;
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  if (!(await ensureClientExists(clientId))) {
    return res.status(404).json({ ok: false, message: "Client not found" });
  }

  try {
    const settings = await getContactUnlockSettings(pool);
    const ucols = await getUnlockCols();

    const sql = `
      SELECT
        s.id AS service_id,
        s.title,
        s.category,
        s.status,
        s.provider_id,
        p.name AS provider_name,
        CASE
          WHEN $2::bool = false THEN 'free'
          ELSE 'paid'
        END AS effective_mode,
        CASE WHEN u.service_id IS NOT NULL THEN true ELSE false END AS opened_for_client,
        u.created_at AS opened_at,
        ${ucols.hasSource ? "u.source" : "NULL::text AS source"},
        ${ucols.hasNote ? "u.note" : "NULL::text AS note"}
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      LEFT JOIN client_service_contact_unlocks u
        ON u.client_id = $1
       AND u.service_id = s.id
      WHERE (
        $3::text IS NULL
        OR COALESCE(s.title, '') ILIKE $3 ESCAPE '\\'
        OR COALESCE(s.category, '') ILIKE $3 ESCAPE '\\'
        OR COALESCE(p.name, '') ILIKE $3 ESCAPE '\\'
        OR CAST(s.id AS text) ILIKE $3 ESCAPE '\\'
      )
        AND ($4::text IS NULL OR s.category = $4)
        AND ($5::int IS NULL OR s.provider_id = $5)
        AND (
          $6::text IS NULL
          OR ($6 = 'opened' AND u.service_id IS NOT NULL)
          OR ($6 = 'closed' AND u.service_id IS NULL)
        )
      ORDER BY s.id DESC
      LIMIT $7 OFFSET $8
    `;

    const like = q ? `%${escLike(q)}%` : null;
    const { rows } = await pool.query(sql, [
      clientId,
      settings.is_paid,
      like,
      category,
      Number.isInteger(providerId) && providerId > 0 ? providerId : null,
      opened === "opened" || opened === "closed" ? opened : null,
      limit,
      offset,
    ]);

    return res.json({
      ok: true,
      global: {
        is_paid: settings.is_paid,
        price: settings.price,
        effective_price: settings.effective_price,
      },
      rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("getClientAccessMatrix error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function grantClientUnlock(req, res) {
  const clientId = Number(req.params.id);
  const serviceId = Number(req.body?.service_id);
  const sourceRaw = String(req.body?.source || "test_grant").trim().toLowerCase();
  const noteRaw = String(req.body?.note || "").trim();

  const allowedSources = new Set(["payment", "admin_grant", "test_grant"]);
  const source = allowedSources.has(sourceRaw) ? sourceRaw : "test_grant";

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad service_id" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    if (!(await ensureClientExists(clientId))) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const svc = await ensureServiceExists(serviceId);
    if (!svc) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Service not found" });
    }

    const ucols = await getUnlockCols();

    let sql;
    let params;

    if (ucols.hasSource && ucols.hasNote) {
      sql = `
        INSERT INTO client_service_contact_unlocks
          (client_id, service_id, source, note, created_at)
        VALUES
          ($1, $2, $3, $4, NOW())
        ON CONFLICT (client_id, service_id) DO UPDATE
        SET source = EXCLUDED.source,
            note = EXCLUDED.note
        RETURNING client_id, service_id, created_at
      `;
      params = [clientId, serviceId, source, noteRaw || null];
    } else if (ucols.hasSource) {
      sql = `
        INSERT INTO client_service_contact_unlocks
          (client_id, service_id, source, created_at)
        VALUES
          ($1, $2, $3, NOW())
        ON CONFLICT (client_id, service_id) DO UPDATE
        SET source = EXCLUDED.source
        RETURNING client_id, service_id, created_at
      `;
      params = [clientId, serviceId, source];
    } else {
      sql = `
        INSERT INTO client_service_contact_unlocks
          (client_id, service_id, created_at)
        VALUES
          ($1, $2, NOW())
        ON CONFLICT (client_id, service_id) DO NOTHING
        RETURNING client_id, service_id, created_at
      `;
      params = [clientId, serviceId];
    }

    const ins = await db.query(sql, params);
    await db.query("COMMIT");

    return res.json({
      ok: true,
      row: ins.rows[0] || {
        client_id: clientId,
        service_id: serviceId,
        created_at: null,
      },
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("grantClientUnlock error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    db.release();
  }
}

async function revokeClientUnlock(req, res) {
  const clientId = Number(req.params.id);
  const serviceId = Number(req.params.serviceId);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad service id" });
  }

  try {
    const r = await pool.query(
      `
      DELETE FROM client_service_contact_unlocks
      WHERE client_id = $1
        AND service_id = $2
      `,
      [clientId, serviceId]
    );

    return res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (e) {
    console.error("revokeClientUnlock error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adjustClientBalance(req, res) {
  const clientId = Number(req.params.id);
  const amountRaw = Number(req.body?.amount);
  const type = String(req.body?.type || "credit").trim().toLowerCase();
  const note = String(req.body?.note || "").trim();
  const sourceRaw = String(req.body?.source || "admin_adjust").trim().toLowerCase();

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return res.status(400).json({ ok: false, message: "Bad amount" });
  }
  if (type !== "credit" && type !== "debit") {
    return res.status(400).json({ ok: false, message: "Bad type" });
  }

  const amount = type === "debit" ? -Math.abs(Math.trunc(amountRaw)) : Math.abs(Math.trunc(amountRaw));
  const source = sourceRaw || "admin_adjust";

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    if (!(await ensureClientExists(clientId))) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const lcols = await getLedgerCols();

    const meta =
      lcols.hasMeta
        ? {
            note: note || null,
            adjusted_by: req.user?.id || null,
            adjusted_role: req.user?.role || null,
            adjust_type: type,
          }
        : null;

    const sql = `
      INSERT INTO contact_balance_ledger
        (
          client_id,
          amount,
          ${lcols.hasReason ? "reason," : ""}
          ${lcols.hasSource ? "source," : ""}
          ${lcols.hasServiceId ? "service_id," : ""}
          ${lcols.hasMeta ? "meta," : ""}
          created_at
        )
      VALUES
        (
          $1,
          $2,
          ${lcols.hasReason ? "$3," : ""}
          ${lcols.hasSource ? `$${lcols.hasReason ? 4 : 3},` : ""}
          ${lcols.hasServiceId ? `NULL,` : ""}
          ${lcols.hasMeta ? `$${lcols.hasReason && lcols.hasSource ? 5 : lcols.hasReason || lcols.hasSource ? 4 : 3},` : ""}
          NOW()
        )
      RETURNING id, client_id, amount, created_at
    `;

    const params = [clientId, amount];
    if (lcols.hasReason) params.push("manual_adjustment");
    if (lcols.hasSource) params.push(source);
    if (lcols.hasMeta) params.push(meta);

    const ins = await db.query(sql, params);
    await db.query("COMMIT");

    return res.json({
      ok: true,
      row: ins.rows[0] || null,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("adjustClientBalance error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    db.release();
  }
}

module.exports = {
  listClients,
  resetNewClients,
  getClientSummary,
  getClientLedger,
  getClientUnlocks,
  getClientAccessMatrix,
  grantClientUnlock,
  revokeClientUnlock,
  adjustClientBalance,
};
