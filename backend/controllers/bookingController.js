// backend/controllers/bookingController.js
const pool = require("../db");
const tg = require("../utils/telegram");

/* ================= helpers ================= */

// универсально: есть ли такие колонки в таблице
async function getExistingColumns(table, cols = []) {
  const q = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = $1
        AND column_name = ANY($2::text[])`,
    [table, cols]
  );
  const set = new Set(q.rows.map((r) => r.column_name));
  return cols.reduce((acc, c) => ((acc[c] = set.has(c)), acc), {});
}

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

async function getProviderProfile(providerId) {
  const q = await pool.query(
    `SELECT id, name, phone, email, social AS telegram
       FROM providers
      WHERE id=$1`,
    [providerId]
  );
  return q.rows[0] || null;
}

/**
 * Проверка доступности набора дат для провайдера.
 * excludeBookingId — игнорировать конкретную бронь (на accept/confirm).
 * ВАЖНО: Даты блокируют только 'confirmed' и ручные блокировки provider_blocked_dates.
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
        AND b.status IN ('confirmed')
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
 * body: { service_id?, provider_id?, dates:[YYYY-MM-DD], message?, attachments?:[{name,type,dataUrl}], currency? }
 * Требуется токен (client_id берём из req.user.id, если пользователь — клиент)
 * Если пользователь — провайдер, дополнительно (ОПЦИОНАЛЬНО) сохраняем requester_* если эти колонки есть.
 */
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
    const values = [
      service_id ?? null,
      providerId,
      userRole === "client" ? userId : null,
      primaryDate, // <-- ОБЯЗАТЕЛЬНО
      "pending",
      message ?? null,
      JSON.stringify(attachments ?? []),
    ];

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
    const placeholders = insertCols
      .map((name, i) => (name === "date" ? `$${i + 1}::date` : `$${i + 1}`))
      .join(",");

    const ins = await pool.query(
      `INSERT INTO bookings (${insertCols.join(",")})
       VALUES (${placeholders})
       RETURNING id, status`,
      values
    );
    const bookingId = ins.rows[0].id;

    // сохраняем все выбранные даты в booking_dates
    for (const d of days) {
      await pool.query(
        `INSERT INTO booking_dates (booking_id, date) VALUES ($1,$2::date)`,
        [bookingId, d]
      );
    }

    res.status(201).json({ id: bookingId, status: "pending", dates: days });
    const bkg = {
      id: bookingId,
      provider_id: providerId,
      dates: days,
      client_message: message ?? null,
    };
const service = { title: (await pool.query(`SELECT title FROM services WHERE id=$1`, [service_id ?? null])).rows[0]?.title || null };
const client = userRole === "client"
  ? (await pool.query(`SELECT name FROM clients WHERE id=$1`, [userId])).rows[0]
  : null;

tg.notifyNewRequest({ booking: bkg, provider: null, client, service }).catch(e => {
  console.error("tg.notifyNewRequest failed:", e?.response?.data || e?.message || e);
});
  } catch (err) {
    console.error("createBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ВХОДЯЩИЕ брони провайдера (мои услуги)
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
      "rejected_by",
      "cancelled_by",
    ]);

    const selectCurrency = cols.currency ? `b.currency` : `'USD'::text AS currency`;
    const selectBy = `
      ${cols.rejected_by ? "b.rejected_by" : "NULL::text AS rejected_by"},
      ${cols.cancelled_by ? "b.cancelled_by" : "NULL::text AS cancelled_by"}
    `;

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
        b.status, ${selectBy}, b.created_at, b.updated_at,
        b.client_message, b.provider_note, b.provider_price,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,

        ${selectCurrency},
        ${selectRequester},

        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(bd.date::date ORDER BY bd.date), NULL),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,

        s.title AS service_title,

        c.id         AS client_id,
        c.name       AS client_name,
        c.phone      AS client_phone,
        c.email      AS client_email,
        c.telegram   AS client_social,
        c.location   AS client_address,
        c.avatar_url AS client_avatar_url,

        p.id       AS provider_profile_id,
        p.name     AS provider_name,
        p.type     AS provider_type,
        p.phone    AS provider_phone,
        p.email    AS provider_email,
        p.social   AS provider_social,
        p.address  AS provider_address,
        p.location AS provider_location,
        p.photo    AS provider_photo,
        p.photo    AS provider_avatar_url,

        rp.photo   AS requester_photo,
        rp.photo   AS requester_avatar_url,
        rp.type    AS requester_type

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


// ИСХОДЯЩИЕ (я — провайдер, бронирую чужую услугу)
async function getProviderOutgoingBookings(req, res) {
  try {
    const providerId = req.user?.id;
    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "rejected_by",
      "cancelled_by",
    ]);

    if (!cols.requester_provider_id) {
      return res.json([]);
    }

    const selectCurrency = cols.currency ? "b.currency" : `'USD'::text AS currency`;
    const selectBy = `
      ${cols.rejected_by ? "b.rejected_by" : "NULL::text AS rejected_by"},
      ${cols.cancelled_by ? "b.cancelled_by" : "NULL::text AS cancelled_by"}
    `;

    const sql = `
      SELECT
        b.id, b.provider_id, b.service_id, b.client_id,
        b.status, ${selectBy}, b.created_at, b.updated_at,
        b.client_message, b.provider_note, b.provider_price,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        ${selectCurrency},
        b.requester_provider_id,
        b.requester_name, b.requester_phone, b.requester_telegram, b.requester_email,
        COALESCE(
          (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d
            WHERE d.booking_id = b.id),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title AS service_title,
        p.name    AS provider_name,
        p.photo   AS provider_photo,
        p.photo   AS provider_avatar_url,
        p.type    AS provider_type,
        p.phone   AS provider_phone,
        p.address AS provider_address,
        p.social  AS provider_telegram
      FROM bookings b
      LEFT JOIN services  s ON s.id = b.service_id
      LEFT JOIN providers p ON p.id = b.provider_id
      WHERE b.requester_provider_id = $1
      ORDER BY b.created_at DESC NULLS LAST
    `;
    const q = await pool.query(sql, [providerId]);
    return res.json(q.rows);
  } catch (err) {
    console.error("getProviderOutgoingBookings error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
}

// Брони клиента (мой кабинет)
const getMyBookings = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const cols = await getExistingColumns("bookings", ["currency", "rejected_by", "cancelled_by"]);
    const selectCurrency = cols.currency ? "b.currency" : `'USD'::text AS currency`;
    const selectBy = `
      ${cols.rejected_by ? "b.rejected_by" : "NULL::text AS rejected_by"},
      ${cols.cancelled_by ? "b.cancelled_by" : "NULL::text AS cancelled_by"}
    `;

    const q = await pool.query(
      `
      SELECT
        b.id, b.service_id, b.provider_id, b.client_id,
        b.status, ${selectBy},
        b.client_message,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,
        b.provider_price, b.provider_note,
        b.created_at, b.updated_at,
        ${selectCurrency},
        COALESCE(
          (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d
            WHERE d.booking_id = b.id),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title AS service_title,
        p.name    AS provider_name,
        p.photo   AS provider_photo,
        p.photo   AS provider_avatar_url,
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


// Провайдер отправляет цену/комментарий
const providerQuote = async (req, res) => {
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

    let sql = `
      UPDATE bookings
         SET provider_price = $2,
             provider_note  = $3,
             updated_at     = NOW()
       WHERE id = $1 AND provider_id = $4
       RETURNING id, provider_price, provider_note
    `;
    const params = [bookingId, price, note, providerId];

    if (cols.currency) {
      sql = `
        UPDATE bookings
           SET provider_price = $2,
               provider_note  = $3,
               currency       = COALESCE($5, currency),
               updated_at     = NOW()
         WHERE id = $1 AND provider_id = $4
         RETURNING id, provider_price, provider_note, currency
      `;
      params.push(currency);
    }

    const q = await pool.query(sql, params);

    if (!q.rowCount) return res.status(404).json({ message: "Booking not found" });
    res.json({ ok: true, booking: q.rows[0] });
        try {
      // узнаём даты и booking поля
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, requester_provider_id
           FROM bookings WHERE id=$1`, [bookingId]
      );
      const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [bookingId]);
      const booking = {
        ...bQ.rows[0],
        dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
      };
      tg.notifyQuote({
        booking,
        price: Number(price),
        currency,
        note,
      }).catch(e => {
        console.error("tg.notifyQuote failed:", e?.response?.data || e?.message || e);
      });
    } catch {}

  } catch (err) {
    console.error("providerQuote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Провайдер подтверждает входящую бронь
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
        try {
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, requester_provider_id
           FROM bookings WHERE id=$1`, [id]
      );
      const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
      const booking = {
        ...bQ.rows[0],
        dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
      };
      tg.notifyConfirmed({ booking }).catch(e => {
        console.error("tg.notifyConfirmed failed:", e?.response?.data || e?.message || e);
      });
    } catch {}

  } catch (err) {
    console.error("acceptBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Провайдер отклоняет (входящую)
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

    
  const cols = await getExistingColumns("bookings", ["rejected_by"]);
  let sql = `
    UPDATE bookings
       SET status='rejected',
           provider_note = COALESCE($1, provider_note),
           updated_at = NOW()`;
  const params = [reason ?? null, id];
  if (cols.rejected_by) sql += `, rejected_by='provider'`;
  sql += ` WHERE id=$2`;
  await pool.query(sql, params);
    res.json({ ok: true, status: "rejected" });

    try {
  const bQ = await pool.query(
    `SELECT id, provider_id, client_id, requester_provider_id
       FROM bookings WHERE id=$1`, [id]
  );
  const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
  const booking = {
    ...bQ.rows[0],
    dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
  };
  tg.notifyRejected({ booking, reason }).catch(e => {
  console.error("tg.notifyRejected failed:", e?.response?.data || e?.message || e);
});
} catch {}

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

 const cols = await getExistingColumns("bookings", ["cancelled_by"]);
  let sql = `
    UPDATE bookings
       SET status='cancelled',
           updated_at = NOW()`;
  if (cols.cancelled_by) sql += `, cancelled_by='client'`;
  sql += ` WHERE id=$1`;
  await pool.query(sql, [id]);
    res.json({ ok: true, status: "cancelled" });

    try {
  const bQ = await pool.query(
    `SELECT id, provider_id, client_id, requester_provider_id
       FROM bookings WHERE id=$1`, [id]
  );
  const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
  const booking = {
    ...bQ.rows[0],
    dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
  };
  tg.notifyCancelled({ booking }).catch(e => {
  console.error("tg.notifyCancelled failed:", e?.response?.data || e?.message || e);
});
} catch {}

    
  } catch (err) {
    console.error("cancelBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Клиент подтверждает: POST /api/bookings/:id/confirm
const confirmBooking = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const id = Number(req.params.id);

    const own = await pool.query(
      `SELECT provider_id, client_id, status FROM bookings WHERE id=$1`,
      [id]
    );
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].client_id !== clientId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (own.rows[0].status !== "pending") {
      return res.status(409).json({ message: "Бронирование уже обработано" });
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

      res.json({ ok: true, status: "confirmed" });

  // TG: сообщаем о подтверждении клиентом
  try {
    const bQ = await pool.query(
      `SELECT id, provider_id, client_id, requester_provider_id
         FROM bookings WHERE id=$1`, [id]
    );
    const dQ = await pool.query(
      `SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]
    );
    const booking = {
      ...bQ.rows[0],
      dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
    };
    tg.notifyConfirmed({ booking }).catch(e => {
  console.error("tg.notifyConfirmed failed:", e?.response?.data || e?.message || e);
});
  } catch {}
    
  } catch (err) {
    console.error("confirmBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Подтверждение исходящей провайдером-заказчиком (если колонка requester_provider_id существует)
const confirmBookingByRequester = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const id = Number(req.params.id);
    const cols = await getExistingColumns("bookings", ["requester_provider_id"]);
    if (!cols.requester_provider_id) return res.status(400).json({ message: "Функция недоступна (нет поддержки в БД)" });

    const own = await pool.query(`SELECT requester_provider_id, provider_id, status FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].requester_provider_id !== requesterId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (own.rows[0].status !== "pending") {
      return res.status(409).json({ message: "Бронирование уже обработано" });
    }

    
    // Проверяем, что на эти даты нет другого confirmed
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
    let days = dQ.rows.map((r) => toISO(r.d)).filter(Boolean);
    if (!days.length) {
      const bQ = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bQ.rowCount) days = [toISO(bQ.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "Не удалось определить даты бронирования" });

    const providerId = own.rows[0].provider_id;
    const ok = await isDatesFree(providerId, days, id);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    await pool.query(`UPDATE bookings SET status='confirmed', updated_at=NOW() WHERE id=$1`, [id]);
      res.json({ ok: true, status: "confirmed" });

  // TG: подтверждение исходящей поставщиком-заявителем
  try {
    const bQ = await pool.query(
      `SELECT id, provider_id, client_id, requester_provider_id
         FROM bookings WHERE id=$1`, [id]
    );
    const dQ = await pool.query(
      `SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]
    );
    const booking = {
      ...bQ.rows[0],
      dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
    };
    tg.notifyConfirmed({ booking }).catch(e => {
  console.error("tg.notifyConfirmed failed:", e?.response?.data || e?.message || e);
});

  } catch {}
  } catch (err) {
    console.error("confirmBookingByRequester error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

const cancelBookingByRequester = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const id = Number(req.params.id);

    const support = await getExistingColumns("bookings", ["requester_provider_id", "cancelled_by"]);
    if (!support.requester_provider_id) {
      return res.status(400).json({ message: "Функция недоступна (нет поддержки в БД)" });
    }

    const own = await pool.query(`SELECT requester_provider_id FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].requester_provider_id !== requesterId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    let sql = `UPDATE bookings SET status='cancelled', updated_at=NOW()`;
    if (support.cancelled_by) sql += `, cancelled_by='requester'`;
    sql += ` WHERE id=$1`;
    await pool.query(sql, [id]);

    // TG: отмена исходящей поставщиком-заявителем
          
    try {
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, requester_provider_id
           FROM bookings WHERE id=$1`, [id]
      );
      const dQ = await pool.query(
        `SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]
      );
      const booking = {
        ...bQ.rows[0],
        dates: dQ.rows.map(r =>
          (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d))
        )
      };
      tg.notifyCancelledByRequester({ booking }).catch(e => {
  console.error("tg.notifyCancelledByRequester failed:", e?.response?.data || e?.message || e);
});

    } catch {}

    return res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    console.error("cancelBookingByRequester error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};


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
