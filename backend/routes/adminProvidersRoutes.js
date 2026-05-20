// backend/routes/adminProvidersRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const authenticateToken = require("../middleware/authenticateToken");

function requireAdmin(req, res, next) {
  try {
    const u = req.user || {};
    const roles = []
      .concat(u.role || [])
      .concat(u.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase());

    const perms = []
      .concat(u.permissions || u.perms || [])
      .map((x) => String(x).toLowerCase());

    const isAdmin =
      u.is_admin === true ||
      u.moderator === true ||
      roles.some((r) => ["admin", "moderator", "super", "root"].includes(r)) ||
      perms.some((x) => ["moderation", "admin:moderation"].includes(x));

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin only" });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function qi(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function escapeLike(value) {
  return String(value || "").replace(/[%_]/g, "\\$&");
}

function splitSearchTerms(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function pushProviderSearchClauses(where, params, startIdx, rawQuery) {
  const terms = splitSearchTerms(rawQuery);
  let idx = startIdx;

  for (const term of terms) {
    const like = `%${escapeLike(term)}%`;
    const digits = String(term).replace(/\D/g, "");
    const numeric = /^\d+$/.test(term) ? term : null;

    const parts = [
      `COALESCE(p.name, '') ILIKE $${idx}`,
      `COALESCE(p.email, '') ILIKE $${idx}`,
      `COALESCE(p.phone, '') ILIKE $${idx}`,
      `COALESCE(p.type, '') ILIKE $${idx}`,
      `COALESCE(array_to_string(p.location, ' '), '') ILIKE $${idx}`,
      `COALESCE(p.social, '') ILIKE $${idx}`,
      `COALESCE(p.telegram_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(p.tg_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(p.telegram_web_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(p.telegram_refused_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(p.languages::text, '') ILIKE $${idx}`,
      `COALESCE(array_to_string(p.city_slugs, ' '), '') ILIKE $${idx}`,
      `COALESCE(p.address, '') ILIKE $${idx}`,
      `COALESCE(p.account_status, '') ILIKE $${idx}`
    ];

    params.push(like);
    idx += 1;

    if (numeric) {
      parts.push(`p.id::text = $${idx}`);
      parts.push(`p.telegram_chat_id::text = $${idx}`);
      parts.push(`p.tg_chat_id::text = $${idx}`);
      parts.push(`p.telegram_web_chat_id::text = $${idx}`);
      parts.push(`p.telegram_refused_chat_id::text = $${idx}`);
      params.push(numeric);
      idx += 1;
    }

    if (digits) {
      parts.push(
        `regexp_replace(COALESCE(p.phone, ''), '[^0-9]+', '', 'g') ILIKE $${idx}`
      );
      params.push(`%${digits}%`);
      idx += 1;
    }

    where.push(`(${parts.join(" OR ")})`);
  }

  return idx;
}

function pushClientSearchClauses(where, params, startIdx, rawQuery) {
  const terms = splitSearchTerms(rawQuery);
  let idx = startIdx;

  for (const term of terms) {
    const like = `%${escapeLike(term)}%`;
    const digits = String(term).replace(/\D/g, "");
    const numeric = /^\d+$/.test(term) ? term : null;

    const parts = [
      `COALESCE(c.name, '') ILIKE $${idx}`,
      `COALESCE(c.email, '') ILIKE $${idx}`,
      `COALESCE(c.phone, '') ILIKE $${idx}`,
      `COALESCE(c.telegram, '') ILIKE $${idx}`,
      `COALESCE(c.tg_username, '') ILIKE $${idx}`,
      `COALESCE(c.telegram_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(c.tg_chat_id::text, '') ILIKE $${idx}`,
      `COALESCE(array_to_string(c.languages, ' '), '') ILIKE $${idx}`,
      `COALESCE(c.location::text, '') ILIKE $${idx}`,
      `COALESCE(c.account_status, '') ILIKE $${idx}`,
      `COALESCE(c.source, '') ILIKE $${idx}`
    ];

    params.push(like);
    idx += 1;

    if (numeric) {
      parts.push(`c.id::text = $${idx}`);
      parts.push(`c.telegram_chat_id::text = $${idx}`);
      parts.push(`c.tg_chat_id::text = $${idx}`);
      params.push(numeric);
      idx += 1;
    }

    if (digits) {
      parts.push(
        `regexp_replace(COALESCE(c.phone, ''), '[^0-9]+', '', 'g') ILIKE $${idx}`
      );
      params.push(`%${digits}%`);
      idx += 1;
    }

    where.push(`(${parts.join(" OR ")})`);
  }

  return idx;
}

async function listDirectFkRefs(db, targetTable) {
  const sql = `
    SELECT
      src_ns.nspname AS schema_name,
      src_tbl.relname AS table_name,
      src_att.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class src_tbl
      ON src_tbl.oid = c.conrelid
    JOIN pg_namespace src_ns
      ON src_ns.oid = src_tbl.relnamespace
    JOIN pg_class ref_tbl
      ON ref_tbl.oid = c.confrelid
    JOIN pg_namespace ref_ns
      ON ref_ns.oid = ref_tbl.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY AS src_col(attnum, ord)
      ON TRUE
    JOIN unnest(c.confkey) WITH ORDINALITY AS ref_col(attnum, ord)
      ON ref_col.ord = src_col.ord
    JOIN pg_attribute src_att
      ON src_att.attrelid = src_tbl.oid
     AND src_att.attnum = src_col.attnum
    JOIN pg_attribute ref_att
      ON ref_att.attrelid = ref_tbl.oid
     AND ref_att.attnum = ref_col.attnum
    WHERE c.contype = 'f'
      AND ref_ns.nspname = 'public'
      AND ref_tbl.relname = $1
      AND array_length(c.conkey, 1) = 1
      AND array_length(c.confkey, 1) = 1
      AND ref_att.attname = 'id'
    ORDER BY src_ns.nspname, src_tbl.relname, src_att.attname
  `;
  const { rows } = await db.query(sql, [targetTable]);
  return rows || [];
}

async function deleteEntityWithDirectRefs(db, targetTable, id) {
  const refs = await listDirectFkRefs(db, targetTable);
  const deletedRefs = [];

  for (const ref of refs) {
    const schema = ref.schema_name || "public";
    const table = ref.table_name;
    const column = ref.column_name;

    if (!table || table === targetTable) continue;

    const delSql = `
      DELETE FROM ${qi(schema)}.${qi(table)}
      WHERE ${qi(column)} = $1
    `;
    const res = await db.query(delSql, [id]);
    deletedRefs.push({
      table: `${schema}.${table}`,
      column,
      count: res.rowCount || 0,
    });
  }

  const mainSql = `DELETE FROM public.${qi(targetTable)} WHERE id = $1 RETURNING id`;
  const mainRes = await db.query(mainSql, [id]);

  if (!mainRes.rowCount) {
    return { ok: false, notFound: true, deletedRefs };
  }

  return { ok: true, notFound: false, deletedRefs };
}

/* =========================
   PROVIDERS TABLE
========================= */

router.get("/providers-table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q, type, limit = 50, cursor_created_at, cursor_id } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q && String(q).trim()) {
      idx = pushProviderSearchClauses(where, params, idx, q);
    }

    if (type && type.trim()) {
      where.push(`p.type = $${idx}`);
      params.push(String(type).trim());
      idx++;
    }

    if (cursor_created_at && cursor_id) {
      where.push(
        `(p.created_at, p.id) < ($${idx}::timestamptz, $${idx + 1}::bigint)`
      );
      params.push(new Date(cursor_created_at).toISOString(), cursor_id);
      idx += 2;
    }

    const sql = `
      SELECT p.*
      FROM providers p
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${idx}
    `;
    params.push(Math.min(Number(limit) || 50, 200));

    const rows = (await pool.query(sql, params)).rows;

    let nextCursor = null;
    if (rows.length) {
      const last = rows[rows.length - 1];
      nextCursor = {
        cursor_created_at: last.created_at,
        cursor_id: last.id,
      };
    }

    return res.type("application/json").json({ items: rows, nextCursor });
  } catch (e) {
    console.error("GET /api/admin/providers-table error:", e);
    return res.status(500).json({ error: "Failed to load providers table" });
  }
});

router.get(
  "/providers-table/new-count",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { since } = req.query;
      if (!since) return res.json({ count: 0 });

      const sql = `SELECT COUNT(*)::int AS count FROM providers WHERE created_at > $1`;
      const { rows } = await pool.query(sql, [new Date(since).toISOString()]);

      return res.type("application/json").json({ count: rows[0]?.count || 0 });
    } catch (e) {
      console.error("GET /api/admin/providers-table/new-count error:", e);
      return res.status(500).json({ error: "Failed to load providers new count" });
    }
  }
);

router.delete(
  "/providers-table/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Bad provider id" });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      const result = await deleteEntityWithDirectRefs(db, "providers", id);

      if (result.notFound) {
        await db.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Provider not found" });
      }

      await db.query("COMMIT");
      return res.json({
        ok: true,
        deleted: "provider",
        id,
        deletedRefs: result.deletedRefs,
      });
    } catch (e) {
      await db.query("ROLLBACK");
      console.error("DELETE /api/admin/providers-table/:id error:", e);

      if (e?.code === "23503") {
        return res.status(409).json({
          ok: false,
          error: "Provider is still referenced by other records",
          detail: e?.detail || null,
        });
      }

      return res.status(500).json({
        ok: false,
        error: "Failed to delete provider",
        detail: e?.message || null,
      });
    } finally {
      db.release();
    }
  }
);

/* =========================
   CLIENTS TABLE
========================= */

router.get("/clients-table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q, limit = 50, cursor_created_at, cursor_id } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q && String(q).trim()) {
      idx = pushClientSearchClauses(where, params, idx, q);
    }

    if (cursor_created_at && cursor_id) {
      where.push(
        `(c.created_at, c.id) < ($${idx}::timestamptz, $${idx + 1}::bigint)`
      );
      params.push(new Date(cursor_created_at).toISOString(), cursor_id);
      idx += 2;
    }

    const sql = `
      SELECT c.*
      FROM clients c
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $${idx}
    `;
    params.push(Math.min(Number(limit) || 50, 200));

    const rows = (await pool.query(sql, params)).rows;

    let nextCursor = null;
    if (rows.length) {
      const last = rows[rows.length - 1];
      nextCursor = {
        cursor_created_at: last.created_at,
        cursor_id: last.id,
      };
    }

    return res.type("application/json").json({ items: rows, nextCursor });
  } catch (e) {
    console.error("GET /api/admin/clients-table error:", e);
    return res.status(500).json({ error: "Failed to load clients table" });
  }
});

router.get(
  "/clients-table/new-count",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { since } = req.query;
      if (!since) return res.json({ count: 0 });

      const sql = `SELECT COUNT(*)::int AS count FROM clients WHERE created_at > $1`;
      const { rows } = await pool.query(sql, [new Date(since).toISOString()]);

      return res.type("application/json").json({ count: rows[0]?.count || 0 });
    } catch (e) {
      console.error("GET /api/admin/clients-table/new-count error:", e);
      return res.status(500).json({ error: "Failed to load clients new count" });
    }
  }
);

router.delete(
  "/clients-table/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Bad client id" });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      const result = await deleteEntityWithDirectRefs(db, "clients", id);

      if (result.notFound) {
        await db.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Client not found" });
      }

      await db.query("COMMIT");
      return res.json({
        ok: true,
        deleted: "client",
        id,
        deletedRefs: result.deletedRefs,
      });
    } catch (e) {
      await db.query("ROLLBACK");
      console.error("DELETE /api/admin/clients-table/:id error:", e);

      if (e?.code === "23503") {
        return res.status(409).json({
          ok: false,
          error: "Client is still referenced by other records",
          detail: e?.detail || null,
        });
      }

      return res.status(500).json({
        ok: false,
        error: "Failed to delete client",
        detail: e?.message || null,
      });
    } finally {
      db.release();
    }
  }
);


/* =========================
   ADMIN INLINE EDIT / PASSWORD RESET
========================= */

const PROVIDER_EDIT_FIELDS = [
  "name",
  "type",
  "email",
  "phone",
  "location",
  "languages",
  "social",
  "city_slugs",
  "address",
  "photo",
  "certificate",
  "car_fleet",
  "account_status",
  "hotel_id",
  "telegram_chat_id",
  "tg_chat_id",
  "telegram_web_chat_id",
  "telegram_refused_chat_id",
];

const CLIENT_EDIT_FIELDS = [
  "name",
  "email",
  "phone",
  "telegram",
  "tg_username",
  "avatar_url",
  "account_status",
  "source",
  "languages",
  "location",
  "telegram_chat_id",
  "tg_chat_id",
];

async function getTableColumns(tableName) {
  const { rows } = await pool.query(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );
  const map = new Map();
  for (const row of rows || []) map.set(row.column_name, row);
  return map;
}

function normalizeArrayValue(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map(String).map((x) => x.trim()).filter(Boolean);
  return String(value)
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeScalarValue(value) {
  if (value === undefined || value === "") return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildUpdateParts({ body, columns, allowedFields }) {
  const sets = [];
  const values = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    const col = columns.get(field);
    if (!col) continue;

    const isArray = col.data_type === "ARRAY" || String(col.udt_name || "").startsWith("_");
    const isJson = col.data_type === "json" || col.data_type === "jsonb";
    const isBigInt = col.data_type === "bigint" || col.udt_name === "int8";
    const isInteger = col.data_type === "integer" || col.udt_name === "int4";

    if (isArray) {
      sets.push(`${qi(field)} = $${idx}::text[]`);
      values.push(normalizeArrayValue(body[field]));
    } else if (isJson) {
      sets.push(`${qi(field)} = $${idx}::${col.data_type}`);
      const raw = body[field];
      // providers.car_fleet and several JSON/JSONB columns are NOT NULL in production.
      // Empty admin fields must be saved as an empty object, not NULL.
      if (raw === null || raw === undefined || raw === "") values.push("{}");
      else if (typeof raw === "string") {
        try {
          JSON.parse(raw);
          values.push(raw);
        } catch {
          values.push(JSON.stringify(raw));
        }
      } else {
        values.push(JSON.stringify(raw));
      }
    } else if (isBigInt || isInteger) {
      const raw = body[field];
      sets.push(`${qi(field)} = NULLIF($${idx}::text, '')::${isBigInt ? "bigint" : "integer"}`);
      values.push(raw === null || raw === undefined ? "" : String(raw));
    } else {
      sets.push(`${qi(field)} = $${idx}`);
      values.push(normalizeScalarValue(body[field]));
    }
    idx += 1;
  }

  return { sets, values, nextIndex: idx };
}

function makeTemporaryPassword() {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TRV-${part()}-${part()}`;
}

router.put("/providers-table/:id", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "Bad provider id" });

  try {
    const columns = await getTableColumns("providers");
    const { sets, values, nextIndex } = buildUpdateParts({
      body: req.body || {},
      columns,
      allowedFields: PROVIDER_EDIT_FIELDS,
    });

    if (!sets.length) return res.status(400).json({ ok: false, error: "No editable fields supplied" });

    if (columns.has("updated_at")) sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE providers SET ${sets.join(", ")} WHERE id = $${nextIndex} RETURNING *`,
      values
    );

    if (!rows[0]) return res.status(404).json({ ok: false, error: "Provider not found" });
    return res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("PUT /api/admin/providers-table/:id error:", e);
    return res.status(500).json({ ok: false, error: "Failed to update provider", detail: e?.message || null });
  }
});

router.post("/providers-table/:id/reset-password", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "Bad provider id" });

  try {
    const columns = await getTableColumns("providers");
    if (!columns.has("password")) return res.status(400).json({ ok: false, error: "providers.password column not found" });

    const temporaryPassword = makeTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 10);
    const updateUpdatedAt = columns.has("updated_at") ? ", updated_at = NOW()" : "";

    const { rows } = await pool.query(
      `UPDATE providers SET password = $1 ${updateUpdatedAt} WHERE id = $2 RETURNING id, password`,
      [hash, id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Provider not found" });

    return res.json({ ok: true, temporaryPassword, password_hash: rows[0].password });
  } catch (e) {
    console.error("POST /api/admin/providers-table/:id/reset-password error:", e);
    return res.status(500).json({ ok: false, error: "Failed to reset provider password", detail: e?.message || null });
  }
});

router.put("/clients-table/:id", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "Bad client id" });

  try {
    const columns = await getTableColumns("clients");
    const { sets, values, nextIndex } = buildUpdateParts({
      body: req.body || {},
      columns,
      allowedFields: CLIENT_EDIT_FIELDS,
    });

    if (!sets.length) return res.status(400).json({ ok: false, error: "No editable fields supplied" });

    if (columns.has("updated_at")) sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE clients SET ${sets.join(", ")} WHERE id = $${nextIndex} RETURNING *`,
      values
    );

    if (!rows[0]) return res.status(404).json({ ok: false, error: "Client not found" });
    return res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("PUT /api/admin/clients-table/:id error:", e);
    return res.status(500).json({ ok: false, error: "Failed to update client", detail: e?.message || null });
  }
});

router.post("/clients-table/:id/reset-password", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "Bad client id" });

  try {
    const columns = await getTableColumns("clients");
    const passwordColumn = columns.has("password_hash") ? "password_hash" : (columns.has("password") ? "password" : null);
    if (!passwordColumn) return res.status(400).json({ ok: false, error: "clients password column not found" });

    const temporaryPassword = makeTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 10);
    const updateUpdatedAt = columns.has("updated_at") ? ", updated_at = NOW()" : "";

    const { rows } = await pool.query(
      `UPDATE clients SET ${qi(passwordColumn)} = $1 ${updateUpdatedAt} WHERE id = $2 RETURNING id, ${qi(passwordColumn)} AS password_hash`,
      [hash, id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Client not found" });

    return res.json({ ok: true, temporaryPassword, password_hash: rows[0].password_hash });
  } catch (e) {
    console.error("POST /api/admin/clients-table/:id/reset-password error:", e);
    return res.status(500).json({ ok: false, error: "Failed to reset client password", detail: e?.message || null });
  }
});

module.exports = router;
