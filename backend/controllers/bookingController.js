// --- helpers ---
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Надёжный нормализатор дат в ISO (YYYY-MM-DD)
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

// Проверка доступности набора дат для провайдера
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

  // 2) нет пересечений с активными/ожидающими бронями
  let sql =
    `SELECT 1
       FROM booking_dates bd
       JOIN bookings b ON b.id = bd.booking_id
      WHERE b.provider_id=$1
        AND b.status IN ('pending','active')
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

/**
 * POST /api/bookings
 * body: { service_id?, provider_id?, dates:[YYYY-MM-DD], message?, attachments? }
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

// Принять бронь провайдером: POST /api/bookings/:id/accept
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

    // берём как есть, нормализуем в JS
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1`, [id]);
    const days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не удалось определить даты бронирования" });

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

// Клиент подтверждает бронь: POST /api/bookings/:id/confirm
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

    // Берём даты из booking_dates без кастов, нормализуем
    const dQ = await pool.query(
      `SELECT date AS d FROM booking_dates WHERE booking_id=$1`,
      [id]
    );
    let days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);

    // Фолбэк: если почему-то пусто — берём опорную дату из bookings
    if (!days.length) {
      const bQ = await pool.query(`SELECT date AS d FROM bookings WHERE id=$1`, [id]);
      if (bQ.rowCount) days = [toISO(bQ.rows[0].d)].filter(Boolean);
    }
    if (!days.length) return res.status(400).json({ message: "Не удалось определить даты бронирования" });

    const ok = await isDatesFree(own.rows[0].provider_id, days, id);
    if (!ok) return res.status(409).json({ message: "Даты уже заняты" });

    await pool.query(
      `UPDATE bookings
         SET status='active',
             updated_at = NOW()
       WHERE id=$1`,
      [id]
    );

    return res.json({ ok: true, status: "active" });
  } catch (err) {
    console.error("confirmBooking error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};
