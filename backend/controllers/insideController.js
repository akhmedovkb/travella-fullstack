// backend/controllers/insideController.js

/**
 * Простейший контроллер для India Inside.
 * Сейчас без БД: возвращает дефолтные значения, чтобы фронт работал стабильно.
 * Позже можно заменить на реальные SELECT/UPDATE.
 */

// Универсальный ответ "ничего не найдено"
function none() {
  return { status: "none" };
}

// GET /api/inside/me
async function getInsideMe(req, res) {
  try {
    // если используешь authenticateToken и req.user доступен
    const userId =
      req.user?.id ||
      req.user?._id ||
      req.user?.client_id ||
      req.user?.user_id ||
      null;

    if (!userId) {
      // без авторизации просто говорим, что статуса нет
      return res.json(none());
    }

    // Здесь мог бы быть SELECT по userId…
    // Пока возвращаем «активную» программу-заглушку:
    return res.json({
      status: "active",
      progress_current: 1,
      progress_total: 4,
      current_chapter: "royal",        // ключ главы (см. фронт)
      curator_telegram: "@akhmedovkb", // контакт куратора
      user_id: userId,
    });
  } catch (e) {
    console.error("getInsideMe error:", e);
    return res.status(500).json({ error: "Failed to get Inside status" });
  }
}

// GET /api/inside/:userId
async function getInsideById(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.json(none());

    // Здесь мог бы быть SELECT по userId…
    // Отдаём ту же заглушку, что и выше:
    return res.json({
      status: "active",
      progress_current: 1,
      progress_total: 4,
      current_chapter: "royal",
      curator_telegram: "@akhmedovkb",
      user_id: userId,
    });
  } catch (e) {
    console.error("getInsideById error:", e);
    return res.status(500).json({ error: "Failed to get Inside status by id" });
  }
}

// GET /api/inside/ (универсальный статус, без auth)
async function getInsideStatus(_req, res) {
  try {
    // Публичная точка — по умолчанию говорим, что статуса нет.
    return res.json(none());
  } catch (e) {
    console.error("getInsideStatus error:", e);
    return res.status(500).json({ error: "Failed to get Inside status (public)" });
  }
}

// POST /api/inside/request-completion — запросить завершение текущей главы
async function requestCompletion(req, res) {
  try {
    const { chapter } = req.body || {};
    // Здесь мог бы быть INSERT заявки в БД и нотификация куратора в Telegram
    console.log("[Inside] completion requested for chapter:", chapter);
    return res.json({ ok: true, requested: true });
  } catch (e) {
    console.error("requestCompletion error:", e);
    return res.status(500).json({ error: "Failed to request completion" });
  }
}

module.exports = {
  getInsideMe,
  getInsideById,
  getInsideStatus,
  requestCompletion,
};
