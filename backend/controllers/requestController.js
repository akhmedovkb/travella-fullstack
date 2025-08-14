// backend/controllers/requestController.js
const pool = require("../db");

/**
 * Определяет timestamp истечения актуальности заявки
 */
function getExpirationTs(service) {
  if (!service) return null;
  const d = service.details || {};

  // 1. Если есть details.expiration — используем его
  if (d.expiration) {
    const ts = Date.parse(d.expiration);
    if (!isNaN(ts)) return ts;
  }

  // 2. Для авиабилетов
  if (service.category === "refused_flight") {
    if (d.returnDate) {
      const ts = Date.parse(d.returnDate);
      if (!isNaN(ts)) return ts;
    }
    if (d.startDate) {
      const ts = Date.parse(d.startDate);
      if (!isNaN(ts)) return ts;
    }
  }

  // 3. Для отелей
  if (service.category === "refused_hotel" && d.endDate) {
    const ts = Date.parse(d.endDate);
    if (!isNaN(ts)) return ts;
  }

  // 4. Для туров / событий
  if (
    (service.category === "refused_tour" ||
      service.category === "author_tour" ||
      service.category === "refused_event") &&
    (d.endDate || d.startDate)
  ) {
    const ts = Date.parse(d.endDate || d.startDate);
    if (!isNaN(ts)) return ts;
  }

  // 5. TTL = 30 дней от создания
  if (service.created_at) {
    const ts = new Date(service.created_at).getTime() + 30 * 24 * 60 * 60 * 1000;
    return ts;
  }

  return null;
}

/**
 * Автоочистка заявок
 */
async function autoCleanup(providerId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, s.category, s.details, s.created_at as service_created_at
     FROM requests r
     JOIN services s ON s.id = r.service_id
     WHERE r.provider_id = $1`,
    [providerId]
  );

  const now = Date.now();
  const expiredIds = [];

  for (const row of rows) {
    let details;
    try {
      details = typeof row.details === "string" ? JSON.parse(row.details) : row.details || {};
    } catch {
      details = {};
    }

    const expTs = getExpirationTs({
      category: row.category,
      details,
      created_at: row.service_created_at,
    });

    if (expTs && expTs < now) {
      expiredIds.push(row.id);
    }
  }

  if (expiredIds.length > 0) {
    console.log("Auto-cleanup expired requests:", expiredIds);
    await pool.query(`DELETE FROM requests WHERE id = ANY($1::int[])`, [expiredIds]);
  }
}

/**
 * GET /api/requests/provider — входящие заявки
 */
exports.getProviderRequests = async (req, res) => {
  try {
    const providerId = req.user.id;

    // Автоочистка
    await autoCleanup(providerId);

    const { rows } = await pool.query(
      `SELECT r.*, 
              json_build_object('id', s.id, 'title', s.title, 'category', s.category, 'details', s.details) as service,
              json_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'telegram', c.telegram) as client
       FROM requests r
       JOIN services s ON s.id = r.service_id
       JOIN clients c ON c.id = r.client_id
       WHERE r.provider_id = $1
       ORDER BY r.created_at DESC`,
      [providerId]
    );

    res.json({ items: rows });
  } catch (err) {
    console.error("Ошибка получения заявок поставщика:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
};

/**
 * PATCH /api/requests/:id/status — отметить как обработано
 */
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await pool.query(
      `UPDATE requests SET status = $1 WHERE id = $2 AND provider_id = $3`,
      [status, id, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка обновления статуса заявки:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
};

/**
 * DELETE /api/requests/:id — удалить вручную
 */
exports.deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM requests WHERE id = $1 AND provider_id = $2`, [
      id,
      req.user.id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка удаления заявки:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
};
