const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();

async function requirePlatformAdmin(req, res, next) {
  try {
    const providerId = Number(req.user?.id);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { rows } = await pool.query(
      "SELECT id, name, email FROM providers WHERE id = $1 AND is_admin = TRUE LIMIT 1",
      [providerId]
    );
    if (!rows[0]) return res.status(403).json({ error: "Требуются права администратора" });

    req.platformAdmin = rows[0];
    return next();
  } catch (error) {
    console.error("[admin-access] authorization failed:", error);
    return res.status(500).json({ error: "Не удалось проверить права администратора" });
  }
}

async function ensureAuditTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_role_events (
      id BIGSERIAL PRIMARY KEY,
      actor_provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
      target_provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
      action VARCHAR(32) NOT NULL CHECK (action IN ('granted', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_role_events_created_at
      ON admin_role_events (created_at DESC)
  `);
}

router.get("/admin-access", authenticateToken, requirePlatformAdmin, async (req, res) => {
  try {
    await ensureAuditTable();
    const q = String(req.query.q || "").trim().slice(0, 120);
    const scope = req.query.scope === "all" ? "all" : "admins";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const params = [];
    const where = [];

    if (scope === "admins") where.push("p.is_admin = TRUE");
    if (q) {
      params.push(`%${q.replace(/[%_]/g, "\\$&")}%`);
      const idx = params.length;
      const searchParts = [`
        COALESCE(p.name, '') ILIKE $${idx} ESCAPE '\\'
        OR COALESCE(p.email, '') ILIKE $${idx} ESCAPE '\\'
        OR COALESCE(p.phone, '') ILIKE $${idx} ESCAPE '\\'
        OR COALESCE(p.type, '') ILIKE $${idx} ESCAPE '\\'`];
      if (/^\d+$/.test(q)) {
        params.push(q);
        searchParts.push(`OR p.id::text = $${params.length}`);
      }
      where.push(`(${searchParts.join(" ")})`);
    }
    params.push(limit);

    const [providersResult, statsResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT p.id, p.name, p.email, p.phone, p.type, p.is_admin, p.is_moderator,
                p.created_at
           FROM providers p
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY p.is_admin DESC, LOWER(COALESCE(p.name, p.email, '')), p.id
          LIMIT $${params.length}`,
        params
      ),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE is_admin = TRUE)::int AS admins,
               COUNT(*)::int AS providers
          FROM providers
      `),
      pool.query(`
        SELECT e.id, e.action, e.created_at,
               actor.id AS actor_id, actor.name AS actor_name, actor.email AS actor_email,
               target.id AS target_id, target.name AS target_name, target.email AS target_email
          FROM admin_role_events e
          LEFT JOIN providers actor ON actor.id = e.actor_provider_id
          LEFT JOIN providers target ON target.id = e.target_provider_id
         ORDER BY e.created_at DESC
         LIMIT 20
      `),
    ]);

    return res.json({
      currentAdminId: req.platformAdmin.id,
      providers: providersResult.rows,
      stats: statsResult.rows[0],
      events: eventsResult.rows,
    });
  } catch (error) {
    console.error("GET /api/admin/admin-access error:", error);
    return res.status(500).json({ error: "Не удалось загрузить управление администраторами" });
  }
});

router.patch("/admin-access/:id", authenticateToken, requirePlatformAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const makeAdmin = req.body?.is_admin;
  if (!Number.isInteger(targetId) || targetId <= 0 || typeof makeAdmin !== "boolean") {
    return res.status(400).json({ error: "Некорректные параметры" });
  }
  if (targetId === Number(req.platformAdmin.id) && !makeAdmin) {
    return res.status(409).json({ error: "Нельзя снять права администратора у самого себя" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('travella_admin_roles'))");
    await ensureAuditTable(client);

    const targetResult = await client.query(
      "SELECT id, name, email, is_admin FROM providers WHERE id = $1 FOR UPDATE",
      [targetId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Поставщик не найден" });
    }

    if (Boolean(target.is_admin) === makeAdmin) {
      await client.query("COMMIT");
      return res.json({ provider: target, changed: false });
    }

    if (!makeAdmin) {
      const countResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM providers WHERE is_admin = TRUE"
      );
      if (countResult.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Нельзя снять права у последнего администратора" });
      }
    }

    const updatedResult = await client.query(
      `UPDATE providers
          SET is_admin = $1
        WHERE id = $2
      RETURNING id, name, email, phone, type, is_admin, is_moderator, created_at`,
      [makeAdmin, targetId]
    );
    await client.query(
      `INSERT INTO admin_role_events (actor_provider_id, target_provider_id, action)
       VALUES ($1, $2, $3)`,
      [req.platformAdmin.id, targetId, makeAdmin ? "granted" : "revoked"]
    );
    await client.query("COMMIT");

    return res.json({ provider: updatedResult.rows[0], changed: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PATCH /api/admin/admin-access/:id error:", error);
    return res.status(500).json({ error: "Не удалось изменить права администратора" });
  } finally {
    client.release();
  }
});

module.exports = router;
