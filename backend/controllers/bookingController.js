// backend/controllers/bookingController.js
const pool = require("../db");

/* ================= helpers ================= */

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Надёжно переводит любую входную дату в ISO YYYY-MM-DD (UTC). */
const toISO = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str; // уже ISO
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

async function getProviderIdByService(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id=$1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

async function getProviderType(providerId) {
  const r = await pool.query("SELECT type FROM providers WHERE id=$1", [providerId]);
  return r.rows[0]?.type || null;
}

/**
 * Проверка доступности набора дат для провайдера.
 * excludeBookingId — игнорировать конкретную бронь (на accept/confirm).
 * ВАЖНО: тут считаем занятыми статусы 'pending' и 'confirmed'.
 */
async function isDatesFree(providerId, ymdList, excludeBookingId = null) {
  const list = toArray(ymdList).map(toISO).filter(Boolean);
  if (!list.length) return false;

  // 1) нет в ручных блокировках
  const q1 = await pool.query(
    `SELECT 1
       FROM provider_blocked_dates
      WHERE provider_id=$1 AND date = ANY($2::date[]) LIMIT 1`,
    [providerId, list]
  );
  if (q1.rowCount) return false;

  // 2) нет пересечений с "живыми" бронями
  let sql =
    `SELECT 1
       FROM booking_dates bd
       JOIN bookings b ON b.id = bd.booking_id
      WHERE b.provider_id=$1
        AND b.status IN ('pending','confirmed')
        AND bd.date = ANY($2::date[])`;
  const params = [providerId, list];
  if (excludeBookingId) {
    sql += ` AND b.id <> $3`;
    params.push(excludeBookingId);
  }
  sql += ` LIMIT 1`;

  const q2 = await pool.query(sql, params);
  return q2.rowCount === 0;
}

/* ================= API ================= */

/**
 * POST /api/bookings
 * body: { service_id?, provider_id?, dates:[YYYY-MM-DD], message?, attachments?:[{name,type,dataUrl}] }
 * Требуется токен (client_id берём из req.user.id)
 */
const createBooking = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Требуется авторизация" });

    const { service_id, provider_id: pFromBody, dates, message, attachments } = req.body || {};
    let providerId = pFromBody || null;

    if (!providerId && service_id) {
      providerId = await getProviderIdByService(service_id);
    }
    if (!providerId) return res.status(400).json({ message: "Не указан provider_id / service_id" });

    const pType = await getProviderType(providerId);
    if (!["guide", "transport"].includes(pType)) {
      return res.status(400).json({ message: "Бронирование доступно только для гида и транспорта" });
    }

    const days = toArray(dates).map(toISO).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не указаны корректные даты" });

    const primaryDate = [...days].sort()[0];

    const ok = await isDatesFree(providerId, days);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    const ins = await pool.query(
      `INSERT INTO bookings (service_id, provider_id, client_id, date, status, client_message, attachments)
       VALUES ($1,$2,$3,$4::date,'pending',$5,$6::jsonb)
       RETURNING id, status`,
      [service_id ?? null, providerId, clientId, primaryDate, message ?? null, JSON.stringify(attachments ?? [])]
    );
    const bookingId = ins.rows[0].id;

    for (const d of days) {
      await pool.query(
        `INSERT INTO booking_dates (booking_id, date) VALUES ($1,$2::date)`,
        [bookingId, d]
      );
    }

    res.status(201).json({ id: bookingId, status: "pending", dates: days });
  } catch (err) {
    console.error("createBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Брони провайдера (гид/транспорт)
async function getProviderBookings(req, res) {
  try {
    const providerId = req.user?.id;

    const sql = `
      SELECT
        b.id, b.provider_id, b.service_id, b.client_id,
        b.status, b.created_at, b.updated_at,
        b.client_message, b.provider_note, b.provider_price,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(bd.date::date ORDER BY bd.date), NULL),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title AS service_title,
        c.id          AS client_id,
        c.name        AS client_name,
        c.phone       AS client_phone,
        c.email       AS client_email,
        c.telegram    AS client_social,
        c.location    AS client_address,
        c.avatar_url  AS client_avatar_url,
        p.id       AS provider_profile_id,
        p.name     AS provider_name,
        p.type     AS provider_type,
        p.phone    AS provider_phone,
        p.email    AS provider_email,
        p.social   AS provider_social,
        p.address  AS provider_address,
        p.location AS provider_location,
        p.photo    AS provider_photo
      FROM bookings b
      LEFT JOIN booking_dates bd ON bd.booking_id = b.id
      LEFT JOIN clients  c       ON c.id = b.client_id
      LEFT JOIN providers p      ON p.id = b.provider_id
      LEFT JOIN services  s      ON s.id = b.service_id
      WHERE b.provider_id = $1
      GROUP BY b.id, s.id, c.id, p.id
      ORDER BY b.created_at DESC NULLS LAST
    `;

    const q = await pool.query(sql, [providerId]);
    return res.json(q.rows);
  } catch (err) {
    console.error("getProviderBookings error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Брони клиента (мой кабинет)
const getMyBookings = async (req, res) => {
  try {
    const clientId = req.user?.id;

    const q = await pool.query(
      `
      SELECT
        b.id, b.service_id, b.provider_id, b.client_id, b.status,
        b.client_message,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        b.provider_price, b.provider_note,
        b.created_at, b.updated_at,
        COALESCE(
          (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d
            WHERE d.booking_id = b.id),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title AS service_title,
        p.name    AS provider_name,
        p.type    AS provider_type,
        p.phone   AS provider_phone,
        p.address AS provider_address,
        p.social  AS provider_telegram
      FROM bookings b
      LEFT JOIN services  s ON s.id = b.service_id
      LEFT JOIN providers p ON p.id = b.provider_id
      WHERE b.client_id = $1
      ORDER BY b.created_at DESC NULLS LAST
      `,
      [clientId]
    );

    res.json(q.rows);
  } catch (err) {
    console.error("getMyBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Провайдер подтверждает бронь (если у вас это действие есть)
const acceptBooking = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    const { price, note } = req.body || {};

    const pType = await getProviderType(providerId);
    if (!["guide", "transport"].includes(pType)) {
      return res.status(400).json({ message: "Действие доступно только для гида и транспорта" });
    }

    const own = await pool.query(`SELECT provider_id FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
    const days = dQ.rows.map((r) => toISO(r.d)).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не удалось определить даты бронирования" });

    const ok = await isDatesFree(providerId, days, id);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    await pool.query(
      `UPDATE bookings
          SET status='confirmed',
              provider_price = COALESCE($1, provider_price),
              provider_note  = COALESCE($2, provider_note),
              updated_at = NOW()
        WHERE id=$3`,
      [price ?? null, note ?? null, id]
    );
    res.json({ ok: true, status: "confirmed" });
  } catch (err) {
    console.error("acceptBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Провайдер отклоняет
const rejectBooking = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    const { reason } = req.body || {};

    const pType = await getProviderType(providerId);
    if (!["guide", "transport"].includes(pType)) {
      return res.status(400).json({ message: "Действие доступно только для гида и транспорта" });
    }

    const own = await pool.query(`SELECT provider_id FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    await pool.query(
      `UPDATE bookings
          SET status='rejected',
              provider_note = COALESCE($1, provider_note),
              updated_at = NOW()
        WHERE id=$2`,
      [reason ?? null, id]
    );
    res.json({ ok: true, status: "rejected" });
  } catch (err) {
    console.error("rejectBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Клиент отменяет
const cancelBooking = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const id = Number(req.params.id);

    const own = await pool.query(`SELECT client_id FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].client_id !== clientId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    await pool.query(
      `UPDATE bookings
         SET status='cancelled',
             updated_at = NOW()
       WHERE id=$1`,
      [id]
    );
    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    console.error("cancelBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Провайдер отправляет цену/комментарий
const providerQuote = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;
    const price = Number(req.body?.price);
    const note  = req.body?.note ?? null;

    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return res.status(400).json({ message: "Invalid booking id" });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ message: "Invalid price" });
    }

    const q = await pool.query(
      `UPDATE bookings
         SET provider_price = $2,
             provider_note  = $3,
             updated_at     = NOW()
       WHERE id = $1 AND provider_id = $4
       RETURNING id, provider_price, provider_note`,
      [bookingId, price, note, providerId]
    );

    if (!q.rowCount) return res.status(404).json({ message: "Booking not found" });
    res.json({ ok: true, booking: q.rows[0] });
  } catch (err) {
    console.error("providerQuote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Клиент подтверждает: POST /api/bookings/:id/confirm
const confirmBooking = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const id = Number(req.params.id);

    const own = await pool.query(
      `SELECT provider_id, client_id FROM bookings WHERE id=$1`,
      [id]
    );
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].client_id !== clientId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    const dQ = await pool.query(
      `SELECT date AS d FROM booking_dates WHERE booking_id=$1`,
      [id]
    );
    let days = dQ.rows.map((r) => toISO(r.d)).filter(Boolean);

    if (!days.length) {
      const bQ = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bQ.rowCount) days = [toISO(bQ.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "Не удалось определить даты бронирования" });

    const ok = await isDatesFree(own.rows[0].provider_id, days, id);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    await pool.query(
      `UPDATE bookings
         SET status='confirmed',
             updated_at = NOW()
       WHERE id=$1`,
      [id]
    );

    return res.json({ ok: true, status: "confirmed" });
  } catch (err) {
    console.error("confirmBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  createBooking,
  getProviderBookings,
  getMyBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking,
};
