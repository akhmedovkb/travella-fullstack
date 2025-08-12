const pool = require("../db");

// Клиент создаёт бронь (обычно после оффера/принятия)
// Точка входа: POST /api/bookings
// Body: { service_id, request_id?, price?, currency?, details? }
exports.createBooking = async (req, res) => {
  const clientId = req.user?.id;
  const role = req.user?.role;
  if (!clientId || role !== "client") {
    return res.status(403).json({ message: "Only client can create bookings" });
  }

  const { service_id, request_id, price, currency, details } = req.body || {};
  if (!service_id) {
    return res.status(400).json({ message: "service_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Проверяем услугу и провайдера
    const svc = await client.query(
      "SELECT id, provider_id, title, category FROM services WHERE id=$1",
      [service_id]
    );
    if (!svc.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Service not found" });
    }
    const providerId = svc.rows[0].provider_id;

    let proposal = null;
    if (request_id) {
      // Проверяем запрос и, если есть proposal, используем его как details/цену по умолчанию
      const rq = await client.query(
        `SELECT r.*, s.provider_id
         FROM requests r
         JOIN services s ON s.id = r.service_id
         WHERE r.id=$1 AND r.client_id=$2`,
        [request_id, clientId]
      );
      if (!rq.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Request not found" });
      }
      if (rq.rows[0].service_id !== service_id) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "request.service_id mismatch with service_id" });
      }
      proposal = rq.rows[0].proposal || null;
    }

    // Берём поля: приоритет body > proposal > null
    const finalPrice =
      price != null
        ? price
        : proposal?.price != null
        ? proposal.price
        : null;
    const finalCurrency =
      currency ?? (proposal?.currency ?? null);
    const finalDetails = (() => {
      // Складываем детали из body.details и proposal, proposal — как baseline
      const base = proposal || {};
      if (details && typeof details === "object") {
        return { ...base, ...details };
      }
      return Object.keys(base).length ? base : null;
    })();

    const ins = await client.query(
      `INSERT INTO bookings
        (request_id, service_id, client_id, provider_id, status, price, currency, details)
       VALUES ($1,$2,$3,$4,'pending', $5, $6, $7)
       RETURNING id, request_id, service_id, client_id, provider_id, status, price, currency, details, created_at`,
      [
        request_id || null,
        service_id,
        clientId,
        providerId,
        finalPrice,
        finalCurrency,
        finalDetails,
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ message: "createBooking error" });
  } finally {
    client.release();
  }
};

// Клиент: список своих броней
exports.listMyBookings = async (req, res) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId || role !== "client") {
    return res.status(403).json({ message: "Only client can view own bookings" });
  }

  try {
    const q = await pool.query(
      `SELECT b.*, s.title AS service_title, s.category
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.client_id=$1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "listMyBookings error" });
  }
};

// Провайдер: список броней по его услугам
exports.listProviderBookings = async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can view provider bookings" });
  }

  try {
    const q = await pool.query(
      `SELECT b.*, s.title AS service_title, s.category
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.provider_id=$1
       ORDER BY b.created_at DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "listProviderBookings error" });
  }
};

// Провайдер подтверждает бронь -> status: active
exports.confirm = async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can confirm bookings" });
  }

  const { id } = req.params;
  try {
    const upd = await pool.query(
      `UPDATE bookings
         SET status='active'
       WHERE id=$1 AND provider_id=$2 AND status='pending'
       RETURNING id, request_id, service_id, client_id, provider_id, status, price, currency, details, created_at`,
      [id, providerId]
    );
    if (!upd.rowCount) {
      return res.status(404).json({ message: "Booking not found or already processed" });
    }
    res.json(upd.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "confirm error" });
  }
};

// Провайдер отклоняет бронь -> status: rejected
exports.reject = async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can reject bookings" });
  }

  const { id } = req.params;
  const { reason } = req.body || {};
  try {
    const upd = await pool.query(
      `UPDATE bookings
         SET status='rejected',
             details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
               'rejected', jsonb_build_object('by','provider','reason',COALESCE($3,''),'ts',now())
             )
       WHERE id=$1 AND provider_id=$2 AND status IN ('pending')
       RETURNING id, request_id, service_id, client_id, provider_id, status, price, currency, details, created_at`,
      [id, providerId, reason || ""]
    );
    if (!upd.rowCount) {
      return res.status(404).json({ message: "Booking not found or already processed" });
    }
    res.json(upd.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "reject error" });
  }
};

// Клиент или провайдер отменяет -> status: cancelled
exports.cancel = async (req, res) => {
  const userId = req.user?.id;
  const role = req.user?.role; // 'client' | 'provider'
  if (!userId || !['client','provider'].includes(role)) {
    return res.status(403).json({ message: "Unauthorized" });
  }
  const { id } = req.params;
  const { reason } = req.body || {};

  try {
    // Проверим владение бронью
    const q = await pool.query(
      `SELECT id, client_id, provider_id, status FROM bookings WHERE id=$1`,
      [id]
    );
    if (!q.rowCount) return res.status(404).json({ message: "Booking not found" });

    const b = q.rows[0];
    const isOwner =
      (role === "client" && b.client_id === userId) ||
      (role === "provider" && b.provider_id === userId);
    if (!isOwner) return res.status(403).json({ message: "Forbidden" });

    // Разрешим отменять из любых "живых" статусов
    const upd = await pool.query(
      `UPDATE bookings
         SET status='cancelled',
             details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
               'cancel', jsonb_build_object('by',$2,'reason',COALESCE($3,''),'ts',now())
             )
       WHERE id=$1 AND status IN ('pending','active')
       RETURNING id, request_id, service_id, client_id, provider_id, status, price, currency, details, created_at`,
      [id, role, reason || ""]
    );
    if (!upd.rowCount) {
      return res.status(409).json({ message: "Booking already finished" });
    }
    res.json(upd.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "cancel error" });
  }
};

// Алиасы на случай, если где-то уже используются старые имена
exports.getMyBookings = exports.listMyBookings;
exports.getProviderBookings = exports.listProviderBookings;
