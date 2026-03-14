// backend/routes/adminProvidersRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
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
      `COALESCE(p.location, '') ILIKE $${idx}`,
      `COALESCE(p.social::text, '') ILIKE $${idx}`,
      `COALESCE(CAST(p.telegram_chat_id AS text), '') ILIKE $${idx}`,
      `COALESCE(array_to_string(p.languages, ' '), '') ILIKE $${idx}`,
      `COALESCE(array_to_string(p.city_slugs, ' '), '') ILIKE $${idx}`,
    ];
    params.push(like);
    idx += 1;

    if (numeric) {
      parts.push(`CAST(p.id AS text) = $${idx}`);
      parts.push(`CAST(p.telegram_chat_id AS text) = $${idx}`);
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
      `COALESCE(CAST(c.telegram_chat_id AS text), '') ILIKE $${idx}`,
    ];
    params.push(like);
    idx += 1;

    if (numeric) {
      parts.push(`CAST(c.id AS text) = $${idx}`);
      parts.push(`CAST(c.telegram_chat_id AS text) = $${idx}`);
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
      SELECT
        p.id,
        p.name,
        p.type,
        p.email,
        p.phone,
        p.location,
        p.languages,
        p.social,
        p.created_at,
        p.updated_at,
        p.city_slugs,
        p.telegram_chat_id,
        p.photo
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
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        c.telegram,
        c.telegram_chat_id,
        c.avatar_url,
        c.created_at,
        c.updated_at
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

module.exports = router;
