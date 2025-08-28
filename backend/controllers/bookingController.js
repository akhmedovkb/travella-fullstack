// backend/controllers/bookingController.js
const pool = require("../db");

// ---------- helpers ----------
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const normYMD = (s) => String(s).slice(0, 10); // "YYYY-MM-DD"

async function getProviderIdByService(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id=$1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

// жёсткая проверка типа провайдера
async function getProviderType(providerId) {
  const r = await pool.query("SELECT type FROM providers WHERE id=$1", [providerId]);
  return r.rows[0]?.type || null;
}

// транзакционный хелпер
async function runTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Проверка доступности набора дат для провайдера
async function isDatesFree(providerId, ymdList) {
  if (!ymdList.length) return false;

  // 1) не входят в ручные блокировки
  const q1 = await pool.query(
    `SELECT 1
       FROM provider_blocked_dates
      WHERE provider_id=$1 AND day = ANY($2::date[])
      LIMIT 1`,
    [providerId, ymdList]
  );
  if (q1.rowCount) return false;

  // 2) не пересекаются с активными/ожидающими бронями
  const q2 = await pool.query(
    `SELECT 1
       FROM booking_dates bd
       JOIN bookings b ON b.id = bd.booking_id
      WHERE b.provider_id=$1
        AND b.status IN ('pending','active')
        AND bd.date = ANY($2::date[])
      LIMIT 1`,
    [providerId, ymdList]
  );
  if (q2.rowCount) return false;

  return true;
}

// ---------- API ----------

/**
 * POST /api/bookings
 * body: { service_id?, provider_id?, dates: [YYYY-MM-DD], message?, attachments?: [{name,type,dataUrl}] }
 * Требуется токен (клиент). client_id берём из токена.
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

    const ok = await isDatesFree(providerId, days);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    // всё создаём атомарно
    const result = await runTx(async (trx) => {
      const ins = await trx.query(
        `INSERT INTO bookings (service_id, provider_id, client_id, status, client_message, attachments)
         VALUES ($1,$2,$3,'pending',$4,$5::jsonb)
         RETURNING id, status`,
        [service_id ?? null, providerId, clientId, message ?? null, JSON.stringify(attachments ?? [])]
      );
      const bookingId = ins.rows[0].id;

      for (const d of days) {
        await trx.query(
          `INSERT INTO booking_dates (booking_id, date) VALUES ($1,$2::date)`,
          [bookingId, d]
        );
      }
      return { id: bookingId, status: "pending", dates: days };
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("createBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Брони провайдера
const getProviderBookings = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const q = await pool.query(
      `SELECT b.*,
              array_agg(bd.date::date ORDER BY bd.date) AS dates
         FROM bookings b
         LEFT JOIN booking_dates bd ON bd.booking_id = b.id
        WHERE b.provider_id = $1
        GROUP BY b.id
        ORDER BY COALESCE(b.created_at, b.id) DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getProviderBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Брони клиента
const getMyBookings = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const q = await pool.query(
      `SELECT b.*,
              array_agg(bd.date::date ORDER BY bd.date) AS dates,
              p.name AS provider_name,
              s.title AS service_title
         FROM bookings b
         LEFT JOIN booking_dates bd ON bd.booking_id = b.id
         LEFT JOIN providers p ON p.id = b.provider_id
         LEFT JOIN services  s ON s.id = b.service_id
        WHERE b.client_id = $1
        GROUP BY b.id, p.name, s.title
        ORDER BY COALESCE(b.created_at, b.id) DESC`,
      [clientId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getMyBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Принять: POST /api/bookings/:id/accept  { price?: number, note?: string }
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

    // финальная проверка на доступность
    const dQ = await pool.query(`SELECT date::date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
    const days = dQ.rows.map((r) => normYMD(r.d));
    const ok = await isDatesFree(providerId, days);
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

// Отклонить: POST /api/bookings/:id/reject { reason?: string }
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
              provider_note=COALESCE($1, provider_note),
              updated_at=NOW()
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
      `UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1`,
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
