// backend/controllers/requestController.js
const pool = require("../db");

/**
 * Helper: получить provider_id услуги
 */
async function getServiceProvider(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id=$1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

/**
 * POST /api/requests
 * Body: { serviceId, text }
 * Роль: client
 */
exports.createRequest = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only clients can create requests" });
    }
    const clientId = req.user.id;
    const { serviceId, text } = req.body;
    if (!serviceId || !text) return res.status(400).json({ message: "serviceId and text required" });

    const providerId = await getServiceProvider(serviceId);
    if (!providerId) return res.status(404).json({ message: "Service not found" });

    // Создаём change_request + первое сообщение
    const r = await pool.query(
      `INSERT INTO change_requests (service_id, client_id, provider_id, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id, service_id, client_id, provider_id, status, proposal, created_at, updated_at`,
      [serviceId, clientId, providerId]
    );

    const requestId = r.rows[0].id;
    await pool.query(
      `INSERT INTO change_request_messages (request_id, sender_role, sender_id, text)
       VALUES ($1, 'client', $2, $3)`,
      [requestId, clientId, text]
    );

    // Вернём с сообщениями
    const messages = await pool.query(
      `SELECT id, sender_role, sender_id, text, created_at
       FROM change_request_messages WHERE request_id=$1 ORDER BY id ASC`,
      [requestId]
    );

    return res.status(201).json({ ...r.rows[0], messages: messages.rows });
  } catch (err) {
    console.error("createRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/requests/my
 * Роль: client — мои запросы; provider — запросы по моим услугам
 */
exports.listMyRequests = async (req, res) => {
  try {
    const role = req.user?.role;
    const id = req.user?.id;

    if (role === "client") {
      const q = await pool.query(
        `SELECT r.*, 
                (SELECT json_agg(m ORDER BY m.id ASC)
                 FROM change_request_messages m WHERE m.request_id=r.id) AS messages
         FROM change_requests r
         WHERE r.client_id=$1
         ORDER BY r.id DESC`,
        [id]
      );
      return res.json(q.rows);
    }

    if (role === "provider") {
      const q = await pool.query(
        `SELECT r.*, 
                (SELECT json_agg(m ORDER BY m.id ASC)
                 FROM change_request_messages m WHERE m.request_id=r.id) AS messages
         FROM change_requests r
         WHERE r.provider_id=$1
         ORDER BY r.id DESC`,
        [id]
      );
      return res.json(q.rows);
    }

    return res.status(403).json({ message: "Unauthorized role" });
  } catch (err) {
    console.error("listMyRequests error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/requests/:id/reply
 * Body: { text }
 * Роль: client или provider
 */
exports.reply = async (req, res) => {
  try {
    const role = req.user?.role;
    const senderId = req.user?.id;
    const requestId = req.params.id;
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "text required" });

    // Проверка доступа: участник ли?
    const r = await pool.query(
      `SELECT client_id, provider_id FROM change_requests WHERE id=$1`,
      [requestId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Request not found" });

    const { client_id, provider_id } = r.rows[0];
    if (
      (role === "client" && senderId !== client_id) ||
      (role === "provider" && senderId !== provider_id)
    ) {
      return res.status(403).json({ message: "Not a participant" });
    }

    await pool.query(
      `INSERT INTO change_request_messages (request_id, sender_role, sender_id, text)
       VALUES ($1, $2, $3, $4)`,
      [requestId, role, senderId, text]
    );

    const messages = await pool.query(
      `SELECT id, sender_role, sender_id, text, created_at
       FROM change_request_messages WHERE request_id=$1 ORDER BY id ASC`,
      [requestId]
    );
    return res.json({ requestId: Number(requestId), messages: messages.rows });
  } catch (err) {
    console.error("reply error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/requests/:id/proposal
 * Body: { proposal } // JSON (например, { hotel: "...", room:"TRPL", price: 1200 })
 * Роль: provider (только агент)
 * Ставит status = 'proposed', сохраняет proposal
 */
exports.propose = async (req, res) => {
  try {
    if (req.user?.role !== "provider") {
      return res.status(403).json({ message: "Only provider can propose" });
    }
    const providerId = req.user.id;
    const requestId = req.params.id;
    const { proposal } = req.body;
    if (!proposal) return res.status(400).json({ message: "proposal required" });

    const r = await pool.query(
      `UPDATE change_requests
       SET proposal=$1, status='proposed', updated_at=NOW()
       WHERE id=$2 AND provider_id=$3
       RETURNING *`,
      [proposal, requestId, providerId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Request not found" });

    return res.json(r.rows[0]);
  } catch (err) {
    console.error("propose error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/requests/:id/accept
 * Роль: client — принимает предложение; переводит статус в 'accepted'
 */
exports.accept = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client can accept" });
    }
    const clientId = req.user.id;
    const requestId = req.params.id;

    const r = await pool.query(
      `UPDATE change_requests
       SET status='accepted', updated_at=NOW()
       WHERE id=$1 AND client_id=$2
       RETURNING *`,
      [requestId, clientId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Request not found" });

    return res.json(r.rows[0]);
  } catch (err) {
    console.error("accept error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/requests/:id/decline
 * Роль: client — отклоняет предложение; status='declined'
 */
exports.decline = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client can decline" });
    }
    const clientId = req.user.id;
    const requestId = req.params.id;

    const r = await pool.query(
      `UPDATE change_requests
       SET status='declined', updated_at=NOW()
       WHERE id=$1 AND client_id=$2
       RETURNING *`,
      [requestId, clientId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Request not found" });

    return res.json(r.rows[0]);
  } catch (err) {
    console.error("decline error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
