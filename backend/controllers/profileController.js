//backend/controllers/profileController.js   небольшой публичный эндпоинт профиля клиента
const db = require("../db");

/**
 * GET /api/profile/client/:id
 * Публичный профиль клиента: name, phone, telegram, avatar (если есть).
 * Никаких правок БД не требует, работает "мягко":
 * - читает clients;
 * - пытается достать аватар из users (если таблица/колонки есть);
 * - не падает, если колонок нет.
 */
exports.getClientPublicProfile = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const c = await db.query(
      `SELECT id, name, email, phone, telegram
         FROM clients
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!c.rowCount) return res.status(404).json({ error: "not_found" });

    const client = c.rows[0];
    let avatar = null;

    // попробовать users.avatar_url/photo_url/avatar
    try {
      const u = await db.query(
        `SELECT
           COALESCE(avatar_url, photo_url, avatar) AS avatar
         FROM users
        WHERE id = $1
        LIMIT 1`,
        [id]
      );
      if (u.rowCount) avatar = u.rows[0].avatar || null;
    } catch (_) {
      /* игнорируем, если таблицы/колонок нет */
    }

    // попытка достать из clients (если у вас есть такие поля)
    if (!avatar) {
      try {
        const a = await db.query(
          `SELECT COALESCE(avatar_url, photo_url, avatar) AS avatar
             FROM clients
            WHERE id = $1
            LIMIT 1`,
          [id]
        );
        if (a.rowCount) avatar = a.rows[0].avatar || null;
      } catch (_) {}
    }

    return res.json({
      id: client.id,
      name: client.name || null,
      email: client.email || null,
      phone: client.phone || null,
      telegram: client.telegram || null,
      avatar: avatar || null,
    });
  } catch (e) {
    console.error("getClientPublicProfile error:", e);
    return res.status(500).json({ error: "profile_load_failed" });
  }
};
