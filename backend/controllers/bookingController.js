// backend/controllers/bookingController.js
const pool = require("../db");

/* ===================== DATE HELPERS ===================== */
const toISODate = (s) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const expandRange = (start, end) => {
  const a = new Date(start + "T00:00:00Z");
  const b = new Date(end + "T00:00:00Z");
  const out = [];
  for (let d = a; d <= b; d = new Date(d.getTime() + 86400000)) {
    out.push(toISODate(d.toISOString()));
  }
  return out;
};

// Нормализуем даты брони из details/proposal.
// Поддерживаем formats: { dates: string[] } или { startDate,endDate } / { start_date,end_date } / { returnDate }
function extractBookingDates(details) {
  if (!details || typeof details !== "object") return [];
  if (Array.isArray(details.dates)) {
    return [...new Set(details.dates.map(toISODate).filter(Boolean))];
  }
  const s = toISODate(details.startDate || details.start_date);
  const e = toISODate(details.endDate || details.end_date || details.returnDate);
  if (s && e) return expandRange(s, e);
  if (s) return [s];
  return [];
}

/* ===================== DB HELPERS (dates) ===================== */
// Проверка пересечений с ручными блокировками и живыми бронями (pending/active)
async function checkDateConflicts(client, providerId, isoDates) {
  if (!isoDates.length) return [];

  const q = await client.query(
    `
    WITH input(d) AS (
      SELECT UNNEST($2::date[])
    )
    SELECT d::text AS date, reason
    FROM (
      SELECT i.d,
             CASE
               WHEN pbd.date IS NOT NULL THEN 'blocked'
               WHEN b.id IS NOT NULL  THEN 'booked'
             END AS reason
      FROM input i
      LEFT JOIN provider_blocked_dates pbd
        ON pbd.provider_id = $1 AND pbd.date = i.d
      LEFT JOIN booking_dates bd
        ON bd.date = i.d
      LEFT JOIN bookings b
        ON b.id = bd.booking_id
       AND b.provider_id = $1
       AND b.status IN ('pending','active')
    ) t
    WHERE reason IS NOT NULL
    ORDER BY d
    `,
    [providerId, isoDates]
  );
  return q.rows; // [{date, reason}]
}

async function writeBookingDates(client, bookingId, isoDates) {
  if (!isoDates.length) return;
  const values = isoDates.map((_, i) => `($1,$${i + 2})`).join(",");
  await client.query(
    `INSERT INTO booking_dates (booking_id, date)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [bookingId, ...isoDates]
  );
}

/* ===================== CONTROLLERS ===================== */

// Клиент создаёт бронь (обычно после оффера/принятия)
// POST /api/bookings  Body: { service_id, request_id?, price?, currency?, details? }
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
      // Проверяем запрос и достаём proposal (если было)
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

    // Итоговые поля (приоритет body > proposal)
    const finalPrice =
      price != null
        ? price
        : proposal?.price != null
        ? proposal.price
        : null;

    const finalCurrency = currency ?? (proposal?.currency ?? null);

    const finalDetails = (() => {
      const base = proposal || {};
      if (details && typeof details === "object") {
        return { ...base, ...details };
      }
      return Object.keys(base).length ? base : null;
    })();

    // Нормализуем желаемые даты (сумма body + proposal)
    const wantedDates = [
      ...extractBookingDates(details),
      ...extractBookingDates(proposal),
    ].filter(Boolean);
    const isoDates = [...new Set(wantedDates)];

    // Проверка доступности дат ДО создания брони
    if (isoDates.length) {
      const conflicts = await checkDateConflicts(client, providerId, isoDates);
      if (conflicts.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Requested dates are not available",
          conflicts, // [{date:'YYYY-MM-DD', reason:'booked'|'blocked'}]
        });
      }
    }

    // Создаём бронь
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

    // Привязываем даты к брони (для календаря провайдера)
    const bookingId = ins.rows[0].id;
    if (isoDates.length) {
      await writeBookingDates(client, bookingId, isoDates);
    }

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

    // Разрешим отменять из «живых» статусов
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
