// backend/controllers/insideController.js
const pool = require("../db");

/** -------- helpers -------- */
const CHAPTERS_ORDER = ["royal", "silence", "modern", "kerala"];
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
  const userId = req.user.id;                  // как вы сейчас берёте id
  const { chapter } = req.body;                // 'royal' | 'silence' | ...
  try {
    const q = `
      INSERT INTO inside_completion_requests (user_id, chapter, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT ON CONSTRAINT uniq_inside_req_user_chapter_pending
      DO NOTHING
      RETURNING id, user_id, chapter, status, requested_at
    `;
    const { rows } = await pool.query(q, [userId, chapter]);

    // если ничего не вернулось — конфликт с существующей PENDING записью
    if (!rows.length) {
      return res.json({ ok: true, already: true });
    }
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Если индекс ещё не создан (42704) — мягкий фолбэк:
    if (err.code === '42704') {
      // проверяем, есть ли уже pending
      const chk = await pool.query(
        `SELECT 1 FROM inside_completion_requests
         WHERE user_id = $1 AND chapter = $2 AND status = 'pending' LIMIT 1`,
        [userId, chapter]
      );
      if (chk.rowCount > 0) return res.json({ ok: true, already: true });

      const ins = await pool.query(
        `INSERT INTO inside_completion_requests (user_id, chapter, status)
         VALUES ($1, $2, 'pending')
         RETURNING id, user_id, chapter, status, requested_at`,
        [userId, chapter]
      );
      return res.json({ ok: true, item: ins.rows[0] });
    }

    console.error('requestCompletion error:', err);
    return res.status(500).json({ error: 'request_failed' });
  }
}


// POST /api/inside/join — клиент вручную присоединяется к программе
async function joinInside(req, res) {
  try {
    const userId =
      req.user?.id ?? req.user?._id ?? req.user?.client_id ?? req.user?.user_id ?? null;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // если уже есть участник — просто вернуть статус
    const exists = await pool.query(
      `SELECT * FROM inside_participants WHERE user_id=$1 LIMIT 1`,
      [userId]
    );
    if (exists.rowCount > 0)
      return res.json(ok({ participant: exists.rows[0], message: "already_joined" }));

    const { rows } = await pool.query(
      `INSERT INTO inside_participants
         (user_id, program_key, current_chapter, progress_current, progress_total, status, curator_telegram)
       VALUES ($1, 'india_inside', $2, 0, $3, 'active', '@akhmedovkb')
       RETURNING *`,
      [userId, CHAPTERS_ORDER[0] || 'royal', PROGRESS_TOTAL_DEFAULT]
    );

    return res.json(ok({ participant: rows[0], message: "joined" }));
  } catch (e) {
    console.error("joinInside error:", e);
    return res.status(500).json({ error: "Failed to join Inside" });
  }
}

// GET /api/inside/my-request  — вернуть последнюю заявку текущего клиента
async function getMyLastRequest(req, res) {
  try {
    const userId =
      req.user?.id ?? req.user?._id ?? req.user?.client_id ?? req.user?.user_id ?? null;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT id, user_id, chapter, status, requested_at, approved_at, rejected_at
         FROM inside_completion_requests
        WHERE user_id = $1
        ORDER BY requested_at DESC
        LIMIT 1`,
      [userId]
    );

    const r = rows[0] || null;
    if (!r) return res.json(null);

    const resolved_at =
      r.status === "approved" ? r.approved_at :
      r.status === "rejected" ? r.rejected_at : null;

    return res.json({ ...r, resolved_at });
  } catch (e) {
    console.error("getMyLastRequest error:", e);
    return res.status(500).json({ error: "Failed to get last request" });
  }
}

/** -------- admin -------- */

// GET /api/admin/inside/requests?status=pending|approved|rejected|all&q=...
async function adminListRequests(req, res) {
  try {
    const limit  = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    // нормализуем статус
    let status = String(req.query.status || "").trim().toLowerCase();
    if (["wait","waiting","expected","ожидают","ожидание"].includes(status)) status = "pending";
    if (!["pending","approved","rejected","all",""].includes(status)) status = ""; // неизвестное → не фильтруем

    const q = String(req.query.q || "").trim();
    const chapter = String(req.query.chapter || "").trim();

    const where = [];
    const params = [];

    if (status && status !== "all") {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }

    if (chapter) {
      params.push(chapter.toLowerCase());
      where.push(`LOWER(r.chapter) = $${params.length}`);
    }

    if (q) {
      // ищем по user_id, имени, телефону, телеграму, главе и статусу
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`
        (
          CAST(r.user_id AS TEXT) ILIKE ${p}
          OR COALESCE(u.name,'') ILIKE ${p}
          OR COALESCE(u.phone,'') ILIKE ${p}
          OR COALESCE(u.telegram,'') ILIKE ${p}
          OR COALESCE(r.chapter,'') ILIKE ${p}
          OR COALESCE(r.status,'') ILIKE ${p}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        r.id,
        r.user_id,
        r.chapter,
        r.status,
        r.requested_at,
        r.approved_at,
        r.rejected_at,
        CASE
          WHEN r.status = 'approved' THEN r.approved_at
          WHEN r.status = 'rejected' THEN r.rejected_at
          ELSE NULL
        END AS resolved_at,
        u.name     AS user_name,
        u.phone    AS user_phone,
        u.telegram AS user_telegram
      FROM inside_completion_requests r
      LEFT JOIN clients u ON u.id = r.user_id
      ${whereSql}
      ORDER BY
        CASE r.status
          WHEN 'pending'  THEN 1
          WHEN 'approved' THEN 2
          WHEN 'rejected' THEN 3
          ELSE 4
        END,
        COALESCE(
          CASE
            WHEN r.status = 'approved' THEN r.approved_at
            WHEN r.status = 'rejected' THEN r.rejected_at
            ELSE NULL
          END,
          r.requested_at
        ) DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `;

    const { rows } = await pool.query(sql, params);

    // total для пагинации (опционально, но полезно)
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM inside_completion_requests r
      LEFT JOIN clients u ON u.id = r.user_id
      ${whereSql}
    `;
    const { rows: countRows } = await pool.query(countSql, params.slice(0, params.length - 2));
    res.json({ items: rows, total: countRows[0]?.total ?? rows.length });
  } catch (err) {
    console.error("adminListRequests error:", err);
    res.status(500).json({ error: "admin_list_failed" });
  }
}


// POST /api/admin/inside/requests/:id/approve { next_chapter? }
async function adminApproveRequest(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const id = Number(req.params.id);
    const { next_chapter, curator_id, curator_note } = req.body || {};
    if (!id) return res.status(400).json({ error: "Bad id" });

    // читаем заявку
    const rq = await pool.query(
      `SELECT id, user_id, chapter, status
         FROM inside_completion_requests
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rq.rowCount) return res.status(404).json({ error: "Not found" });
    const r = rq.rows[0];

    // участник должен существовать
    await ensureParticipant(r.user_id);

    // продвигаем участника
const upd = await pool.query(
  `UPDATE inside_participants
      SET progress_current = LEAST(progress_current + 1, progress_total),
          current_chapter  = CASE
                               -- если куратор выбрал next_chapter в селекте → ставим его
                               WHEN $2 IS NOT NULL AND $2 <> '' THEN $2
                               -- если это самый первый раз и current_chapter пустой → ставим первую главу
                               WHEN current_chapter IS NULL OR current_chapter = '' THEN $3
                               -- иначе главу не трогаем, остаётся та, что была активна
                               ELSE current_chapter
                             END,
          status = CASE
                     WHEN LEAST(progress_current + 1, progress_total) >= progress_total
                       THEN 'completed'
                     ELSE status
                   END,
          updated_at = NOW()
    WHERE user_id = $1
    RETURNING user_id, current_chapter, progress_current, progress_total, status`,
  [
    r.user_id,
    next_chapter || null,
    CHAPTERS_ORDER[0] || "royal",
  ]
);

    // закрываем заявку (без resolved_at!)
    const done = await pool.query(
      `UPDATE inside_completion_requests
          SET status = 'approved',
              approved_at = NOW(),
              curator_id = COALESCE($2, curator_id),
              curator_note = COALESCE($3, curator_note)
        WHERE id = $1
      RETURNING
        id, user_id, chapter, status, requested_at, approved_at, rejected_at,
        curator_id, curator_note,
        CASE
          WHEN status = 'approved' THEN approved_at
          WHEN status = 'rejected' THEN rejected_at
          ELSE NULL
        END AS resolved_at`,
      [id, curator_id || null, curator_note || null]
    );

    return res.json(ok({ request: done.rows[0], participant: upd.rows[0] }));
  } catch (e) {
    console.error("adminApproveRequest error:", e);
    return res.status(500).json({ error: "Failed to approve request" });
  }
}

// POST /api/admin/inside/requests/:id/reject { reason? }
async function adminRejectRequest(req, res) {
  const { id } = req.params;
  const { curator_id, curator_note } = req.body || {};
  try {
    const q = `
      UPDATE inside_completion_requests
      SET status = 'rejected',
          rejected_at = NOW(),
          curator_id = COALESCE($2, curator_id),
          curator_note = COALESCE($3, curator_note)
      WHERE id = $1
      RETURNING
        id, user_id, chapter, status, requested_at, approved_at, rejected_at,
        curator_id, curator_note,
        CASE
          WHEN status = 'approved' THEN approved_at
          WHEN status = 'rejected' THEN rejected_at
          ELSE NULL
        END AS resolved_at
    `;
    const { rows } = await pool.query(q, [id, curator_id || null, curator_note || null]);
    return res.json(rows[0] || {});
  } catch (err) {
    console.error("adminRejectRequest error:", err);
    return res.status(500).json({ error: "admin_reject_failed" });
  }
}
// GET /api/inside/admin/requests?status=pending|approved|rejected|all
// (оставляем только одну реализацию adminListRequests)

// (необязательно, но заодно сделаем участников «человекочитаемыми»)
// GET /api/inside/admin/participants
async function adminListParticipants(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.*,
        COALESCE(c.name, CONCAT('user_id: ', p.user_id)) AS user_name,
        c.telegram AS user_telegram
      FROM inside_participants p
      LEFT JOIN clients c ON c.id = p.user_id
      ORDER BY p.created_at DESC
    `);
    return res.json(rows);
  } catch (e) {
    console.error("adminListParticipants error:", e);
    return res.status(500).json({ error: "Failed to list participants" });
  }
}

module.exports = {
  // client/public
  getInsideMe,
  getInsideById,
  getInsideStatus,
  requestCompletion,
  joinInside,
  getMyLastRequest,
  // admin
  adminListRequests,
  adminApproveRequest,
  adminRejectRequest,
  adminListParticipants,
};
