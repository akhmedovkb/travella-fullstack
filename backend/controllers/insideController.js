// backend/controllers/insideController.js
// Можно подключить БД при необходимости:
// const pool = require("../db");

// Небольшой helper, чтобы не дублировать try/catch
const ok = (res, data = {}) => res.json(data);
const bad = (res, code = 400, msg = "Bad request") => res.status(code).json({ error: msg });

/** Собираем userId из разных мест (auth мидлвара может класть по-разному) */
function resolveUserId(req) {
  return (
    req.user?.id ||
    req.userId ||
    req.auth?.id ||
    req.params?.userId ||
    req.query?.userId ||
    null
  );
}

/** Базовый ответ о программе (пока статичный; при желании подключи БД) */
function buildInsidePayload(userId) {
  // Тут можно сделать SELECT из таблицы inside_progress:
  // const row = await pool.query('SELECT ... WHERE user_id=$1',[userId])
  return {
    status: "active",           // "none" | "active" | "paused" | ...
    progress_current: 1,
    progress_total: 4,
    current_chapter: "royal",   // "royal" | "silence" | "modern" | "kerala"
    curator_telegram: "@akhmedovkb",
    user_id: userId ?? null,
  };
}

exports.getInsideMe = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    // Если нет авторизации — можно вернуть "none"
    if (!userId) return ok(res, { status: "none" });
    return ok(res, buildInsidePayload(userId));
  } catch (e) {
    return bad(res, 500, "inside_me_failed");
  }
};

exports.getInsideById = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return bad(res, 400, "user_id_required");
    return ok(res, buildInsidePayload(userId));
  } catch (e) {
    return bad(res, 500, "inside_by_id_failed");
  }
};

exports.getInsideStatus = async (_req, res) => {
  try {
    // Для публичных запросов можно вернуть общий статус или "none"
    return ok(res, { status: "none" });
  } catch (e) {
    return bad(res, 500, "inside_status_failed");
  }
};

exports.requestCompletion = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const { chapter } = req.body || {};
    if (!chapter) return bad(res, 400, "chapter_required");

    // Здесь можно:
    // 1) записать заявку в БД
    // 2) отправить уведомление куратору в Telegram
    // await pool.query('INSERT INTO inside_completion_requests ...');
    // await sendTelegramToCurator(...);

    return ok(res, { ok: true, requested: true, chapter, user_id: userId ?? null });
  } catch (e) {
    return bad(res, 500, "request_completion_failed");
  }
};
