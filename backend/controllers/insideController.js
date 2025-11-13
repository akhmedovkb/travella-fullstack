// backend/controllers/insideController.js
const pool = require("../db");

/** -------- helpers -------- */
const CHAPTERS_ORDER = ["royal", "gold_triangle", "jaipur", "guru"]; // при желании под себя
const PROGRESS_TOTAL_DEFAULT = 4;

function ok(data = {}) { return { ok: true, ...data }; }
function none() { return { status: "none" }; }

async function ensureParticipant(userId) {
  // создаем участника, если его нет
  await pool.query(
    `INSERT INTO inside_participants (user_id)
     SELECT $1
     WHERE NOT EXISTS (SELECT 1 FROM inside_participants WHERE user_id = $1)`,
    [userId]
  );
}

function nextChapterKey(current) {
  const i = CHAPTERS_ORDER.indexOf(String(current || "").toLowerCase());
  if (i < 0) return CHAPTERS_ORDER[0] || null;
  return CHAPTERS_ORDER[i + 1] || CHAPTERS_ORDER[i] || null;
}

/** -------- client/public -------- */

// GET /api/inside/me
async function getInsideMe(req, res) {
  try {
    const userId =
      req.user?.id ?? req.user?._id ?? req.user?.client_id ?? req.user?.user_id ?? null;
    if (!userId) return res.json(none());

    const { rows } = await pool.query(
      `SELECT user_id, program_key, current_chapter, progress_current, progress_total,
              curator_telegram, status
       FROM inside_participants
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.json(none());

    const p = rows[0];
    return res.json({
      status: p.status || "active",
      progress_current: Number(p.progress_current || 0),
      progress_total: Number(p.progress_total || PROGRESS_TOTAL_DEFAULT),
      current_chapter: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
      curator_telegram: p.curator_telegram || "@akhmedovkb",
      user_id: p.user_id,
      program_key: p.program_key || "india_inside",
    });
  } catch (e) {
    console.error("getInsideMe error:", e);
    return res.status(500).json({ error: "Failed to get Inside status" });
  }
}

// GET /api/inside/:userId
async function getInsideById(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.json(none());

    const { rows } = await pool.query(
      `SELECT user_id, program_key, current_chapter, progress_current, progress_total,
              curator_telegram, status
       FROM inside_participants
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.json(none());

    const p = rows[0];
    return res.json({
      status: p.status || "active",
      progress_current: Number(p.progress_current || 0),
      progress_total: Number(p.progress_total || PROGRESS_TOTAL_DEFAULT),
      current_chapter: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
      curator_telegram: p.curator_telegram || "@akhmedovkb",
      user_id: p.user_id,
      program_key: p.program_key || "india_inside",
    });
  } catch (e) {
    console.error("getInsideById error:", e);
    return res.status(500).json({ error: "Failed to get Inside status by id" });
  }
}

// GET /api/inside/
async function getInsideStatus(_req, res) {
  try {
    return res.json(none());
  } catch (e) {
    console.error("getInsideStatus error:", e);
    return res.status(500).json({ error: "Failed to get Inside status (public)" });
  }
}

// POST /api/inside/request-completion
async function requestCompletion(req, res) {
  try {
    const userId =
      req.user?.id ?? req.user?._id ?? req.user?.client_id ?? req.user?.user_id ?? null;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { chapter } = req.body || {};
    await ensureParticipant(userId);

    const { rows } = await pool.query(
      `INSERT INTO inside_completion_requests (user_id, chapter, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, user_id, chapter, status, created_at`,
      [userId, chapter || null]
    );

    return res.json(ok({ request: rows[0] }));
  } catch (e) {
    console.error("requestCompletion error:", e);
    return res.status(500).json({ error: "Failed to request completion" });
  }
}

/** -------- admin -------- */

// GET /api/admin/inside/requests?status=pending|approved|rejected|all&q=...
async function adminListRequests(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator)
      return res.status(403).json({ error: "Forbidden" });

    const status = String(req.query.status || "pending").toLowerCase();
    const q = String(req.query.q || "").trim();

    const params = [];
    let where = "1=1";
    if (["pending", "approved", "rejected"].includes(status)) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (CAST(r.user_id AS TEXT) ILIKE $${params.length} OR COALESCE(r.chapter,'') ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT r.id, r.user_id, r.chapter, r.status, r.created_at, r.resolved_at, r.resolution,
              c.name   AS client_name,
              p.name   AS provider_name
       FROM inside_completion_requests r
       LEFT JOIN clients   c ON c.id = r.user_id
       LEFT JOIN providers p ON p.id = r.user_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT 500`,
      params
    );

    return res.json({ items: rows });
  } catch (e) {
    console.error("adminListRequests error:", e);
    return res.status(500).json({ error: "Failed to list requests" });
  }
}

// POST /api/admin/inside/requests/:id/approve { next_chapter? }
async function adminApproveRequest(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator)
      return res.status(403).json({ error: "Forbidden" });

    const id = Number(req.params.id);
    const { next_chapter } = req.body || {};
    if (!id) return res.status(400).json({ error: "Bad id" });

    // прочитаем заявку
    const rq = await pool.query(
      `SELECT id, user_id, chapter, status FROM inside_completion_requests WHERE id=$1 LIMIT 1`,
      [id]
    );
    if (!rq.rowCount) return res.status(404).json({ error: "Not found" });
    const r = rq.rows[0];

    // Обновляем участника: +1 прогресс, глава → next_chapter (если задан) или авто
    await ensureParticipant(r.user_id);

    const upd = await pool.query(
      `UPDATE inside_participants
         SET progress_current = LEAST(progress_current + 1, progress_total),
             current_chapter  = COALESCE($2,
                                   CASE
                                     WHEN current_chapter IS NULL OR current_chapter = '' THEN $3
                                     ELSE $4
                                   END
                                 ),
             status = CASE
                        WHEN LEAST(progress_current + 1, progress_total) >= progress_total THEN 'completed'
                        ELSE status
                      END,
             updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, current_chapter, progress_current, progress_total, status`,
      [
        r.user_id,
        next_chapter || null,
        CHAPTERS_ORDER[0] || "royal",
        nextChapterKey(r.chapter),
      ]
    );

    // Закрываем заявку
    const rqDone = await pool.query(
      `UPDATE inside_completion_requests
         SET status='approved', resolved_at=NOW(), resolution=NULL
       WHERE id=$1
       RETURNING *`,
      [id]
    );

    return res.json(ok({ request: rqDone.rows[0], participant: upd.rows[0] }));
  } catch (e) {
    console.error("adminApproveRequest error:", e);
    return res.status(500).json({ error: "Failed to approve request" });
  }
}

// POST /api/admin/inside/requests/:id/reject { reason? }
async function adminRejectRequest(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator)
      return res.status(403).json({ error: "Forbidden" });

    const id = Number(req.params.id);
    const { reason } = req.body || {};
    if (!id) return res.status(400).json({ error: "Bad id" });

    const rqDone = await pool.query(
      `UPDATE inside_completion_requests
         SET status='rejected', resolved_at=NOW(), resolution = COALESCE($2,'')
       WHERE id=$1
       RETURNING *`,
      [id, reason || null]
    );

    return res.json(ok({ request: rqDone.rows[0] }));
  } catch (e) {
    console.error("adminRejectRequest error:", e);
    return res.status(500).json({ error: "Failed to reject request" });
  }
}

module.exports = {
  // client/public
  getInsideMe,
  getInsideById,
  getInsideStatus,
  requestCompletion,
  // admin
  adminListRequests,
  adminApproveRequest,
  adminRejectRequest,
};
