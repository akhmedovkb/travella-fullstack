// backend/controllers/bookingController.js
const pool = require("../db");

// ----- helpers -----
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const normYMD = (s) => String(s).slice(0, 10); // "YYYY-MM-DD"

async function getProviderIdByService(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id=$1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

async function getProviderType(providerId) {
  const r = await pool.query("SELECT type FROM providers WHERE id=$1", [providerId]);
  return r.rows[0]?.type || null;
}

// Проверка доступности набора дат для провайдера
// excludeBookingId — опционально игнорируем конкретную бронь (нужно на accept)
async function isDatesFree(providerId, ymdList, excludeBookingId = null) {
  if (!ymdList.length) return false;

  // 1) нет в ручных блокировках
  const q1 = await pool.query(
    `SELECT 1
       FROM provider_blocked_dates
      WHERE provider_id=$1 AND day = ANY($2::date[]) LIMIT 1`,
    [providerId, ymdList]
  );
  if (q1.rowCount) return false;

  // 2) нет пересечений с активными/ожидающими бронями
  let sql =
    `SELECT 1
       FROM booking_dates bd
       JOIN bookings b ON b.id = bd.booking_id
      WHERE b.provider_id=$1
        AND b.status IN ('pending','active')
        AND bd.date = ANY($2::date[])`;
  const params = [providerId, ymdList];
  if (excludeBookingId) {
    sql += ` AND b.id <> $3`;
    params.push(excludeBookingId);
  }
  sql += ` LIMIT 1`;

  const q2 = await pool.query(sql, params);
  if (q2.rowCount) return false;

  return true;
}

// ===== API =====

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

    const days = toArray(dates).map(normYMD).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не указаны даты" });

    // опорная дата для совместимости с колонкой bookings.date NOT NULL
    const primaryDate = [...days].sort()[0];

    // проверка доступности
    const ok = await isDatesFree(providerId, days);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    // создаём бронь (ВКЛЮЧАЯ колонку date)
    const ins = await pool.query(
      `INSERT INTO bookings (service_id, provider_id, client_id, date, status, client_message, attachments)
       VALUES ($1,$2,$3,$4::date,'pending',$5,$6::jsonb)
       RETURNING id, status`,
      [service_id ?? null, providerId, clientId, primaryDate, message ?? null, JSON.stringify(attachments ?? [])]
    );
    const bookingId = ins.rows[0].id;

    // даты брони
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

// Брони провайдера (обогащены полями клиента и услуги)
const getProviderBookings = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const q = await pool.query(
      `SELECT
         b.id, b.service_id, b.provider_id, b.client_id, b.status,
         b.client_message, b.attachments, b.provider_price, b.provider_note,
         b.date, b.created_at, b.updated_at,
         array_agg(bd.date::date ORDER BY bd.date) AS dates,
         -- клиент
         c.name  AS client_name,
         c.phone AS client_phone,
         c.social AS client_social,
         c.address AS client_address,
         -- услуга
         s.title AS service_title
       FROM bookings b
       LEFT JOIN booking_dates bd ON bd.booking_id = b.id
       LEFT JOIN clients c         ON c.id = b.client_id
       LEFT JOIN services s        ON s.id = b.service_id
       WHERE b.provider_id = $1
       GROUP BY b.id, c.name, c.phone, c.social, c.address, s.title
       ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getProviderBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Брони клиента (обогащены полями провайдера и услуги)
const getMyBookings = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const q = await pool.query(
      `SELECT
         b.id, b.service_id, b.provider_id, b.client_id, b.status,
         b.client_message, b.attachments, b.provider_price, b.provider_note,
         b.date, b.created_at, b.updated_at,
         array_agg(bd.date::date ORDER BY bd.date) AS dates,
         -- провайдер
         p.name  AS provider_name,
         p.type  AS provider_type,
         p.phone AS provider_phone,
         p.social AS provider_social,
         p.address AS provider_address,
         -- услуга
         s.title AS service_title
       FROM bookings b
       LEFT JOIN booking_dates bd ON bd.booking_id = b.id
       LEFT JOIN providers p      ON p.id = b.provider_id
       LEFT JOIN services  s      ON s.id = b.service_id
       WHERE b.client_id = $1
       GROUP BY b.id, p.name, p.type, p.phone, p.social, p.address, s.title
       ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC`,
      [clientId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getMyBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Принять бронь: POST /api/bookings/:id/accept { price?: number, note?: string }
const acceptBooking = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    const { price, note } = req.body || {};

    const pType = await getProviderType(providerId);
    if (!["guide", "transport"].includes(pType)) {
      return res.status(400).json({ message: "Действие доступно только для гида и транспорта" });
    }

    // проверим владельца
    const own = await pool.query(`SELECT provider_id FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    // финальная проверка (игнорируем текущую заявку)
    const dQ = await pool.query(`SELECT date::date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
    const days = dQ.rows.map((r) => normYMD(r.d));
    const ok = await isDatesFree(providerId, days, id);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    await pool.query(
      `UPDATE bookings
          SET status='active',
              provider_price = COALESCE($1, provider_price),
              provider_note  = COALESCE($2, provider_note),
              updated_at = NOW()
        WHERE id=$3`,
      [price ?? null, note ?? null, id]
    );
    res.json({ ok: true, status: "active" });
  } catch (err) {
    console.error("acceptBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Отклонить бронь: POST /api/bookings/:id/reject { reason?: string }
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

// Отмена клиентом: POST /api/bookings/:id/cancel
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

module.exports = {
  createBooking,
  getProviderBookings,
  getMyBookings,
  acceptBooking,
  rejectBooking,
  cancelBooking,
};
