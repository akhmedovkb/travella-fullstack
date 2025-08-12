const pool = require("../db");
const { validationResult } = require("express-validator");

exports.createRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role; // "client" ожидается
    if (!userId || role !== "client") {
      return res.status(403).json({ message: "Only client can create requests" });
    }

    const { service_id, note } = req.body;
    if (!service_id) return res.status(400).json({ message: "service_id is required" });

    // убеждаемся, что услуга существует
    const svc = await pool.query("SELECT id, provider_id, title FROM services WHERE id=$1", [service_id]);
    if (!svc.rowCount) return res.status(404).json({ message: "Service not found" });

    const q = await pool.query(
      `INSERT INTO requests (service_id, client_id, status, note)
       VALUES ($1,$2,'new',$3)
       RETURNING id, service_id, client_id, status, note, proposal, created_at`,
      [service_id, userId, note || null]
    );

    res.status(201).json(q.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "createRequest error" });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || role !== "client") {
      return res.status(403).json({ message: "Only client can view own requests" });
    }

    const q = await pool.query(
      `SELECT r.*, s.title AS service_title, s.category, s.provider_id
       FROM requests r
       JOIN services s ON s.id = r.service_id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "getMyRequests error" });
  }
};

exports.getProviderRequests = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const role = req.user?.role;
    if (!providerId || role !== "provider") {
      return res.status(403).json({ message: "Only provider can view incoming requests" });
    }

    const q = await pool.query(
      `SELECT r.*, s.title AS service_title, s.category
       FROM requests r
       JOIN services s ON s.id = r.service_id
       WHERE s.provider_id = $1
       ORDER BY r.created_at DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "getProviderRequests error" });
  }
};

exports.addProposal = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const role = req.user?.role;
    if (!providerId || role !== "provider") {
      return res.status(403).json({ message: "Only provider can send proposal" });
    }

    const { id } = req.params;
    const { price, currency, hotel, room, terms, message } = req.body || {};

    // проверяем, что запрос относится к услуге этого провайдера
    const rq = await pool.query(
      `SELECT r.id, r.client_id, r.service_id, s.provider_id
       FROM requests r
       JOIN services s ON s.id = r.service_id
       WHERE r.id = $1`,
      [id]
    );
    if (!rq.rowCount) return res.status(404).json({ message: "Request not found" });
    if (rq.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Forbidden for this request" });
    }

    const updated = await pool.query(
      `UPDATE requests
         SET proposal = jsonb_strip_nulls($2::jsonb),
             status = 'proposed'
       WHERE id = $1
       RETURNING id, service_id, client_id, status, note, proposal, created_at`,
      [
        id,
        JSON.stringify({ price, currency, hotel, room, terms, message, ts: new Date().toISOString() }),
      ]
    );

    res.json(updated.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "addProposal error" });
  }
};

exports.acceptRequest = async (req, res) => {
  const clientId = req.user?.id;
  const role = req.user?.role;
  if (!clientId || role !== "client") {
    return res.status(403).json({ message: "Only client can accept" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { id } = req.params;
    const rq = await client.query(
      `SELECT r.*, s.provider_id
       FROM requests r
       JOIN services s ON s.id = r.service_id
       WHERE r.id=$1 AND r.client_id=$2
       FOR UPDATE`,
      [id, clientId]
    );
    if (!rq.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Request not found" });
    }
    const r = rq.rows[0];
    if (!r.proposal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No proposal to accept" });
    }

    // обновляем статус запроса
    await client.query(`UPDATE requests SET status='accepted' WHERE id=$1`, [id]);

    // создаём бронь
    const booking = await client.query(
      `INSERT INTO bookings (request_id, service_id, client_id, provider_id, status, price, currency, details)
       VALUES ($1,$2,$3,$4,'active', ($5->>'price')::numeric, $5->>'currency', $5)
       RETURNING id, request_id, service_id, client_id, provider_id, status, price, currency, details, created_at`,
      [r.id, r.service_id, r.client_id, r.provider_id, r.proposal]
    );

    await client.query("COMMIT");
    res.json({ ok: true, request_id: r.id, booking: booking.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ message: "acceptRequest error" });
  } finally {
    client.release();
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const role = req.user?.role;
    if (!clientId || role !== "client") {
      return res.status(403).json({ message: "Only client can reject" });
    }

    const { id } = req.params;
    const upd = await pool.query(
      `UPDATE requests SET status='rejected' WHERE id=$1 AND client_id=$2
       RETURNING id, service_id, client_id, status, note, proposal, created_at`,
      [id, clientId]
    );
    if (!upd.rowCount) return res.status(404).json({ message: "Request not found" });
    res.json(upd.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "rejectRequest error" });
  }
};
