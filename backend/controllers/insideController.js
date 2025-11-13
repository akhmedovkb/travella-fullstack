//backend/controllers/insideController.js
const pool = require("../db");

exports.getMe = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const q = await pool.query(
    "select * from inside_participants where user_id=$1",
    [userId]
  );
  if (!q.rows.length) {
    return res.json({ status: "none" }); // не участник
  }
  const row = q.rows[0];
  res.json({
    status: row.status,
    program_key: row.program_key,
    current_chapter: row.current_chapter,
    progress_current: row.progress_current,
    progress_total: row.progress_total,
    curator_telegram: row.curator_telegram
  });
};

exports.requestCompletion = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const chapter = req.body?.chapter || null;

  await pool.query(
    "insert into inside_completion_requests(user_id, chapter) values ($1,$2)",
    [userId, chapter]
  );

  // TODO: уведомить куратора (бот/почта/вебхуки)
  res.json({ ok: true });
};

// (опционально) для админки — подтверждение
exports.approveCompletion = async (req, res) => {
  const { userId, chapter } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId_required" });

  await pool.query(
    "update inside_completion_requests set status='approved' where user_id=$1 and status='pending'",
    [userId]
  );

  // инкремент прогресса
  const r = await pool.query(
    "update inside_participants set progress_current = least(progress_current + 1, progress_total), current_chapter=$2 where user_id=$1 returning *",
    [userId, chapter || 'royal']
  );

  res.json({ ok: true, participant: r.rows[0] || null });
};
