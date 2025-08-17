// backend/controllers/bookingController.js
const pool = require("../db");

/** ===================== helpers ===================== */
const asArray = (v) => (Array.isArray(v) ? v : []);
const onlyUnique = (arr) => Array.from(new Set(arr));

function toISODate(d) {
  // принимает "YYYY-MM-DD" или Date/строку и приводит к "YYYY-MM-DD"
  if (!d) return null;
  try {
    // Если уже вида YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch { return null; }
}

function normalizeDates(input) {
  const norm = [];
  for (const x of asArray(input)) {
    const d = toISODate(x);
    if (d) norm.push(d);
  }
  return onlyUnique(norm).sort();
}

/** ===================== CREATE ===================== */
// POST /api/bookings
// Body: { service_id, request_id?, price?, currency?, details? { dates?: string[] } }
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

    // 1) Сервис и провайдер
    const svc = await client.query(
      "SELECT id, provider_id, title, category FROM services WHERE id=$1",
      [service_id]
    );
    if (!svc.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Service not found" });
    }
    const providerId = svc.rows[0].provider_id;

    // 2) Если есть request, подтянем предложение как baseline
    let proposal = null;
    if (request_id) {
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
        return res.status(400).json({ message: "request.service_id mismatch with service_id" });
      }
      proposal = rq.rows[0].proposal || null;
    }

    // 3) Сбор финальных полей
    const finalPrice = price != null ? price : (proposal?.price ?? null);
    const finalCurrency = currency ?? (proposal?.currency ?? null);
    const finalDetails = (() => {
      const base = (proposal && typeof proposal === "object") ? proposal : {};
      if (details && typeof details === "object") return { ...base, ...details };
      return Object.keys(base).length ? base : null;
    })();

    // 4) Даты брони (для гида/транспорта): берём из body.details.dates или из proposal.dates
    const requestedDates = normalizeDates(
      (details && details.dates) || (proposal && proposal.dates) || []
    );

    // Если даты переданы — проверим на конфликты с блокировками и другими бронями
    let conflictedBlocked = [];
    let conflictedBooked = [];
    if (requestedDates.length) {
      // provider_blocked_dates
      const qBlocked = await client.query(
        `SELECT date::text AS date
           FROM provider_blocked_dates
          WHERE provider_id=$1 AND date = ANY($2::date[])`,
        [providerId, requestedDates]
      );
      conflictedBlocked = qBlocked.rows.map((r) => r.date);

      // booking_dates у "живых" броней
      const qBooked = await client.query(
        `SELECT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id=$1
            AND b.status IN ('pending','active')
            AND bd.date = ANY($2::date[])`,
        [providerId, requestedDates]
      );
      // не дублируем
      const blockedSet = new Set(conflictedBlocked);
      conflictedBooked = qBooked.rows.map((r) => r.date).filter((d) => !blockedSet.has(d));
    }

    if ((conflictedBlocked.length + conflictedBooked.length) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Dates conflict",
        conflicts: {
          blocked: conflictedBlocked.sort(),
          booked: conflictedBooked.sort(),
        },
      });
    }

    // 5) Вставка самой брони
    const ins = await client.query(
      `INSERT INTO bookings
        (request_id, service_id, client_id, provider_id, status, price, currency, details)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)
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
    const booking = ins.rows[0];

    // 6) Если даты переданы — сразу "держим" их как занятые даже в pending
    if (requestedDates.length) {
      const values = requestedDates.map((_, i) => `($1, $${i + 2})`).join(",");
      await client.query(
        `INSERT INTO booking_dates (booking_id, date) VALUES ${values} ON CONFLICT DO NOTHING`,
        [booking.id, ...requestedDates]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json(booking);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ message: "createBooking error" });
  } finally {
    client.release();
  }
};

/** ===================== LISTS ===================== */
// GET /api/bookings/client
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

// GET /api/bookings/provider
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

/** ===================== ACTIONS ===================== */
// POST /api/bookings/:id/confirm
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

// POST /api/bookings/:id/reject
exports.reject = async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can reject bookings" });
  }

  const { id } = req.params;
  const { reason } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upd = await client.query(
      `UPDATE bookings
          SET status='rejected',
              details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
                'rejected', jsonb_build_object('by','provider','reason',COALESCE($3,''),'ts',now())
              )
        WHERE id=$1 AND provider_id=$2 AND status IN ('pending')
        RETURNING id`,
      [id, providerId, reason || ""]
    );
    if (!upd.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Booking not found or already processed" });
    }

    // Освобождаем удержанные даты
    await client.query(`DELETE FROM booking_dates WHERE booking_id=$1`, [id]);

    await client.query("COMMIT");
    res.json({ id, status: "rejected" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ message: "reject error" });
  } finally {
    client.release();
  }
};

// POST /api/bookings/:id/cancel
// Может вызвать клиент или провайдер; освобождаем даты
exports.cancel = async (req, res) => {
  const userId = req.user?.id;
  const role = req.user?.role; // 'client' | 'provider'
  if (!userId || !["client", "provider"].includes(role)) {
    return res.status(403).json({ message: "Unauthorized" });
  }
  const { id } = req.params;
  const { reason } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Проверим владение
    const q = await client.query(
      `SELECT id, client_id, provider_id, status FROM bookings WHERE id=$1 FOR UPDATE`,
      [id]
    );
    if (!q.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Booking not found" });
    }
    const b = q.rows[0];
    const isOwner =
      (role === "client" && b.client_id === userId) ||
      (role === "provider" && b.provider_id === userId);
    if (!isOwner) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Forbidden" });
    }

    // Разрешим отменять из 'pending'/'active'
    const upd = await client.query(
      `UPDATE bookings
          SET status='cancelled',
              details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
                'cancel', jsonb_build_object('by',$2,'reason',COALESCE($3,''),'ts',now())
              )
        WHERE id=$1 AND status IN ('pending','active')
        RETURNING id`,
      [id, role, reason || ""]
    );
    if (!upd.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Booking already finished" });
    }

    // Освобождаем даты
    await client.query(`DELETE FROM booking_dates WHERE booking_id=$1`, [id]);

    await client.query("COMMIT");
    res.json({ id, status: "cancelled" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ message: "cancel error" });
  } finally {
    client.release();
  }
};

// Алиасы для обратной совместимости
exports.getMyBookings = exports.listMyBookings;
exports.getProviderBookings = exports.listProviderBookings;
