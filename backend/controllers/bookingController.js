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

// есть ли таблица
async function tableExists(table) {
  const q = await pool.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return q.rowCount > 0;
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
    // допускаем: гид, транспорт, отель, агент
    if (!["guide", "transport", "hotel", "agent"].includes(pType)) {
      return res.status(400).json({ message: "Бронирование доступно только для гида, транспорта, отеля или агента" });
    }

    const days = toArray(dates).map(toISO).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не указаны корректные даты" });

    const primaryDate = [...days].sort()[0];

   // Для отелей и агентств фильтра по доступности нет — не блокируем создание.
    // Для остальных типов проверяем как раньше.
    if (!["hotel", "agent"].includes(pType)) {
      const ok = await isDatesFree(providerId, days);
      if (!ok) return res.status(409).json({ message: "Даты уже заняты" });
    }

    // какие колонки реально есть
    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "requester_name",
      "requester_phone",
      "requester_telegram",
      "requester_email",
      "hold_until",       // <- для конвейера
      "code", "status",   // <- поддержим мягко
      "source",
      "group_id"
    ]);

    // базовые колонки
    const insertCols = ["service_id", "provider_id", "client_id", "date", "status", "client_message", "attachments"];
    const values = [
      service_id ?? null,
      providerId,
      userRole === "client" ? userId : null,
      primaryDate,
      "pending",
      message ?? null,
      JSON.stringify(attachments ?? []),
    ];

    // опциональная валюта
    if (cols.currency) {
      insertCols.push("currency");
      values.push(currency ?? null);
    }
    // сохраняем источник и группировку, если колонки есть
    if (cols.source) {
      insertCols.push("source");
      values.push(req.body?.source ?? null);
    }
    if (cols.group_id) {
      insertCols.push("group_id");
      values.push(req.body?.group_id ?? null);
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

    // Явно приводим типы в плейсхолдерах:
    // - date        → ::date
    // - *_id        → ::int
    // - group_id    → ::uuid
    const placeholders = insertCols
      .map((name, i) => {
        const p = `$${i + 1}`;
        if (name === "date") return `${p}::date`;
        if (name === "group_id") return `${p}::uuid`;
        if (
          name === "service_id" ||
          name === "provider_id" ||
          name === "client_id"
        ) return `${p}::int`;
        return p;
      })
      .join(",");

    const ins = await pool.query(
      `INSERT INTO bookings (${insertCols.join(",")})
       VALUES (${placeholders})
       RETURNING id, status, provider_id, service_id`,
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
      provider_id: ins.rows[0].provider_id,
      service_id: ins.rows[0].service_id,
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
        b.source, b.group_id,
        COALESCE(b.attachments::jsonb, '[]'::jsonb) AS attachments,

        ${selectCurrency},
        ${selectRequester},

        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(bd.date::date ORDER BY bd.date), NULL),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,

        s.title AS service_title,

        c.id         AS client_profile_id,
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
        b.source, b.group_id,
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
        b.source, b.group_id,
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
             status         = 'quoted',
             updated_at     = NOW()
       WHERE id = $1 AND provider_id = $4
       RETURNING id, provider_price, provider_note, status
    `;
    
    const params = [bookingId, price, note, providerId];

    if (cols.currency) {
      sql = `
        UPDATE bookings
           SET provider_price = $2,
               provider_note  = $3,
               currency       = COALESCE($5, currency),
               status         = 'quoted',
               updated_at     = NOW()
         WHERE id = $1 AND provider_id = $4
         RETURNING id, provider_price, provider_note, currency, status
      `;
      params.push(currency);
    }

    const q = await pool.query(sql, params);

    if (!q.rowCount) return res.status(404).json({ message: "Booking not found" });
    res.json({ ok: true, booking: q.rows[0] });

    try {
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, status
           FROM bookings WHERE id=$1`,
        [bookingId]
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
    } catch (e) {
      console.error("providerQuote notify block failed:", e?.message || e);
    }
  } catch (err) {
    console.error("providerQuote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/** Возвращает запись брони с минимальным набором полей */
async function getBookingRow(id) {
  const q = await pool.query(
    `SELECT id, provider_id, client_id, status, created_at,
            (CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_name='bookings' AND column_name='hold_until'
             ) THEN hold_until ELSE NULL END) AS hold_until
       FROM bookings
      WHERE id=$1`,
    [id]
  );
  return q.rows[0] || null;
}

/** Авто-отмена неоплаченной брони, если окно оплаты истекло. */
async function autoExpireIfOverdue(bookingId) {
  const b = await getBookingRow(bookingId);
  if (!b) return null;
  if (b.status !== "awaiting_payment") return b;
  // дедлайн: hold_until если есть, иначе created_at + 30 минут
  const q = await pool.query(
    `SELECT
       COALESCE(
         (SELECT CASE WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_name='bookings' AND column_name='hold_until'
           )
           THEN (SELECT hold_until FROM bookings WHERE id=$1)
           ELSE NULL END),
         (SELECT created_at + INTERVAL '30 minutes' FROM bookings WHERE id=$1)
       ) AS due_at`,
    [bookingId]
  );
  const dueAt = q.rows[0]?.due_at ? new Date(q.rows[0].due_at) : null;
  if (dueAt && dueAt > new Date()) return b; // ещё не истёк

  const cols = await getExistingColumns("bookings", ["cancelled_by"]);
  let sql = `
    UPDATE bookings
       SET status='cancelled_unpaid',
           updated_at = NOW()`;
  if (cols.cancelled_by) sql += `, cancelled_by='system'`;
  sql += ` WHERE id=$1 RETURNING *`;
  const upd = await pool.query(sql, [bookingId]);
  const bb = upd.rows[0];
  try { await tg.notifyBookingAutoCancelled?.(bb); } catch {}
  return bb;
}

// Провайдер подтверждает входящую бронь (теперь именно он финально подтверждает)
const acceptBooking = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid booking id" });

    const own = await pool.query(
      `SELECT provider_id, status FROM bookings WHERE id=$1`,
      [id]
    );
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (own.rows[0].status !== "pending") {
      return res.status(409).json({ message: "Бронирование уже обработано" });
    }

    // Даты: для отеля — подтверждаем без проверки; для остальных проверяем
    const type = await getProviderType(providerId);
    let days = [];
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`, [id]);
    days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);
    if (!days.length) {
      const bQ = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bQ.rowCount) days = [toISO(bQ.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "У брони нет дат" });

    if (!["hotel", "agent"].includes(type)) {
      const free = await isDatesFree(providerId, days, id);
      if (!free) return res.status(409).json({ message: "Даты уже заняты" });
    }

    // после принятия ждём оплату 30 минут
    const cols = await getExistingColumns("bookings", ["hold_until"]);
    const sql = cols.hold_until
      ? `UPDATE bookings
            SET status='awaiting_payment',
                hold_until = NOW() + INTERVAL '30 minutes',
                updated_at = NOW()
          WHERE id=$1`
      : `UPDATE bookings
            SET status='awaiting_payment',
                updated_at = NOW()
          WHERE id=$1`;
    await pool.query(sql, [id]);
    res.json({ ok: true, status: "awaiting_payment" });

    // TG уведомление о подтверждении поставщиком
    try {
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, requester_provider_id
           FROM bookings WHERE id=$1`, [id]
      );
      const dQ2 = await pool.query(
        `SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]
      );
      const booking = {
        ...bQ.rows[0],
        dates: dQ2.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d)))
      };
      (tg.notifyBookingAcceptedAwaitingPayment
        ? tg.notifyBookingAcceptedAwaitingPayment({ booking })
        : tg.notifyConfirmed?.({ booking, by: "provider" })
      )?.catch?.(() => {});
    } catch (e) {
      console.error("acceptBooking notify block failed:", e?.message || e);
    }
  } catch (err) {
    console.error("acceptBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Провайдер отклоняет (входящую)
const rejectBooking = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    const { reason } = req.body || {};

    const pType = await getProviderType(providerId);
    if (!["guide", "transport", "hotel", "agent"].includes(pType)) {
      return res.status(400).json({ message: "Действие доступно только для гида, транспорта или отеля" });
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
    } catch (e) {
      console.error("rejectBooking notify block failed:", e?.message || e);
    }
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
    } catch (e) {
      console.error("cancelBooking notify block failed:", e?.message || e);
    }
  } catch (err) {
    console.error("cancelBooking error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ========= provider cancel (reason + penalty) ========= */
async function penalizeProvider(providerId, delta = -0.2) {
  try {
    const cols = await getExistingColumns("providers", ["rating", "cancel_penalty", "cancellations"]);
    if (cols.rating) {
      await pool.query(
        `UPDATE providers
            SET rating = GREATEST(0, LEAST(5, COALESCE(rating,3) + $2)),
                updated_at = NOW()
         WHERE id=$1`,
        [providerId, delta]
      );
    } else if (cols.cancel_penalty) {
      await pool.query(
        `UPDATE providers SET cancel_penalty = COALESCE(cancel_penalty,0)+1 WHERE id=$1`,
        [providerId]
      );
    }
    if (cols.cancellations) {
      await pool.query(
        `UPDATE providers SET cancellations = COALESCE(cancellations,0)+1 WHERE id=$1`,
        [providerId]
      );
    }
  } catch {}
}

// Поставщик отменяет входящую бронь
const cancelBookingByProvider = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const id = Number(req.params.id);
    const { reason } = req.body || {};

    const own = await pool.query(`SELECT provider_id, status FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    const wasConfirmed = own.rows[0].status === "confirmed";
    if (wasConfirmed && !reason) {
      return res.status(400).json({ message: "Укажите причину отмены согласованной брони" });
    }

    const cols = await getExistingColumns("bookings", ["cancelled_by"]);
    let sql = `UPDATE bookings
                  SET status='cancelled',
                      provider_note = COALESCE($2, provider_note),
                      updated_at = NOW()`;
    if (cols.cancelled_by) sql += `, cancelled_by='provider'`;
    sql += ` WHERE id=$1`;
    await pool.query(sql, [id, reason ?? null]);

    if (wasConfirmed) await penalizeProvider(providerId, -0.2);

    try {
      const bQ = await pool.query(
        `SELECT id, provider_id, client_id, requester_provider_id FROM bookings WHERE id=$1`,
        [id]
      );
      const dQ = await pool.query(
        `SELECT date AS d FROM booking_dates WHERE booking_id=$1`,
        [id]
      );
      const booking = {
        ...bQ.rows[0],
        dates: dQ.rows.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d))),
      };
      await tg.notifyCancelled({ booking, by: "provider", reason });
    } catch (e) {
      console.error("cancelByProvider notify failed:", e?.message || e);
    }
    return res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    console.error("cancelBookingByProvider error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Клиент подтверждает своё бронирование (после предложения цены поставщиком)
const confirmBooking = async (req, res) => {
  try {
    const clientId = req.user?.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid booking id" });

    // проверим владение и текущий статус
    const bQ = await pool.query(
      `SELECT id, provider_id, client_id, status
         FROM bookings WHERE id=$1`,
      [id]
    );
    if (!bQ.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    const b = bQ.rows[0];
    if (b.client_id !== clientId) return res.status(403).json({ message: "Недостаточно прав" });

    // подтверждать можно из состояний "quoted" (и на всякий случай "pending")
    if (!["quoted", "pending"].includes(b.status)) {
      return res.status(409).json({ message: "Подтверждение недоступно для текущего статуса" });
    }

    // собрать даты
    const dQ = await pool.query(
      `SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`,
      [id]
    );
    let days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);
    if (!days.length) {
      const bD = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bD.rowCount) days = [toISO(bD.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "У брони нет дат" });

    // отель — без проверки; остальные — проверка занятости
    const pType = await getProviderType(b.provider_id);
    if (!["hotel", "agent"].includes(pType)) {
      const free = await isDatesFree(b.provider_id, days, id);
      if (!free) return res.status(409).json({ message: "Даты уже заняты" });
    }

    // подтверждаем
    const cols = await getExistingColumns("bookings", ["hold_until"]);
    const clearHold = cols.hold_until ? `, hold_until = NULL` : ``;
    const up = await pool.query(
      `UPDATE bookings
          SET status='confirmed',
              updated_at = NOW()${clearHold}
        WHERE id=$1
      RETURNING *`,
      [id]
    );
    const booking = up.rows[0];

    // TG
    try {
      (tg.notifyConfirmed || tg.notifyBookingPaidConfirmed)?.({ booking, by: "client" });
    } catch {}

    return res.json(booking);
  } catch (err) {
    console.error("confirmBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Если бронирует провайдер (requester_provider_id) — он тоже может подтвердить
const confirmBookingByRequester = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid booking id" });

    const support = await getExistingColumns("bookings", ["requester_provider_id", "hold_until"]);
    if (!support.requester_provider_id) {
      return res.status(400).json({ message: "Функция недоступна (нет поддержки в БД)" });
    }

    const bQ = await pool.query(
      `SELECT id, provider_id, requester_provider_id, status
         FROM bookings WHERE id=$1`,
      [id]
    );
    if (!bQ.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    const b = bQ.rows[0];
    if (b.requester_provider_id !== requesterId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!["quoted", "pending"].includes(b.status)) {
      return res.status(409).json({ message: "Подтверждение недоступно для текущего статуса" });
    }

    // даты
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`, [id]);
    const days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "У брони нет дат" });

    // отель — без проверки
    const pType = await getProviderType(b.provider_id);
    if (!["hotel", "agent"].includes(pType)) {
      const free = await isDatesFree(b.provider_id, days, id);
      if (!free) return res.status(409).json({ message: "Даты уже заняты" });
    }

    const clearHold = support.hold_until ? `, hold_until = NULL` : ``;
    const up = await pool.query(
      `UPDATE bookings
          SET status='confirmed', updated_at=NOW()${clearHold}
        WHERE id=$1
      RETURNING *`,
      [id]
    );
    const booking = up.rows[0];
    try { (tg.notifyConfirmed || tg.notifyBookingPaidConfirmed)?.({ booking, by: "requester" }); } catch {}
    return res.json(booking);
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
    } catch (e) {
      console.error("cancelBookingByRequester notify block failed:", e?.message || e);
    }
    return res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    console.error("cancelBookingByRequester error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ================= NEW: Booking Conveyor endpoints ================= */

/**
 * POST /api/bookings/:id/check-availability
 * Возвращает список дат со статусом: ok | conflict
 * Не меняет запись в БД — чисто проверка для панельки Availability.
 */
const checkAvailability = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const bQ = await pool.query(`SELECT provider_id FROM bookings WHERE id=$1`, [id]);
    if (!bQ.rowCount) return res.status(404).json({ message: "Бронь не найдена" });
    // провайдер может ставить hold только на свою бронь
    if (req.user?.role === "provider" && bQ.rows[0].provider_id !== req.user.id) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    const providerId = bQ.rows[0].provider_id;
    const pType = await getProviderType(providerId);

    // собираем даты
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`, [id]);
    let days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);
    if (!days.length) {
      const bD = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bD.rowCount) days = [toISO(bD.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "У брони нет дат" });

    // Для отелей и агентств — фильтра нет: считаем всё ok
    if (pType === "hotel" || pType === "agent") {
      const results = days.map(ymd => ({ date: ymd, status: "ok" }));
      return res.json({ ok: true, overall: "ok", results });
    }

    // Для остальных — старая логика
    const results = [];
    for (const ymd of days) {
      const free = await isDatesFree(providerId, [ymd], id);
      results.push({ date: ymd, status: free ? "ok" : "conflict" });
    }
    const allOk = results.every(r => r.status === "ok");
    return res.json({ ok: true, overall: allOk ? "ok" : "conflict", results });
  } catch (err) {
    console.error("checkAvailability error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/**
 * POST /api/bookings/:id/place-hold
 * Ставит дедлайн (hold_until). Если есть таблица supplier_orders — создаёт по 1 заявке (MVP).
 * Body: { hours?: number, payload?: any }
 */
const placeHold = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.max(1, Math.min(240, Number(req.body?.hours ?? 24))); // 1..240 часов
    const payload = req.body?.payload ?? {};

    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const bQ = await pool.query(
      `SELECT id, provider_id, client_id, status
         FROM bookings WHERE id=$1`,
      [id]
    );
    if (!bQ.rowCount) return res.status(404).json({ message: "Бронь не найдена" });

    // соберём даты
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`, [id]);
    const days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);

    // проверим конфликт только для не-отелей
    const providerId = bQ.rows[0].provider_id;
    const pType = await getProviderType(providerId);
    if (!["hotel", "agent"].includes(pType)) {
      const free = await isDatesFree(providerId, days, id);
      if (!free) return res.status(409).json({ message: "Даты уже заняты" });
    }

    const cols = await getExistingColumns("bookings", ["hold_until"]);
    const untilSql = cols.hold_until
      ? `, hold_until = NOW() + $2::interval`
      : ``;

    await pool.query(
      `UPDATE bookings
          SET updated_at = NOW()${untilSql}
        WHERE id=$1
      RETURNING id`,
      cols.hold_until ? [id, `${hours} hours`] : [id]
    );

    // supplier_orders если таблица существует
    if (await tableExists("supplier_orders")) {
      await pool.query(
        `INSERT INTO supplier_orders (booking_id, supplier_id, status, hold_until, payload)
         VALUES ($1,$2,'held', NOW() + $3::interval, $4::jsonb)`,
        [id, providerId, `${hours} hours`, JSON.stringify(payload)]
      );
    }

    // TG — уведомление про hold
    try {
      const booking = { id, provider_id: providerId, dates: days };
      tg.notifyHoldPlaced({ booking, hours }).catch(() => {});
    } catch {}

    return res.json({ ok: true, hold_until_in: `${hours}h` });
  } catch (err) {
    console.error("placeHold error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/**
 * GET /api/bookings/:id/docs
 * Заглушка для UI: возвращает ссылки/метаданные документов (пока без генерации PDF).
 * Позже сюда добавим генерацию инвойса/ваучеров/itinerary.
 */
const getBookingDocs = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });

    const bQ = await pool.query(
      `SELECT b.id, b.service_id, b.provider_id, b.client_id, b.status,
              COALESCE((SELECT array_agg(d.date::date ORDER BY d.date)
                          FROM booking_dates d WHERE d.booking_id=b.id), ARRAY[]::date[]) AS dates
         FROM bookings b
        WHERE b.id=$1`,
      [id]
    );
    if (!bQ.rowCount) return res.status(404).json({ message: "Бронь не найдена" });

    const b = bQ.rows[0];

    // Пока отдаём "виртуальные" ссылки — UI может их отрисовать.
    // Позже заменим на реальные URL генераторов PDF/Excel.
    const base = `/api/bookings/${id}/docs`;
    const docs = {
      invoice_pdf:      `${base}/invoice.pdf`,
      voucher_pdf:      `${base}/voucher.pdf`,
      rooming_list_xlsx:`${base}/rooming-list.xlsx`,
      itinerary_pdf:    `${base}/itinerary.pdf`,
      share_url:        `${base}/share`, // публичный просмотр (в будущем)
    };

    return res.json({ ok: true, booking: b, docs });
  } catch (err) {
    console.error("getBookingDocs error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};
/** GET /api/bookings/:id — мета + авто-истечение */
const getBooking = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const b = await autoExpireIfOverdue(id);
    if (!b) return res.status(404).json({ message: "Бронь не найдена" });
    return res.json(b);
  } catch (err) {
    console.error("getBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/** POST /api/bookings/:id/pay — маркёр успешной оплаты */
const markPaid = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const snap = await autoExpireIfOverdue(id);
    if (!snap) return res.status(404).json({ message: "Бронь не найдена" });
    if (snap.status === "cancelled_unpaid") {
      return res.status(409).json({ message: "Payment window expired" });
    }
    if (snap.status !== "awaiting_payment") {
      return res.json(snap); // уже оплачен/отменён — идемпотентно
    }
    const cols = await getExistingColumns("bookings", ["hold_until"]);
    const clearHold = cols.hold_until ? `, hold_until = NULL` : ``;
    const up = await pool.query(
      `UPDATE bookings
          SET status='confirmed',
              updated_at = NOW()${clearHold}
        WHERE id=$1
      RETURNING *`,
      [id]
    );
    const booking = up.rows[0];
    try { (tg.notifyBookingPaidConfirmed || tg.notifyConfirmed)?.({ booking, by: "payment" }); } catch {}
    return res.json(booking);
  } catch (err) {
    console.error("markPaid error:", err);
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
  cancelBookingByProvider,

  // NEW
  checkAvailability,
  placeHold,
  getBookingDocs,
  getBooking,
  markPaid,
};
