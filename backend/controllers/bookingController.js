// backend/controllers/bookingController.js
const pool = require("../db");

/* ================= helpers ================= */

// универсально: есть ли такие колонки в таблице
async function getExistingColumns(table, cols = []) {
  const q = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2::text[])`,
    [table, cols]
  );
  const set = new Set(q.rows.map(r => r.column_name));
  return cols.reduce((acc, c) => (acc[c] = set.has(c), acc), {});
}

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const toISO = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(+dt)) return null;
  return dt.toISOString().slice(0, 10);
};

async function getProviderType(providerId) {
  const q = await pool.query("SELECT type FROM providers WHERE id = $1", [providerId]);
  return q.rows?.[0]?.type || null;
}
async function getProviderIdByService(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id = $1", [serviceId]);
  return q.rows?.[0]?.provider_id || null;
}
async function getBookingById(id) {
  const q = await pool.query(
    `SELECT b.*, COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments
     FROM bookings b WHERE b.id = $1`,
    [id]
  );
  return q.rows[0] || null;
}

/**
 * Проверка доступности набора дат для провайдера.
 * excludeBookingId — игнорировать конкретную бронь (на accept/confirm).
 * ВАЖНО: тут считаем занятыми статусы 'pending' и 'confirmed'.
 */
async function isDatesFree(providerId, ymdList, excludeBookingId = null) {
  const list = toArray(ymdList).map(toISO).filter(Boolean);
  if (!list.length) return false;

  // 1) напрямую дата в bookings.date
  const q1 = await pool.query(
    `
    SELECT 1
    FROM bookings b
    WHERE b.provider_id = $1
      AND (b.status IN ('pending','confirmed'))
      AND (
        (b.date IS NOT NULL AND b.date::date = ANY($2::date[]))
        OR EXISTS (
          SELECT 1
          FROM booking_dates bd
          WHERE bd.booking_id = b.id AND bd.date::date = ANY($2::date[])
        )
      )
      ${excludeBookingId ? "AND b.id <> $3" : ""}
    LIMIT 1
    `,
    excludeBookingId ? [providerId, list, excludeBookingId] : [providerId, list]
  );

  return q1.rowCount === 0;
}

/* ================= create ================= */

// Создание брони (для клиента и провайдера-заявителя)
const createBooking = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role; // 'client' | 'provider'
    if (!userId) return res.status(401).json({ message: "Требуется авторизация" });

    const { service_id, provider_id: pFromBody, dates, message, attachments, currency } = req.body || {};
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

    // какие колонки реально есть
    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "requester_name",
      "requester_phone",
      "requester_telegram",
      "requester_email",
    ]);

    // базовые колонки
    const insertCols = ["service_id", "provider_id", "client_id", "date", "status", "client_message", "attachments"];
    const values = [service_id ?? null, providerId, userRole === "client" ? userId : null, primaryDate, "pending", message ?? null, JSON.stringify(attachments ?? [])];

    // опциональная валюта
    if (cols.currency) {
      insertCols.push("currency");
      values.push(currency ?? null);
    }

    // если бронирует провайдер и в таблице есть requester_* — заполним
    if (userRole === "provider" && cols.requester_provider_id) {
      const me = await getProviderProfile(userId);
      insertCols.push("requester_provider_id");
      values.push(userId);
      if (cols.requester_name)     { insertCols.push("requester_name");     values.push(me?.name ?? null); }
      if (cols.requester_phone)    { insertCols.push("requester_phone");    values.push(me?.phone ?? null); }
      if (cols.requester_telegram) { insertCols.push("requester_telegram"); values.push(me?.telegram ?? null); }
      if (cols.requester_email)    { insertCols.push("requester_email");    values.push(me?.email ?? null); }
    }

    // собрать плейсхолдеры
    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(",");

    const ins = await pool.query(
      `INSERT INTO bookings (${insertCols.join(",")})
       VALUES (${placeholders})
       RETURNING id, status`,
      values
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

// ВХОДЯЩИЕ брони провайдера (мои услуги)
//  брони поставщика (мои услуги)
// ВХОДЯЩИЕ брони поставщика (мои услуги)
// ВХОДЯЩИЕ брони поставщика (мои услуги)
async function getProviderBookings(req, res) {
  try {
    const providerId = req.user?.id;

    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "requester_name",
      "requester_phone",
      "requester_telegram",
      "requester_email",
    ]);

    const selectCurrency = cols.currency ? `b.currency` : `'USD'::text AS currency`;

    const selectRequester = cols.requester_provider_id
      ? `b.requester_provider_id,
         b.requester_name,
         b.requester_phone,
         b.requester_telegram,
         b.requester_email`
      : `NULL::int  AS requester_provider_id,
         NULL::text AS requester_name,
         NULL::text AS requester_phone,
         NULL::text AS requester_telegram,
         NULL::text AS requester_email`;

    const sql = `
      SELECT
        b.id, b.provider_id, b.service_id, b.client_id,
        b.status, b.created_at, b.updated_at,
        b.client_message, b.provider_note, b.provider_price,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        ${selectCurrency},
        ${selectRequester},
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(bd.date::date ORDER BY bd.date), NULL),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title       AS service_title,

        /* клиент */
        c.id          AS client_id,
        c.name        AS client_name,
        c.phone       AS client_phone,
        c.email       AS client_email,
        c.telegram    AS client_social,
        c.location    AS client_address,
        c.avatar_url  AS client_avatar_url,

        /* текущий поставщик (вы) */
        p.id          AS provider_profile_id,
        p.name        AS provider_name,
        p.type        AS provider_type,
        p.phone       AS provider_phone,
        p.email       AS provider_email,
        p.social      AS provider_social,
        p.address     AS provider_address,
        p.location    AS provider_location,
        p.photo       AS provider_photo,
        p.photo       AS provider_avatar_url,

        /* заявитель-поставщик (если есть) */
        rp.photo      AS requester_photo,
        rp.photo      AS requester_avatar_url,
        rp.type       AS requester_type

      FROM bookings b
      LEFT JOIN booking_dates bd ON bd.booking_id = b.id
      LEFT JOIN clients   c  ON c.id = b.client_id
      LEFT JOIN providers p  ON p.id = b.provider_id
      LEFT JOIN providers rp ON rp.id = b.requester_provider_id
      LEFT JOIN services  s  ON s.id = b.service_id
      WHERE b.provider_id = $1
      GROUP BY b.id, s.id, c.id, p.id, rp.id
      ORDER BY b.created_at DESC NULLS LAST
    `;

    const q = await pool.query(sql, [providerId]);
    return res.json(q.rows);
  } catch (err) {
    console.error("getProviderBookings error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
}

// ИСХОДЯЩИЕ брони (я как провайдер бронирую чью-то услугу)
function getProviderOutgoingBookings(req, res) {
  try {
    const providerId = req.user?.id;

    (async () => {
      const cols = await getExistingColumns("bookings", ["currency", "requester_provider_id"]);
      if (!cols.requester_provider_id) return res.json([]);

      const currencySel = cols.currency ? "b.currency" : `'USD'::text AS currency`;

      const sql = `
        SELECT
          b.id, b.provider_id, b.service_id, b.client_id,
          b.status, b.created_at, b.updated_at,
          b.client_message, b.provider_note, b.provider_price,
          COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
          ${currencySel},
          b.requester_provider_id,
          b.requester_name, b.requester_phone, b.requester_telegram, b.requester_email,

          COALESCE(
            (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d
             WHERE d.booking_id = b.id),
            CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
          ) AS dates,

          s.title      AS service_title,

          /* поставщик услуги, к кому обращаемся */
          p.name       AS provider_name,
          p.type       AS provider_type,
          p.phone      AS provider_phone,
          p.address    AS provider_address,
          p.social     AS provider_telegram,

          /* фото поставщика для фронта в двух алиасах */
          p.photo      AS provider_photo,
          p.photo      AS provider_avatar_url

        FROM bookings b
        LEFT JOIN services  s ON s.id = b.service_id
        LEFT JOIN providers p ON p.id = b.provider_id
        WHERE b.requester_provider_id = $1
        ORDER BY b.created_at DESC NULLS LAST
      `;

      const q = await pool.query(sql, [providerId]);
      return res.json(q.rows);
    })().catch((err) => {
      console.error("getProviderOutgoingBookings error:", err);
      return res.status(500).json({ message: "Ошибка сервера" });
    });
  } catch (err) {
    console.error("getProviderOutgoingBookings error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Брони клиента (мой кабинет)
const getMyBookings = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const cols = await getExistingColumns("bookings", ["currency"]);
    const currencySel = cols.currency ? "b.currency" : `'USD'::text AS currency`;

    const q = await pool.query(
      `
      SELECT
        b.id, b.service_id, b.provider_id, b.client_id, b.status,
        b.client_message,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        b.provider_price, b.provider_note,
        b.created_at, b.updated_at,
        ${currencySel},

        COALESCE(
          (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d
            WHERE d.booking_id = b.id),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,

        s.title      AS service_title,

        /* поставщик услуги (для карточки клиента) */
        p.name       AS provider_name,
        p.type       AS provider_type,
        p.phone      AS provider_phone,
        p.address    AS provider_address,
        p.social     AS provider_telegram,

        /* фото поставщика в двух алиасах */
        p.photo      AS provider_photo,
        p.photo      AS provider_avatar_url

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

/* ================= actions ================= */

// Поставщик отправляет цену
async function providerQuote(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;
    const price = Number(req.body?.price);
    const note  = req.body?.note ?? null;
    const currency = req.body?.currency ?? null;

    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return res.status(400).json({ message: "Invalid booking id" });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ message: "Invalid price" });
    }

    const cols = await getExistingColumns("bookings", ["currency"]);
    const cur = cols.currency ? (currency || "USD") : null;

    // проверка принадлежности брони
    const qb = await pool.query(`SELECT provider_id, status FROM bookings WHERE id = $1`, [bookingId]);
    const row = qb.rows?.[0];
    if (!row || row.provider_id !== providerId) return res.status(403).json({ message: "Forbidden" });
    if (row.status !== "pending") return res.status(400).json({ message: "Действие недоступно для текущего статуса" });

    await pool.query(
      `
      UPDATE bookings
         SET provider_price = $1,
             provider_note  = $2,
             ${cols.currency ? "currency = $3," : ""}
             updated_at     = NOW()
       WHERE id = $4
      `,
      cols.currency ? [price, note, cur, bookingId] : [price, note, bookingId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("providerQuote error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Поставщик подтверждает (accept) входящую бронь — только если есть цена
async function acceptBooking(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;

    const qb = await pool.query(
      `SELECT provider_id, status, provider_price
         FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = qb.rows?.[0];
    if (!row || row.provider_id !== providerId) return res.status(403).json({ message: "Forbidden" });
    if (row.status !== "pending") return res.status(400).json({ message: "Доступно только для ожидающих" });
    if (!row.provider_price || Number(row.provider_price) <= 0) {
      return res.status(400).json({ message: "Сначала отправьте цену" });
    }

    // проверка дат (не заняты ли уже кем-то)
    const datesQ = await pool.query(
      `SELECT COALESCE(array_agg(date::date ORDER BY date), ARRAY[]::date[])
         FROM booking_dates WHERE booking_id = $1`,
      [bookingId]
    );
    const dates = datesQ.rows?.[0]?.coalesce || [];
    const free = await isDatesFree(providerId, dates, bookingId);
    if (!free) return res.status(409).json({ message: "Выбранные даты уже заняты" });

    await pool.query(
      `UPDATE bookings SET status = 'accepted', updated_at = NOW() WHERE id = $1 AND provider_id = $2`,
      [bookingId, providerId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("acceptBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Поставщик отклоняет входящую бронь
async function rejectBooking(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;
    const qb = await pool.query(
      `SELECT provider_id, status FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = qb.rows?.[0];
    if (!row || row.provider_id !== providerId) return res.status(403).json({ message: "Forbidden" });
    if (row.status !== "pending") return res.status(400).json({ message: "Доступно только для ожидающих" });

    await pool.query(
      `UPDATE bookings SET status = 'rejected', rejected_by = 'provider', updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("rejectBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Клиент отменяет свою бронь
async function cancelBooking(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const clientId = req.user?.id;

    const qb = await pool.query(`SELECT client_id, status FROM bookings WHERE id = $1`, [bookingId]);
    const row = qb.rows?.[0];
    if (!row || row.client_id !== clientId) return res.status(403).json({ message: "Forbidden" });
    if (!["pending", "accepted", "confirmed"].includes(row.status)) {
      return res.status(400).json({ message: "Нельзя отменить в текущем статусе" });
    }

    await pool.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_by = 'client', updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("cancelBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Клиент подтверждает после предложения цены
async function confirmBooking(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const clientId = req.user?.id;

    const qb = await pool.query(
      `SELECT client_id, status, provider_price, provider_id FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = qb.rows?.[0];
    if (!row || row.client_id !== clientId) return res.status(403).json({ message: "Forbidden" });
    if (row.status !== "pending") return res.status(400).json({ message: "Доступно только для ожидающих" });
    if (!row.provider_price || Number(row.provider_price) <= 0) {
      return res.status(400).json({ message: "Нет предложенной цены" });
    }

    // защита по датам
    const datesQ = await pool.query(
      `SELECT COALESCE(array_agg(date::date ORDER BY date), ARRAY[]::date[])
         FROM booking_dates WHERE booking_id = $1`,
      [bookingId]
    );
    const dates = datesQ.rows?.[0]?.coalesce || [];
    const free = await isDatesFree(row.provider_id, dates, bookingId);
    if (!free) return res.status(409).json({ message: "Выбранные даты уже заняты" });

    await pool.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("confirmBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Провайдер-заказчик подтверждает исходящую
async function confirmBookingByRequester(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;

    const qb = await pool.query(
      `SELECT requester_provider_id, status, provider_price, provider_id FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = qb.rows?.[0];
    if (!row || row.requester_provider_id !== providerId) return res.status(403).json({ message: "Forbidden" });
    if (row.status !== "pending") return res.status(400).json({ message: "Доступно только для ожидающих" });
    if (!row.provider_price || Number(row.provider_price) <= 0) {
      return res.status(400).json({ message: "Нет предложенной цены" });
    }

    // проверка дат
    const datesQ = await pool.query(
      `SELECT COALESCE(array_agg(date::date ORDER BY date), ARRAY[]::date[])
         FROM booking_dates WHERE booking_id = $1`,
      [bookingId]
    );
    const dates = datesQ.rows?.[0]?.coalesce || [];
    const free = await isDatesFree(row.provider_id, dates, bookingId);
    if (!free) return res.status(409).json({ message: "Выбранные даты уже заняты" });

    await pool.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("confirmBookingByRequester error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Провайдер-заказчик отменяет исходящую
async function cancelBookingByRequester(req, res) {
  try {
    const bookingId = Number(req.params.id);
    const providerId = req.user?.id;

    const qb = await pool.query(
      `SELECT requester_provider_id, status FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = qb.rows?.[0];
    if (!row || row.requester_provider_id !== providerId) return res.status(403).json({ message: "Forbidden" });
    if (!["pending", "accepted", "confirmed"].includes(row.status)) {
      return res.status(400).json({ message: "Нельзя отменить в текущем статусе" });
    }

    await pool.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_by = 'requester', updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("cancelBookingByRequester error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
}

module.exports = {
  createBooking,
  getProviderBookings,
  getProviderOutgoingBookings,
  getMyBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking,
  confirmBookingByRequester,
  cancelBookingByRequester,
};
