// backend/controllers/insideController.js
const pool = require("../db");

// Порядок глав — для повышения прогресса
const CHAPTERS = ["royal", "silence", "modern", "kerala"];

// Опциональная отправка в Telegram
async function sendTg(text) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || "";
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CURATOR_CHAT_ID || "";
    if (!token || !chat) {
      console.log("[Inside][TG skipped] ", text);
      return;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("[Inside][TG error]", e);
  }
}

// Универсальный ответ "ничего не найдено"
function none() {
  return { status: "none" };
}

// ---------- HELPERS ----------
function rowToParticipant(p) {
  if (!p) return null;
  return {
    status: p.status || "active",
    progress_current: Number(p.progress_current || 0),
    progress_total: Number(p.progress_total || 4),
    current_chapter: p.current_chapter || CHAPTERS[0],
    curator_telegram: p.curator_telegram || "@akhmedovkb",
    user_id: Number(p.user_id),
    program_key: p.program_key || "india_inside",
  };
}

async function getParticipantByUserId(userId) {
  const { rows } = await pool.query(
    "select * from inside_participants where user_id = $1 limit 1",
    [userId]
  );
  return rowToParticipant(rows[0]);
}

async function upsertParticipantProgress(userId, nextIdx /* 0-based index */) {
  const nextChapter = CHAPTERS[nextIdx] || CHAPTERS[CHAPTERS.length - 1];
  const total = CHAPTERS.length;
  const current = Math.min(nextIdx + 1, total);
  const isCompleted = current >= total;

  const sql = `
    insert into inside_participants (user_id, program_key, current_chapter, progress_current, progress_total, status)
    values ($1, 'india_inside', $2, $3, $4, $5)
    on conflict (user_id) do update
      set current_chapter = excluded.current_chapter,
          progress_current = excluded.progress_current,
          progress_total = excluded.progress_total,
          status = excluded.status,
          updated_at = now()
    returning *;
  `;
  const { rows } = await pool.query(sql, [
    userId,
    nextChapter,
    current,
    total,
    isCompleted ? "completed" : "active",
  ]);
  return rowToParticipant(rows[0]);
}

// ---------- PUBLIC (Client) ----------

// GET /api/inside/me
async function getInsideMe(req, res) {
  try {
    const userId =
      req.user?.id ||
      req.user?._id ||
      req.user?.client_id ||
      req.user?.user_id ||
      null;

    if (!userId) return res.json(none());

    // сначала пробуем БД
    const p = await getParticipantByUserId(userId);
    if (p) return res.json(p);

    // мягкая заглушка (как было)
    return res.json({
      status: "active",
      progress_current: 1,
      progress_total: 4,
      current_chapter: "royal",
      curator_telegram: "@akhmedovkb",
      user_id: userId,
    });
  } catch (e) {
    console.error("getInsideMe error:", e);
    return res.status(500).json({ error: "Failed to get Inside status" });
  }
}

// GET /api/inside/user/:userId
async function getInsideById(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.json(none());

    const numeric = Number(userId);
    const uid = Number.isFinite(numeric) ? numeric : userId;

    const p = await getParticipantByUserId(uid);
    if (p) return res.json(p);

    // как и выше — мягкая заглушка
    return res.json({
      status: "active",
      progress_current: 1,
      progress_total: 4,
      current_chapter: "royal",
      curator_telegram: "@akhmedovkb",
      user_id: uid,
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
    const { chapter } = req.body || {};
    const userId =
      req.user?.id ||
      req.user?._id ||
      req.user?.client_id ||
      req.user?.user_id ||
      null;

    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!chapter) return res.status(400).json({ error: "chapter_required" });

    // создаём pending-заявку, если аналогичная не висит
    await pool.query(
      `insert into inside_completion_requests (user_id, chapter, status)
       values ($1,$2,'pending')
       on conflict (user_id, chapter) where status='pending'
       do nothing`,
      [userId, chapter]
    );

    // уведомление куратору (опционально)
    await sendTg(
      `🧭 <b>India Inside</b>\nЗаявка на завершение главы <b>${chapter}</b>\nuser_id: <code>${userId}</code>`
    );

    return res.json({ ok: true, requested: true });
  } catch (e) {
    console.error("requestCompletion error:", e);
    return res.status(500).json({ error: "Failed to request completion" });
  }
}

// ---------- ADMIN ----------

// GET /api/inside/admin/requests?status=pending|approved|rejected
async function adminListRequests(req, res) {
  try {
    const status = (req.query.status || "pending").toLowerCase();
    const { rows } = await pool.query(
      `select * from inside_completion_requests
       where ($1 = 'all' or status = $1)
       order by created_at desc
       limit 500`,
      [status === "all" ? "all" : status]
    );
    res.json(rows);
  } catch (e) {
    console.error("adminListRequests error:", e);
    res.status(500).json({ error: "Failed to list requests" });
  }
}

// POST /api/inside/admin/requests/:id/approve  { next_chapter?: "silence" }
async function adminApproveRequest(req, res) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { next_chapter } = req.body || {};
    await client.query("begin");

    const { rows } = await client.query(
      "select * from inside_completion_requests where id=$1 for update",
      [id]
    );
    const reqRow = rows[0];
    if (!reqRow) {
      await client.query("rollback");
      return res.status(404).json({ error: "request_not_found" });
    }
    if (reqRow.status !== "pending") {
      await client.query("rollback");
      return res.status(409).json({ error: "already_decided" });
    }

    // помечаем как approved
    await client.query(
      "update inside_completion_requests set status='approved', decided_at=now() where id=$1",
      [id]
    );

    // двигаем прогресс пользователя
    const userId = reqRow.user_id;
    const participant = await getParticipantByUserId(userId);
    const currentIdx = Math.max(
      0,
      CHAPTERS.indexOf(participant?.current_chapter || "royal")
    );

    // если явно указали next_chapter — используем его индекс
    let nextIdx =
      typeof next_chapter === "string" && CHAPTERS.includes(next_chapter)
        ? CHAPTERS.indexOf(next_chapter)
        : currentIdx + 1;

    if (nextIdx >= CHAPTERS.length) nextIdx = CHAPTERS.length - 1;

    const updated = await upsertParticipantProgress(userId, nextIdx);

    await client.query("commit");

    // уведомление (опционально)
    await sendTg(
      `✅ <b>Глава подтверждена</b>\nuser_id: <code>${userId}</code>\ncurrent: <b>${updated.current_chapter}</b>\nprogress: ${updated.progress_current}/${updated.progress_total}\nstatus: ${updated.status}`
    );

    res.json({ ok: true, participant: updated });
  } catch (e) {
    await pool.query("rollback");
    console.error("adminApproveRequest error:", e);
    res.status(500).json({ error: "Failed to approve request" });
  } finally {
    try { client.release(); } catch {}
  }
}

// POST /api/inside/admin/requests/:id/reject
async function adminRejectRequest(req, res) {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(
      "update inside_completion_requests set status='rejected', decided_at=now() where id=$1 and status='pending'",
      [id]
    );
    if (rowCount === 0) return res.status(409).json({ error: "already_decided_or_missing" });

    await sendTg(`⛔️ Заявка отклонена\nid: ${id}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("adminRejectRequest error:", e);
    res.status(500).json({ error: "Failed to reject request" });
  }
}

// (опционально) — если понадобится админ-CRUD по участникам
async function adminListParticipants(_req, res) {
  try {
    const { rows } = await pool.query(
      "select * from inside_participants order by created_at desc limit 500"
    );
    res.json(rows);
  } catch (e) {
    console.error("adminListParticipants error:", e);
    res.status(500).json({ error: "Failed to list participants" });
  }
}
async function adminCreateParticipant(req, res) {
  try {
    const { user_id, current_chapter = CHAPTERS[0] } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id_required" });

    const idx = Math.max(0, CHAPTERS.indexOf(current_chapter));
    const p = await upsertParticipantProgress(user_id, idx);
    res.json(p);
  } catch (e) {
    console.error("adminCreateParticipant error:", e);
    res.status(500).json({ error: "Failed to create participant" });
  }
}
async function adminUpdateParticipant(req, res) {
  try {
    const id = Number(req.params.id); // row id, не user_id
    const { rows: byRow } = await pool.query(
      "select * from inside_participants where id=$1",
      [id]
    );
    const row = byRow[0];
    if (!row) return res.status(404).json({ error: "not_found" });

    const { current_chapter } = req.body || {};
    const idx =
      typeof current_chapter === "string" && CHAPTERS.includes(current_chapter)
        ? CHAPTERS.indexOf(current_chapter)
        : Math.max(0, CHAPTERS.indexOf(row.current_chapter || CHAPTERS[0]));

    const p = await upsertParticipantProgress(row.user_id, idx);
    res.json(p);
  } catch (e) {
    console.error("adminUpdateParticipant error:", e);
    res.status(500).json({ error: "Failed to update participant" });
  }
}

module.exports = {
  // client
  getInsideMe,
  getInsideById,
  getInsideStatus,
  requestCompletion,

  // admin
  adminListRequests,
  adminApproveRequest,
  adminRejectRequest,

  adminListParticipants,
  adminCreateParticipant,
  adminUpdateParticipant,
};
