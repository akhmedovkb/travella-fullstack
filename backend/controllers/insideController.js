// backend/controllers/insideController.js
const pool = require("../db");

/* ===== Helpers ===== */
async function getParticipantByUser(userId) {
  const { rows } = await pool.query(
    "select * from inside_participants where user_id=$1 order by id desc limit 1",
    [userId]
  );
  return rows[0] || null;
}

/* ===== Public (client) ===== */

// GET /api/inside/me
exports.getMe = async (req, res) => {
  try {
    const uid = req.user?.id || req.user?.user_id || req.user?.client_id;
    if (!uid) return res.json({ status: "none" });
    const p = await getParticipantByUser(uid);
    if (!p) return res.json({ status: "none" });
    res.json({
      status: p.status,
      current_chapter: p.current_chapter,
      progress_current: p.progress_current,
      progress_total: p.progress_total,
      curator_telegram: p.curator_telegram
    });
  } catch (e) {
    res.status(500).json({ error: "inside_me_failed" });
  }
};

// POST /api/inside/request-completion  {chapter}
exports.requestCompletion = async (req, res) => {
  try {
    const uid = req.user?.id || req.user?.user_id || req.user?.client_id;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const chapter = String(req.body.chapter || "royal");
    await pool.query(
      "insert into inside_completion_requests (user_id, chapter_key, status) values ($1,$2,'pending')",
      [uid, chapter]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "request_completion_failed" });
  }
};

/* ===== Admin ===== */

// GET /api/admin/inside/participants?status=&q=
exports.adminListParticipants = async (req, res) => {
  try {
    const { status, q } = req.query;
    const params = [];
    let where = "1=1";
    if (status) { params.push(status); where += ` and status=$${params.length}`; }
    if (q) {
      params.push(`%${q}%`);
      where += ` and (cast(user_id as text) ilike $${params.length} or current_chapter ilike $${params.length})`;
    }
    const { rows } = await pool.query(
      `select * from inside_participants where ${where} order by updated_at desc limit 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "admin_list_participants_failed" });
  }
};

// POST /api/admin/inside/participants
// body: { user_id, current_chapter?, progress_current?, progress_total?, curator_telegram?, status? }
exports.adminCreateParticipant = async (req, res) => {
  try {
    const {
      user_id,
      current_chapter = "royal",
      progress_current = 0,
      progress_total = 4,
      curator_telegram = null,
      status = "active",
    } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id_required" });
    const { rows } = await pool.query(
      `insert into inside_participants 
        (user_id, current_chapter, progress_current, progress_total, curator_telegram, status)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [user_id, current_chapter, progress_current, progress_total, curator_telegram, status]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "admin_create_participant_failed" });
  }
};

// PUT /api/admin/inside/participants/:id
exports.adminUpdateParticipant = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id_required" });
    const fields = ["current_chapter","progress_current","progress_total","curator_telegram","status"];
    const sets = [];
    const params = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f}=$${params.length}`);
      }
    });
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    params.push(id);
    const { rows } = await pool.query(
      `update inside_participants set ${sets.join(", ")}, updated_at=now() where id=$${params.length} returning *`,
      params
    );
    res.json(rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: "admin_update_participant_failed" });
  }
};

// GET /api/admin/inside/requests?status=pending
exports.adminListRequests = async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const { rows } = await pool.query(
      "select * from inside_completion_requests where status=$1 order by created_at desc limit 500",
      [status]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "admin_list_requests_failed" });
  }
};

// POST /api/admin/inside/requests/:id/approve  {next_chapter?}
exports.adminApproveRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const adminId = req.user?.id || 0;
    await client.query("begin");
    const rq = await client.query("select * from inside_completion_requests where id=$1 for update", [id]);
    const r = rq.rows[0];
    if (!r) { await client.query("rollback"); return res.status(404).json({ error: "not_found" }); }
    if (r.status !== "pending") { await client.query("rollback"); return res.status(400).json({ error: "not_pending" }); }

    // move participant progress + chapter
    const partQ = await client.query(
      "select * from inside_participants where user_id=$1 order by id desc limit 1 for update",
      [r.user_id]
    );
    let p = partQ.rows[0];
    if (!p) {
      const ins = await client.query(
        `insert into inside_participants (user_id, current_chapter, progress_current, progress_total, status)
         values ($1,$2,1,4,'active') returning *`,
        [r.user_id, req.body?.next_chapter || r.chapter_key]
      );
      p = ins.rows[0];
    } else {
      const nextVal = Number(p.progress_current || 0) + 1;
      const nextChapter = req.body?.next_chapter || p.current_chapter;
      const up = await client.query(
        `update inside_participants
         set progress_current=$1, current_chapter=$2, updated_at=now() where id=$3 returning *`,
        [nextVal, nextChapter, p.id]
      );
      p = up.rows[0];
    }

    await client.query(
      "update inside_completion_requests set status='approved', resolved_at=now(), resolved_by=$1 where id=$2",
      [adminId, id]
    );

    await client.query("commit");
    res.json({ ok: true, participant: p });
  } catch (e) {
    await pool.query("rollback");
    res.status(500).json({ error: "admin_approve_failed" });
  } finally {
    client.release();
  }
};

// POST /api/admin/inside/requests/:id/reject
exports.adminRejectRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminId = req.user?.id || 0;
    await pool.query(
      "update inside_completion_requests set status='rejected', resolved_at=now(), resolved_by=$1 where id=$2 and status='pending'",
      [adminId, id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "admin_reject_failed" });
  }
};
