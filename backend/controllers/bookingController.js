// backend/controllers/bookingController.js

const pool = require("../db");
const tg = require("../utils/telegram");
const { randomUUID } = require("crypto");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { HotelInventoryError, quotedHotelPrice, reserveHotelInventory } = require("../utils/hotelInventory");
const { ensureHotelOfferTables } = require("../utils/hotelOffersSchema");

function buildPaymeCheckoutUrl({ orderId, amountTiyin, redirectUrl }) {
  const merchantId = process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID || "";
  if (!merchantId) throw new Error("PAYME_MERCHANT_ID_MISSING");
  const checkoutBase = String(process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz").replace(/\/+$/, "");
  const raw = [`m=${merchantId}`, `ac.order_id=${orderId}`, `a=${amountTiyin}`, redirectUrl ? `c=${redirectUrl}` : ""]
    .filter(Boolean)
    .join(";");
  return `${checkoutBase}/${Buffer.from(raw, "utf8").toString("base64")}`;
}

function isHotelInventoryHoldExpired(error) {
  return String(error?.message || '').includes('hotel_inventory_hold_expired');
}

function isBookingAdmin(user = {}) {
  const roles = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])]
    .map((role) => String(role || '').toLowerCase());
  return user.is_admin === true || user.is_moderator === true || roles.includes('admin') || roles.includes('moderator');
}

function canAccessBooking(user = {}, booking = {}, { payment = false } = {}) {
  if (isBookingAdmin(user)) return true;
  const userId = Number(user.id);
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'client') return Number(booking.client_id) === userId;
  if (role === 'provider') {
    if (Number(booking.requester_provider_id) === userId) return true;
    return !payment && Number(booking.provider_id) === userId;
  }
  return false;
}

function canActAsBookingPayer(user = {}, booking = {}) {
  const userId = Number(user.id);
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'client') return Number(booking.client_id) === userId;
  if (role === 'provider') return Number(booking.requester_provider_id) === userId;
  return false;
}

function canPlaceBookingHold(user = {}, booking = {}) {
  if (String(user.role || '').toLowerCase() !== 'provider') return false;
  if (Number(user.id) !== Number(booking.provider_id)) return false;
  const terminalStatuses = new Set(['rejected', 'cancelled', 'cancelled_unpaid', 'expired', 'confirmed', 'completed', 'paid']);
  return !terminalStatuses.has(String(booking.status || '').toLowerCase());
}

function canMarkBookingPaid(user = {}) {
  return isBookingAdmin(user);
}

function canProviderQuoteStatus(status) {
  return ['pending', 'quoted'].includes(String(status || '').toLowerCase());
}

function canConfirmBookingStatus(status) {
  return ['pending', 'quoted'].includes(String(status || '').toLowerCase());
}

function canCancelBookingStatus(status) {
  return ['pending', 'quoted', 'awaiting_payment', 'confirmed'].includes(String(status || '').toLowerCase());
}

function canRejectBookingStatus(status) {
  return ['pending', 'quoted'].includes(String(status || '').toLowerCase());
}

async function hasPaidHotelPayment(db, bookingId) {
  const relation = await db.query(`SELECT to_regclass('public.topup_orders') AS reg`);
  if (!relation.rows[0]?.reg) return false;
  const result = await db.query(
    `SELECT 1 FROM topup_orders
      WHERE NULLIF(to_jsonb(topup_orders)->>'booking_id','')::bigint=$1
        AND to_jsonb(topup_orders)->>'order_type'='hotel_booking'
        AND status='paid'
      LIMIT 1`,
    [bookingId]
  );
  return result.rowCount > 0;
}

async function rejectPaidBookingCancellation(db, bookingId, res) {
  if (!(await hasPaidHotelPayment(db, bookingId))) return false;
  res.status(409).json({
    message: "Оплаченная бронь отменяется только через возврат платежа Payme",
    error: "paid_booking_refund_required",
  });
  return true;
}

function isLiveHotelReservation(reservation = {}, now = new Date()) {
  const status = String(reservation.status || '').toLowerCase();
  if (status === 'confirmed') return true;
  if (status !== 'held' || !reservation.expires_at) return false;
  const expiresAt = new Date(reservation.expires_at);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt > now;
}

async function getBookingAccessRow(id) {
  const result = await pool.query(
    `SELECT id, client_id, provider_id,
            NULLIF(to_jsonb(bookings)->>'requester_provider_id','')::int AS requester_provider_id
       FROM bookings
      WHERE id=$1`,
    [id]
  );
  return result.rows[0] || null;
}
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

async function hotelPaymentStatusSelect(bookingAlias = "b") {
  if (!(await tableExists("topup_orders"))) return "NULL::text AS payment_status";
  return `(
    SELECT o.status
      FROM topup_orders o
     WHERE NULLIF(to_jsonb(o)->>'booking_id','')::bigint = ${bookingAlias}.id
       AND to_jsonb(o)->>'order_type' = 'hotel_booking'
     ORDER BY o.id DESC
     LIMIT 1
  ) AS payment_status`;
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
  let transaction = null;
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role; // 'client' | 'provider'
    if (!userId) return res.status(401).json({ message: "Требуется авторизация" });

    const {
      service_id,
      provider_id: pFromBody,
      dates,
      message,
      // NEW: принимаем attachments/details/legs из TB
      attachments: attachmentsRaw,
      details:     detailsRaw,
      legs,
      currency
    } = req.body || {};
    const isTourBuilder = (req.body?.source === "tour_builder");
    const tourBuilderKind = String(req.body?.tb_kind || req.body?.type || "").toLowerCase();
    let providerId = pFromBody || null;

    if (!providerId && service_id) {
      providerId = await getProviderIdByService(service_id);
    }
    if (!providerId) return res.status(400).json({ message: "Не указан provider_id / service_id" });

    const pType = await getProviderType(providerId);
    // допускаем: гид, транспорт, отель, агент
    const hotelOfferProvider = isTourBuilder && tourBuilderKind === "hotel"
      && ["hotel", "agent", "tour_agent", "agency", "supplier", "tour_operator", "dmc"].includes(String(pType || "").toLowerCase());
    if (!["guide", "transport", "hotel", "agent"].includes(pType) && !hotelOfferProvider) {
      return res.status(400).json({ message: "Бронирование доступно только для гида, транспорта, отеля или агента" });
    }

    const days = toArray(dates).map(toISO).filter(Boolean);
    if (!days.length) return res.status(400).json({ message: "Не указаны корректные даты" });

    const primaryDate = [...days].sort()[0];

   // Для отелей и агентств фильтра по доступности нет — не блокируем создание.
    // Для остальных типов проверяем как раньше.
    if (!["hotel", "agent"].includes(pType) && !hotelOfferProvider) {
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
    // Источник — турбилдер?
    // Если пришёл заказ из турбилдера и group_id не передали — сгенерируем
    const autoGroupId = (cols.group_id && isTourBuilder && !req.body?.group_id) ? randomUUID() : null;

    // базовые колонки
    // NEW: нормализация attachments — пишем ОБЪЕКТ, а не массив
    const bag = {};
    const srcObj =
      (detailsRaw && typeof detailsRaw === "object" ? detailsRaw : null) ??
      (attachmentsRaw && typeof attachmentsRaw === "object" ? attachmentsRaw : null) ??
      null;
    if (srcObj) Object.assign(bag, srcObj);

    // NEW: подхватываем города из разных возможных ключей тела и кладём в attachments.{from_city,to_city}
    const grab = (obj, keys=[]) => {
      for (const k of keys) {
        const v = obj && typeof obj === "object" ? obj[k] : undefined;
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    };
    const fromCity =
      grab(req.body, ["from_city","city_from","origin","from","directionFrom","fromCity"]) ||
      grab(detailsRaw || {}, ["from_city","city_from","origin","from","directionFrom","fromCity"]) ||
      grab(attachmentsRaw || {}, ["from_city","city_from","origin","from","directionFrom","fromCity"]);
    const toCity =
      grab(req.body, ["to_city","city_to","destination","to","directionTo","toCity"]) ||
      grab(detailsRaw || {}, ["to_city","city_to","destination","to","directionTo","toCity"]) ||
      grab(attachmentsRaw || {}, ["to_city","city_to","destination","to","directionTo","toCity"]);
    if (fromCity) bag.from_city = bag.from_city || fromCity;
    if (toCity)   bag.to_city   = bag.to_city   || toCity;

    // NEW: если TB прислал legs[], сохраняем их как есть
    if (Array.isArray(legs) && legs.length) {
      bag.legs = legs
        .filter(x => x && typeof x === "object")
        .map((x) => ({
          from: (x.from || x.from_city || "").trim?.() || undefined,
          to:   (x.to   || x.to_city   || "").trim?.() || undefined,
          date: x.date ? toISO(x.date) : undefined
      }));
    }

    const managedHotelPrice = isTourBuilder && tourBuilderKind === "hotel"
      ? quotedHotelPrice(bag, providerId)
      : null;
    const initialStatus = managedHotelPrice ? "quoted" : "pending";

    const insertCols = ["service_id", "provider_id", "client_id", "date", "status", "client_message", "attachments"];
    const values = [
      // Для турбилдера не привязываем бронь к одной услуге, чтобы не падать по FK
      isTourBuilder ? null : (service_id ?? null),
      providerId,
      userRole === "client" ? userId : null,
      primaryDate,
      initialStatus,
      message ?? null,
      JSON.stringify(bag), // <— объект
    ];

    // опциональная валюта
    if (cols.currency) {
      insertCols.push("currency");
      values.push(managedHotelPrice?.currency || currency || null);
    }
    if (managedHotelPrice) {
      insertCols.push("provider_price", "provider_note");
      values.push(managedHotelPrice.amount, "Цена зафиксирована по опубликованному тарифу Tour Builder");
    }
    // сохраняем источник и группировку, если колонки есть
    if (cols.source) {
      insertCols.push("source");
      values.push(req.body?.source ?? null);
    }
    if (cols.group_id) {
      insertCols.push("group_id");
      values.push(req.body?.group_id ?? autoGroupId);
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

    if (isTourBuilder && tourBuilderKind === "hotel") await ensureHotelOfferTables();

    transaction = await pool.connect();
    await transaction.query('BEGIN');

    const ins = await transaction.query(
      `INSERT INTO bookings (${insertCols.join(",")})
       VALUES (${placeholders})
       RETURNING id, status, provider_id, service_id`,
      values
    );
    const bookingId = ins.rows[0].id;

    // сохраняем все выбранные даты в booking_dates
    for (const d of days) {
      await transaction.query(
        `INSERT INTO booking_dates (booking_id, date) VALUES ($1,$2::date)`,
        [bookingId, d]
      );
    }

    let inventoryReservation = { count: 0, items: [] };
    if (isTourBuilder && tourBuilderKind === "hotel") {
      inventoryReservation = await reserveHotelInventory({
        bookingId,
        providerId,
        details: bag,
        holdMinutes: 30,
        client: transaction,
      });
    }

    await transaction.query('COMMIT');
    transaction.release();
    transaction = null;

    res.status(201).json({
      id: bookingId,
      status: initialStatus,
      dates: days,
      inventory: inventoryReservation,
      ...(managedHotelPrice ? { price: managedHotelPrice.amount, currency: managedHotelPrice.currency } : {}),
    });

    const bkg = {
      id: bookingId,
      provider_id: ins.rows[0].provider_id,
      service_id: ins.rows[0].service_id,
      dates: days,
      client_message: message ?? null,
    };
    const service = service_id
      ? { title: (await pool.query(`SELECT title FROM services WHERE id=$1`, [service_id])).rows[0]?.title || null }
      : { title: null };
    const client = userRole === "client"
      ? (await pool.query(`SELECT name FROM clients WHERE id=$1`, [userId])).rows[0]
      : null;

    tg.notifyNewRequest({ booking: bkg, provider: null, client, service }).catch(e => {
      console.error("tg.notifyNewRequest failed:", e?.response?.data || e?.message || e);
    });
  } catch (err) {
    if (transaction) {
      try { await transaction.query('ROLLBACK'); } catch {}
      transaction.release();
    }
    console.error("createBooking error:", err);
    if (err instanceof HotelInventoryError) {
      return res.status(409).json({ message: "Выбранные номера уже недоступны", error: err.code, details: err.details });
    }
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ВХОДЯЩИЕ брони провайдера (мои услуги)
async function getProviderBookings(req, res) {
  try {
    const providerId = req.user?.id;
    const groupId = req.query?.group_id || req.query?.group || null;
    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "requester_name",
      "requester_phone",
      "requester_telegram",
      "requester_email",
      "rejected_by",
      "cancelled_by",
      "group_id",
      "refund_status",
      "refund_requested_at",
      "refund_reason",
    ]);

    const selectCurrency = cols.currency ? `b.currency` : `'USD'::text AS currency`;
    const selectPaymentStatus = await hotelPaymentStatusSelect("b");
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
        b.source, b.group_id, ${selectPaymentStatus},
        /* NEW: отдаём одинаково и details, и attachments как объект */
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS details,
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS attachments,

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
        ${cols.group_id && groupId ? "AND b.group_id = $2::uuid" : ""}
      GROUP BY b.id, s.id, c.id, p.id, rp.id
      ORDER BY b.created_at DESC NULLS LAST
    `;

    const params = [providerId];
    if (cols.group_id && groupId) params.push(groupId);
    const q = await pool.query(sql, params);
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
    const groupId = req.query?.group_id || req.query?.group || null;
    const cols = await getExistingColumns("bookings", [
      "currency",
      "requester_provider_id",
      "rejected_by",
      "cancelled_by",
      "group_id",
      "refund_status",
      "refund_requested_at",
      "refund_reason",
    ]);

    if (!cols.requester_provider_id) {
      return res.json([]);
    }

    const selectCurrency = cols.currency ? "b.currency" : `'USD'::text AS currency`;
    const selectPaymentStatus = await hotelPaymentStatusSelect("b");
    const selectBy = `
      ${cols.rejected_by ? "b.rejected_by" : "NULL::text AS rejected_by"},
      ${cols.cancelled_by ? "b.cancelled_by" : "NULL::text AS cancelled_by"}
    `;

    const sql = `
      SELECT
        b.id, b.provider_id, b.service_id, b.client_id,
        b.status, ${selectBy}, b.created_at, b.updated_at,
        b.client_message, b.provider_note, b.provider_price,
        /* NEW: alias-ы под фронт */
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS details,
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS attachments,
        b.source, b.group_id, ${selectPaymentStatus},
        ${cols.refund_status ? "b.refund_status" : "NULL::text AS refund_status"},
        ${cols.refund_requested_at ? "b.refund_requested_at" : "NULL::timestamptz AS refund_requested_at"},
        ${cols.refund_reason ? "b.refund_reason" : "NULL::text AS refund_reason"},
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
        ${cols.group_id && groupId ? "AND b.group_id = $2::uuid" : ""}
      ORDER BY b.created_at DESC NULLS LAST
    `;
    const params = [providerId];
    if (cols.group_id && groupId) params.push(groupId);
    const q = await pool.query(sql, params);
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
    const groupId = req.query?.group_id || req.query?.group || null;
    const cols = await getExistingColumns("bookings", ["currency", "rejected_by", "cancelled_by", "group_id", "refund_status", "refund_requested_at", "refund_reason"]);
    const selectCurrency = cols.currency ? "b.currency" : `'USD'::text AS currency`;
    const selectPaymentStatus = await hotelPaymentStatusSelect("b");
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
        /* NEW: alias-ы под фронт */
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS details,
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS attachments,
        b.provider_price, b.provider_note,
        b.created_at, b.updated_at,
        b.source, b.group_id, ${selectPaymentStatus},
        ${cols.refund_status ? "b.refund_status" : "NULL::text AS refund_status"},
        ${cols.refund_requested_at ? "b.refund_requested_at" : "NULL::timestamptz AS refund_requested_at"},
        ${cols.refund_reason ? "b.refund_reason" : "NULL::text AS refund_reason"},
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
        ${cols.group_id && groupId ? "AND b.group_id = $2::uuid" : ""}
      ORDER BY b.created_at DESC NULLS LAST
      `,
      (cols.group_id && groupId ? [clientId, groupId] : [clientId])
    );

    res.json(q.rows);
  } catch (err) {
    console.error("getMyBookings error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/**
 * GET /api/bookings/group/:group_id
 * Возвращает все брони пакета (любой роли), если текущий пользователь имеет отношение к пакету.
 */
const getGroupBookings = async (req, res) => {
  try {
    const groupId = req.params.group_id;
    if (!groupId) return res.status(400).json({ message: "group_id is required" });
    const userId = req.user?.id;
    const role = req.user?.role; // 'client' | 'provider'

    const cols = await getExistingColumns("bookings", ["group_id", "currency", "requester_provider_id"]);
    if (!cols.group_id) return res.json([]);

    // Проверим, что пользователь причастен к пакету
    const whoSql = (() => {
      if (role === "client") return "b.client_id = $2::int";
      // provider/requester
      return cols.requester_provider_id
        ? "(b.provider_id = $2::int OR b.requester_provider_id = $2::int)"
        : "b.provider_id = $2::int";
    })();

    const q = await pool.query(
      `
      SELECT
        b.*,
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS details,
        COALESCE(b.attachments::jsonb, '{}'::jsonb) AS attachments,
        COALESCE(
          (SELECT array_agg(d.date::date ORDER BY d.date)
             FROM booking_dates d WHERE d.booking_id=b.id),
          CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
        ) AS dates,
        s.title AS service_title,
        p.name  AS provider_name, p.type AS provider_type
      FROM bookings b
      LEFT JOIN services  s ON s.id = b.service_id
      LEFT JOIN providers p ON p.id = b.provider_id
      WHERE b.group_id = $1::uuid
        AND ${whoSql}
      ORDER BY b.created_at ASC
      `,
      [groupId, userId]
    );
    return res.json(q.rows);
  } catch (err) {
    console.error("getGroupBookings error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
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

    const current = await pool.query(`SELECT provider_id, status FROM bookings WHERE id=$1`, [bookingId]);
    if (!current.rowCount) return res.status(404).json({ message: "Booking not found" });
    if (Number(current.rows[0].provider_id) !== Number(providerId)) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!canProviderQuoteStatus(current.rows[0].status)) {
      return res.status(409).json({ message: "Нельзя изменить цену для брони в текущем статусе" });
    }

    const cols = await getExistingColumns("bookings", ["currency"]);

    let sql = `
      UPDATE bookings
         SET provider_price = $2,
             provider_note  = $3,
             status         = 'quoted',
             updated_at     = NOW()
       WHERE id = $1 AND provider_id = $4 AND status IN ('pending','quoted')
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
         WHERE id = $1 AND provider_id = $4 AND status IN ('pending','quoted')
         RETURNING id, provider_price, provider_note, currency, status
      `;
      params.push(currency);
    }

    const q = await pool.query(sql, params);

    if (!q.rowCount) return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
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
  const cols = await getExistingColumns("bookings", ["hold_until"]);
  const holdSelect = cols.hold_until ? "hold_until" : "NULL::timestamp AS hold_until";
  const q = await pool.query(
    `SELECT id, provider_id, client_id, status, created_at,
            ${holdSelect}
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
  const cols = await getExistingColumns("bookings", ["hold_until", "cancelled_by"]);
  const dueExpression = cols.hold_until
    ? `COALESCE(hold_until, created_at + INTERVAL '30 minutes')`
    : `created_at + INTERVAL '30 minutes'`;
  let sql = `
    UPDATE bookings
       SET status='cancelled_unpaid',
           updated_at = NOW()`;
  if (cols.cancelled_by) sql += `, cancelled_by='system'`;
  sql += `
     WHERE id=$1
       AND status='awaiting_payment'
       AND ${dueExpression} <= NOW()
     RETURNING *`;
  const upd = await pool.query(sql, [bookingId]);
  if (!upd.rowCount) return getBookingRow(bookingId);
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
          WHERE id=$1 AND provider_id=$2 AND status='pending'
          RETURNING id`
      : `UPDATE bookings
            SET status='awaiting_payment',
                updated_at = NOW()
          WHERE id=$1 AND provider_id=$2 AND status='pending'
          RETURNING id`;
    const accepted = await pool.query(sql, [id, providerId]);
    if (!accepted.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }
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

    const own = await pool.query(`SELECT provider_id, status FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].provider_id !== providerId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!canRejectBookingStatus(own.rows[0].status)) {
      return res.status(409).json({ message: "Отклонение недоступно для текущего статуса" });
    }

    const cols = await getExistingColumns("bookings", ["rejected_by"]);
    let sql = `
      UPDATE bookings
         SET status='rejected',
             provider_note = COALESCE($1, provider_note),
             updated_at = NOW()`;
    const params = [reason ?? null, id, providerId, own.rows[0].status];
    if (cols.rejected_by) sql += `, rejected_by='provider'`;
    sql += ` WHERE id=$2 AND provider_id=$3 AND status=$4 RETURNING id`;
    const rejected = await pool.query(sql, params);
    if (!rejected.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }
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

    const own = await pool.query(`SELECT client_id, status FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].client_id !== clientId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!canCancelBookingStatus(own.rows[0].status)) {
      return res.status(409).json({ message: "Отмена недоступна для текущего статуса" });
    }
    if (await rejectPaidBookingCancellation(pool, id, res)) return;

    const cols = await getExistingColumns("bookings", ["cancelled_by"]);
    let sql = `
      UPDATE bookings
         SET status='cancelled',
             updated_at = NOW()`;
    if (cols.cancelled_by) sql += `, cancelled_by='client'`;
    sql += ` WHERE id=$1 AND client_id=$2 AND status=$3 RETURNING id`;
    const cancelled = await pool.query(sql, [id, clientId, own.rows[0].status]);
    if (!cancelled.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }
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

    if (!canCancelBookingStatus(own.rows[0].status)) {
      return res.status(409).json({ message: "Отмена недоступна для текущего статуса" });
    }
    if (await rejectPaidBookingCancellation(pool, id, res)) return;

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
    sql += ` WHERE id=$1 AND provider_id=$3 AND status=$4 RETURNING id`;
    const cancelled = await pool.query(sql, [id, reason ?? null, providerId, own.rows[0].status]);
    if (!cancelled.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }

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
    if (!canConfirmBookingStatus(b.status)) {
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
        WHERE id=$1 AND client_id=$2 AND status IN ('pending','quoted')
      RETURNING *`,
      [id, clientId]
    );
    if (!up.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }
    const booking = up.rows[0];

    // TG
    try {
      (tg.notifyConfirmed || tg.notifyBookingPaidConfirmed)?.({ booking, by: "client" });
    } catch {}

    return res.json(booking);
  } catch (err) {
    console.error("confirmBooking error:", err);
    if (isHotelInventoryHoldExpired(err)) {
      return res.status(409).json({
        message: "Срок удержания номера истёк. Пересчитайте тур и выберите доступный номер заново.",
        error: "hotel_inventory_hold_expired",
      });
    }
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
    if (!canConfirmBookingStatus(b.status)) {
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
        WHERE id=$1 AND requester_provider_id=$2 AND status IN ('pending','quoted')
      RETURNING *`,
      [id, requesterId]
    );
    if (!up.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }
    const booking = up.rows[0];
    try { (tg.notifyConfirmed || tg.notifyBookingPaidConfirmed)?.({ booking, by: "requester" }); } catch {}
    return res.json(booking);
  } catch (err) {
    console.error("confirmBookingByRequester error:", err);
    if (isHotelInventoryHoldExpired(err)) {
      return res.status(409).json({
        message: "Срок удержания номера истёк. Пересчитайте тур и выберите доступный номер заново.",
        error: "hotel_inventory_hold_expired",
      });
    }
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

    const own = await pool.query(`SELECT requester_provider_id, status FROM bookings WHERE id=$1`, [id]);
    if (!own.rowCount) return res.status(404).json({ message: "Заявка не найдена" });
    if (own.rows[0].requester_provider_id !== requesterId) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!canCancelBookingStatus(own.rows[0].status)) {
      return res.status(409).json({ message: "Отмена недоступна для текущего статуса" });
    }
    if (await rejectPaidBookingCancellation(pool, id, res)) return;

    let sql = `UPDATE bookings SET status='cancelled', updated_at=NOW()`;
    if (support.cancelled_by) sql += `, cancelled_by='requester'`;
    sql += ` WHERE id=$1 AND requester_provider_id=$2 AND status=$3 RETURNING id`;
    const cancelled = await pool.query(sql, [id, requesterId, own.rows[0].status]);
    if (!cancelled.rowCount) {
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }

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

    // Для управляемых гостиничных тарифов проверяем фактические строки резерва.
    // Старые брони без hotel_inventory_reservations сохраняют прежнее поведение.
    if (pType === "hotel" || pType === "agent") {
      await ensureHotelOfferTables();
      const reservationResult = await pool.query(
        `SELECT stay_date::text AS date,status,expires_at
           FROM hotel_inventory_reservations
          WHERE booking_id=$1
          ORDER BY stay_date,rate_id`,
        [id]
      );
      if (reservationResult.rowCount) {
        const byDate = new Map();
        const now = new Date();
        for (const reservation of reservationResult.rows) {
          const date = toISO(reservation.date);
          if (!date) continue;
          const live = isLiveHotelReservation(reservation, now);
          byDate.set(date, (byDate.get(date) ?? true) && live);
        }
        const results = [...byDate.entries()].map(([date, live]) => ({
          date,
          status: live ? "ok" : "conflict",
        }));
        const allOk = results.length > 0 && results.every((item) => item.status === "ok");
        return res.json({ ok: true, overall: allOk ? "ok" : "conflict", results });
      }
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
  let transaction = null;
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
    const booking = bQ.rows[0];
    if (Number(booking.provider_id) !== Number(req.user?.id)) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    if (!canPlaceBookingHold(req.user, booking)) {
      return res.status(409).json({ message: "Удержание недоступно для текущего статуса брони" });
    }

    // соберём даты
    const dQ = await pool.query(`SELECT date AS d FROM booking_dates WHERE booking_id=$1 ORDER BY date`, [id]);
    const days = dQ.rows.map(r => toISO(r.d)).filter(Boolean);

    // проверим конфликт только для не-отелей
    const providerId = bQ.rows[0].provider_id;
    const pType = await getProviderType(providerId);
    if (["hotel", "agent"].includes(pType)) await ensureHotelOfferTables();
    if (!["hotel", "agent"].includes(pType)) {
      const free = await isDatesFree(providerId, days, id);
      if (!free) return res.status(409).json({ message: "Даты уже заняты" });
    }

    const cols = await getExistingColumns("bookings", ["hold_until"]);
    const untilSql = cols.hold_until
      ? `, hold_until = NOW() + $2::interval`
      : ``;

    const hasSupplierOrders = await tableExists("supplier_orders");
    transaction = await pool.connect();
    await transaction.query('BEGIN');
    const updated = await transaction.query(
      `UPDATE bookings
          SET updated_at = NOW()${untilSql}
        WHERE id=$1 AND provider_id=$${cols.hold_until ? 3 : 2} AND status=$${cols.hold_until ? 4 : 3}
      RETURNING id`,
      cols.hold_until
        ? [id, `${hours} hours`, providerId, booking.status]
        : [id, providerId, booking.status]
    );
    if (!updated.rowCount) {
      await transaction.query('ROLLBACK');
      transaction.release();
      transaction = null;
      return res.status(409).json({ message: "Статус брони изменился. Обновите список и повторите действие." });
    }

    // supplier_orders если таблица существует
    if (hasSupplierOrders) {
      const orderValues = [id, providerId, `${hours} hours`, JSON.stringify(payload)];
      const existingOrder = await transaction.query(
        `UPDATE supplier_orders
            SET hold_until=NOW()+$3::interval,payload=$4::jsonb,status='held'
          WHERE booking_id=$1 AND supplier_id=$2 AND status='held'
        RETURNING id`,
        orderValues
      );
      if (!existingOrder.rowCount) {
        await transaction.query(
          `INSERT INTO supplier_orders (booking_id, supplier_id, status, hold_until, payload)
           VALUES ($1,$2,'held',NOW()+$3::interval,$4::jsonb)`,
          orderValues
        );
      }
    }
    await transaction.query('COMMIT');
    transaction.release();
    transaction = null;

    // TG — уведомление про hold
    try {
      const booking = { id, provider_id: providerId, dates: days };
      tg.notifyHoldPlaced({ booking, hours }).catch(() => {});
    } catch {}

    return res.json({ ok: true, hold_until_in: `${hours}h` });
  } catch (err) {
    if (transaction) {
      try { await transaction.query('ROLLBACK'); } catch {}
      transaction.release();
    }
    console.error("placeHold error:", err);
    if (isHotelInventoryHoldExpired(err)) {
      return res.status(409).json({
        message: "Срок удержания номера истёк. Пересчитайте тур и выберите доступный номер заново.",
        error: "hotel_inventory_hold_expired",
      });
    }
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

    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: "Бронь не найдена" });
    if (!canAccessBooking(req.user, access)) return res.status(403).json({ message: "Недостаточно прав" });

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

async function loadBookingDocumentData(id) {
  const result = await pool.query(
    `SELECT b.id,b.status,b.provider_price,b.currency,b.created_at,b.client_message,b.provider_note,b.attachments,
            b.client_id,b.provider_id,
            NULLIF(to_jsonb(b)->>'requester_provider_id','')::bigint AS requester_provider_id,
            COALESCE(c.name,b.requester_name,'Customer') AS customer_name,
            COALESCE(c.phone,b.requester_phone,'') AS customer_phone,
            COALESCE(p.name,'Provider') AS provider_name,
            COALESCE(p.phone,'') AS provider_phone,
            COALESCE(p.address,p.location,'') AS provider_address,
            COALESCE((SELECT array_agg(d.date::date ORDER BY d.date) FROM booking_dates d WHERE d.booking_id=b.id),ARRAY[]::date[]) AS dates
       FROM bookings b
       LEFT JOIN clients c ON c.id=b.client_id
       LEFT JOIN providers p ON p.id=b.provider_id
      WHERE b.id=$1`,
    [id]
  );
  return result.rows[0] || null;
}

function streamBookingPdf(res, booking, kind) {
  const isVoucher = kind === 'voucher';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="booking-${booking.id}-${kind}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${isVoucher ? 'Hotel voucher' : 'Invoice'} #${booking.id}` } });
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#111827').text(isVoucher ? 'HOTEL VOUCHER' : 'BOOKING INVOICE');
  doc.moveDown(0.3).font('Helvetica').fontSize(11).fillColor('#6b7280').text(`Travella booking #${booking.id}`);
  doc.moveDown(1.2).fillColor('#111827');
  const line = (label, value) => {
    doc.font('Helvetica-Bold').text(`${label}:`, { continued: true }).font('Helvetica').text(` ${value || '-'}`);
    doc.moveDown(0.35);
  };
  line('Status', booking.status);
  line('Hotel / supplier', booking.provider_name);
  line('Hotel contact', booking.provider_phone);
  line('Hotel address', booking.provider_address);
  line('Guest / customer', booking.customer_name);
  line('Customer contact', booking.customer_phone);
  line('Stay dates', (booking.dates || []).map((d) => String(d).slice(0, 10)).join(', '));
  line('Amount', `${Number(booking.provider_price || 0).toLocaleString('en-US')} ${booking.currency || 'UZS'}`);
  line('Payment', isVoucher ? 'Paid via Payme' : (booking.status === 'confirmed' ? 'Paid' : 'Pending'));
  if (booking.provider_note) line('Supplier note', booking.provider_note);
  if (booking.client_message) line('Customer note', booking.client_message);
  doc.moveDown(1.5).strokeColor('#e5e7eb').moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8).fontSize(9).fillColor('#6b7280').text('Generated by Travella. Verify booking status in your account before service delivery.');
  doc.end();
}

const downloadBookingDocument = (kind) => async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid booking id' });
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: 'Бронь не найдена' });
    if (!canAccessBooking(req.user, access)) return res.status(403).json({ message: 'Недостаточно прав' });
    if (kind === 'voucher' && !(await hasPaidHotelPayment(pool, id))) {
      return res.status(409).json({ message: 'Ваучер доступен после оплаты' });
    }
    const booking = await loadBookingDocumentData(id);
    if (!booking) return res.status(404).json({ message: 'Бронь не найдена' });
    streamBookingPdf(res, booking, kind);
  } catch (err) {
    console.error(`downloadBookingDocument ${kind} error:`, err);
    if (!res.headersSent) return res.status(500).json({ message: 'Не удалось сформировать документ' });
    res.end();
  }
};

const downloadBookingInvoice = downloadBookingDocument('invoice');
const downloadBookingVoucher = downloadBookingDocument('voucher');

const downloadBookingRoomingList = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid booking id' });
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: 'Бронь не найдена' });
    if (!canAccessBooking(req.user, access)) return res.status(403).json({ message: 'Недостаточно прав' });
    if (!(await hasPaidHotelPayment(pool, id))) return res.status(409).json({ message: 'Rooming list доступен после оплаты' });
    const booking = await loadBookingDocumentData(id);
    const details = booking?.attachments && typeof booking.attachments === 'object' ? booking.attachments : {};
    const quotes = Array.isArray(details.hotel_quotes) ? details.hotel_quotes : [];
    const lines = quotes.flatMap((quote) => Array.isArray(quote?.lines) ? quote.lines : []);
    if (!booking || !lines.length) return res.status(409).json({ message: 'В брони нет данных о выбранных номерах' });

    const roomMap = new Map();
    for (const line of lines) {
      const key = `${line.room_type || 'Room'}|${line.meal_plan || ''}`;
      const current = roomMap.get(key) || { room_type: line.room_type || 'Room', meal_plan: line.meal_plan || '', quantity: 0 };
      current.quantity = Math.max(current.quantity, Number(line.quantity || 0));
      roomMap.set(key, current);
    }
    const nights = (booking.dates || []).map((d) => String(d).slice(0, 10)).sort();
    const checkIn = nights[0] || '';
    const lastNight = nights[nights.length - 1];
    const checkOutDate = lastNight ? new Date(`${lastNight}T00:00:00Z`) : null;
    if (checkOutDate) checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
    const checkOut = checkOutDate ? checkOutDate.toISOString().slice(0, 10) : '';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Travella';
    const sheet = workbook.addWorksheet('Rooming list', { views: [{ state: 'frozen', ySplit: 6 }] });
    sheet.mergeCells('A1:H1');
    sheet.getCell('A1').value = `ROOMING LIST - BOOKING #${booking.id}`;
    sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    sheet.getCell('A2').value = 'Hotel'; sheet.getCell('B2').value = booking.provider_name;
    sheet.getCell('D2').value = 'Check-in'; sheet.getCell('E2').value = checkIn;
    sheet.getCell('F2').value = 'Check-out'; sheet.getCell('G2').value = checkOut;
    sheet.getCell('A3').value = 'Lead guest'; sheet.getCell('B3').value = booking.customer_name;
    sheet.getCell('D3').value = 'Status'; sheet.getCell('E3').value = 'PAID';
    sheet.getCell('F3').value = 'Currency'; sheet.getCell('G3').value = booking.currency || 'UZS';
    ['A2','D2','F2','A3','D3','F3'].forEach((cell) => { sheet.getCell(cell).font = { bold: true, color: { argb: 'FF475569' } }; });
    const headerRow = sheet.getRow(6);
    headerRow.values = ['No.', 'Guest name', 'Room type', 'Room No.', 'Meal', 'Check-in', 'Check-out', 'Notes'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    let rowNo = 1;
    for (const room of roomMap.values()) {
      for (let index = 0; index < Math.max(1, room.quantity); index += 1) {
        sheet.addRow([rowNo, rowNo === 1 ? booking.customer_name : '', room.room_type, '', room.meal_plan, checkIn, checkOut, '']);
        rowNo += 1;
      }
    }
    sheet.columns = [
      { width: 7 }, { width: 28 }, { width: 20 }, { width: 13 },
      { width: 12 }, { width: 14 }, { width: 14 }, { width: 28 },
    ];
    sheet.eachRow((row, number) => {
      row.alignment = { vertical: 'middle', wrapText: true };
      if (number >= 6) row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }; });
    });
    sheet.autoFilter = 'A6:H6';
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="booking-${id}-rooming-list.xlsx"`);
    return res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('downloadBookingRoomingList error:', err);
    if (!res.headersSent) return res.status(500).json({ message: 'Не удалось сформировать Rooming list' });
    res.end();
  }
};

const downloadBookingItinerary = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid booking id' });
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: 'Бронь не найдена' });
    if (!canAccessBooking(req.user, access)) return res.status(403).json({ message: 'Недостаточно прав' });
    const anchorQ = await pool.query(`SELECT id,group_id,attachments FROM bookings WHERE id=$1`, [id]);
    const anchor = anchorQ.rows[0];
    const itemsQ = anchor.group_id
      ? await pool.query(
          `SELECT b.id,b.status,b.attachments,b.provider_price,b.currency,p.name AS provider_name,p.type AS provider_type,
                  COALESCE((SELECT array_agg(d.date::date ORDER BY d.date) FROM booking_dates d WHERE d.booking_id=b.id),ARRAY[]::date[]) AS dates
             FROM bookings b LEFT JOIN providers p ON p.id=b.provider_id
            WHERE b.group_id=$1 ORDER BY b.created_at,b.id`,
          [anchor.group_id]
        )
      : await pool.query(
          `SELECT b.id,b.status,b.attachments,b.provider_price,b.currency,p.name AS provider_name,p.type AS provider_type,
                  COALESCE((SELECT array_agg(d.date::date ORDER BY d.date) FROM booking_dates d WHERE d.booking_id=b.id),ARRAY[]::date[]) AS dates
             FROM bookings b LEFT JOIN providers p ON p.id=b.provider_id WHERE b.id=$1`,
          [id]
        );
    const items = itemsQ.rows;
    const details = items.map((item) => item.attachments || {}).find((value) => Array.isArray(value?.tour_program)) || anchor.attachments || {};
    const program = Array.isArray(details.tour_program) ? details.tour_program : [];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="tour-itinerary-${anchor.group_id || id}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: `Tour itinerary ${anchor.group_id || id}` } });
    doc.pipe(res);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#111827').text('TOUR ITINERARY');
    doc.moveDown(0.25).font('Helvetica').fontSize(10).fillColor('#64748b').text(`Package: ${anchor.group_id || `booking #${id}`}`);
    doc.moveDown(1).fillColor('#111827');
    if (program.length) {
      doc.font('Helvetica-Bold').fontSize(14).text('Program by day');
      doc.moveDown(0.5);
      for (const day of program) {
        if (doc.y > 730) doc.addPage();
        const title = [`Day ${day.day || ''}`, day.date, day.city].filter(Boolean).join(' - ');
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#f05a0a').text(title || 'Day');
        const body = day.program_text || day.text || day.description || '';
        if (body) doc.font('Helvetica').fontSize(10).fillColor('#334155').text(String(body), { width: 500 });
        doc.moveDown(0.7);
      }
    }
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(14).fillColor('#111827').text('Confirmed services');
    doc.moveDown(0.5);
    for (const item of items) {
      if (doc.y > 735) doc.addPage();
      const dates = (item.dates || []).map((date) => String(date).slice(0, 10)).join(', ');
      doc.font('Helvetica-Bold').fontSize(10).text(`#${item.id} ${item.provider_type || 'service'} - ${item.provider_name || 'Provider'}`);
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`${dates || 'Dates not specified'} | ${item.status} | ${Number(item.provider_price || 0).toLocaleString('en-US')} ${item.currency || 'UZS'}`);
      doc.moveDown(0.55).fillColor('#111827');
    }
    doc.moveDown(1).strokeColor('#e2e8f0').moveTo(44, doc.y).lineTo(551, doc.y).stroke();
    doc.moveDown(0.6).font('Helvetica').fontSize(8).fillColor('#64748b').text('Generated by Travella from the current Tour Builder booking package.');
    doc.end();
  } catch (err) {
    console.error('downloadBookingItinerary error:', err);
    if (!res.headersSent) return res.status(500).json({ message: 'Не удалось сформировать itinerary' });
    res.end();
  }
};
/** GET /api/bookings/:id — мета + авто-истечение */
const getBooking = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: "Бронь не найдена" });
    if (!canAccessBooking(req.user, access)) return res.status(403).json({ message: "Недостаточно прав" });
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
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: "Бронь не найдена" });
    if (!canMarkBookingPaid(req.user)) {
      return res.status(403).json({ message: "Оплата подтверждается только платёжной системой или администратором" });
    }
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
    if (isHotelInventoryHoldExpired(err)) {
      return res.status(409).json({
        message: "Срок удержания номера истёк. Оплата не может подтвердить недоступный номер.",
        error: "hotel_inventory_hold_expired",
      });
    }
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

/** POST /api/bookings/:id/payment-order — создаёт оплату Payme для действующего hotel hold. */
const createPaymentOrder = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid booking id" });
  const db = await pool.connect();
  try {
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: "Бронь не найдена" });
    if (!canActAsBookingPayer(req.user, access)) {
      return res.status(403).json({ message: "Оплатить бронь может только её заявитель" });
    }
    await db.query("BEGIN");
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`hotel-payment:${id}`]);
    const bookingResult = await db.query(
      `SELECT id,status,provider_price,currency,hold_until,client_id,
              NULLIF(to_jsonb(bookings)->>'requester_provider_id','')::bigint AS requester_provider_id
         FROM bookings WHERE id=$1 FOR UPDATE`,
      [id]
    );
    const booking = bookingResult.rows[0];
    if (!booking || booking.status !== "awaiting_payment") {
      await db.query("ROLLBACK");
      return res.status(409).json({ message: "Бронь не ожидает оплаты" });
    }
    if (booking.hold_until && new Date(booking.hold_until).getTime() <= Date.now()) {
      await db.query("ROLLBACK");
      await autoExpireIfOverdue(id);
      return res.status(409).json({ message: "Время оплаты истекло" });
    }
    const currency = String(booking.currency || "UZS").toUpperCase();
    if (currency !== "UZS") {
      await db.query("ROLLBACK");
      return res.status(409).json({ message: "Онлайн-оплата гостиничной брони доступна только в UZS" });
    }
    const amountTiyin = Math.round(Number(booking.provider_price || 0) * 100);
    if (!Number.isSafeInteger(amountTiyin) || amountTiyin <= 0) {
      await db.query("ROLLBACK");
      return res.status(409).json({ message: "Для брони не зафиксирована корректная цена" });
    }
    await db.query(`
      ALTER TABLE topup_orders
        ALTER COLUMN client_id DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS booking_id BIGINT,
        ADD COLUMN IF NOT EXISTS actor_role TEXT,
        ADD COLUMN IF NOT EXISTS actor_id BIGINT,
        ADD COLUMN IF NOT EXISTS pay_url TEXT,
        ADD COLUMN IF NOT EXISTS redirect_url TEXT,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS meta JSONB
    `);
    const existing = await db.query(
      `SELECT * FROM topup_orders
        WHERE booking_id=$1 AND order_type='hotel_booking'
          AND status IN ('created','pending') AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (existing.rows[0]?.pay_url) {
      await db.query("COMMIT");
      return res.json({ ok: true, reused: true, order_id: existing.rows[0].id, pay_url: existing.rows[0].pay_url, amount_sum: amountTiyin / 100 });
    }
    const role = String(req.user?.role || "").toLowerCase();
    const actorId = Number(req.user?.id);
    const returnPath = role === "client"
      ? `/client/dashboard?tab=bookings&payment_booking=${id}`
      : `/dashboard/bookings?payment_booking=${id}`;
    const redirectUrl = `${String(process.env.SITE_URL || "https://travella.uz").replace(/\/+$/, "")}${returnPath}`;
    const inserted = await db.query(
      `INSERT INTO topup_orders
        (client_id,amount,amount_tiyin,provider,status,purpose,order_type,booking_id,actor_role,actor_id,redirect_url,expires_at,meta)
       VALUES ($1,$2,$2,'payme','created','hotel_booking','hotel_booking',$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [booking.client_id || null, amountTiyin, id, role, actorId, redirectUrl, booking.hold_until, { booking_id: id }]
    );
    const order = inserted.rows[0];
    const payUrl = buildPaymeCheckoutUrl({ orderId: order.id, amountTiyin, redirectUrl });
    await db.query(`UPDATE topup_orders SET pay_url=$2 WHERE id=$1`, [order.id, payUrl]);
    await db.query("COMMIT");
    return res.json({ ok: true, order_id: order.id, pay_url: payUrl, amount_sum: amountTiyin / 100, expires_at: booking.hold_until });
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch {}
    console.error("createPaymentOrder error:", err);
    return res.status(500).json({ message: err.message === "PAYME_MERCHANT_ID_MISSING" ? "Payme не настроен" : "Ошибка создания оплаты" });
  } finally {
    db.release();
  }
};

/** POST /api/bookings/:id/refund-request — заявка, не сам банковский возврат. */
const requestBookingRefund = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid booking id" });
  const reason = String(req.body?.reason || "").trim().slice(0, 1000);
  if (reason.length < 5) return res.status(400).json({ message: "Укажите причину возврата" });
  try {
    const access = await getBookingAccessRow(id);
    if (!access) return res.status(404).json({ message: "Бронь не найдена" });
    if (!canActAsBookingPayer(req.user, access)) {
      return res.status(403).json({ message: "Запросить возврат может только плательщик" });
    }
    if (!(await hasPaidHotelPayment(pool, id))) {
      return res.status(409).json({ message: "По брони нет подтверждённой оплаты Payme" });
    }
    await pool.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS refund_status TEXT,
        ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS refund_requested_by_role TEXT,
        ADD COLUMN IF NOT EXISTS refund_requested_by_id BIGINT,
        ADD COLUMN IF NOT EXISTS refund_reason TEXT
    `);
    const updated = await pool.query(
      `UPDATE bookings
          SET refund_status=CASE WHEN refund_status IN ('refunded','approved','processing') THEN refund_status ELSE 'requested' END,
              refund_requested_at=COALESCE(refund_requested_at,NOW()),
              refund_requested_by_role=COALESCE(refund_requested_by_role,$2),
              refund_requested_by_id=COALESCE(refund_requested_by_id,$3),
              refund_reason=CASE WHEN refund_status IN ('refunded','approved','processing') THEN refund_reason ELSE $4 END,
              updated_at=NOW()
        WHERE id=$1
        RETURNING id,refund_status,refund_requested_at,refund_reason,provider_id,provider_price,currency`,
      [id, String(req.user?.role || "unknown"), Number(req.user?.id) || null, reason]
    );
    const row = updated.rows[0];
    if (row.refund_status === "requested") {
      const safeReason = reason.replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
      tg.tgSendToAdmins(
        `↩️ <b>Запрос возврата по брони #${id}</b>\n` +
        `Плательщик: ${String(req.user?.role || "unknown")} #${Number(req.user?.id) || "—"}\n` +
        `Сумма: ${row.provider_price || "—"} ${row.currency || "UZS"}\n` +
        `Причина: ${safeReason}\n\n` +
        `Возврат завершать только после подтверждения Payme.`,
        { reply_markup: { inline_keyboard: [[{ text: "Открыть платежи", url: `${String(process.env.SITE_URL || "https://travella.uz").replace(/\/+$/, "")}/admin/finance?tab=payments&q=${id}` }]] } }
      ).catch(() => {});
    }
    return res.json({ ok: true, refund_status: row.refund_status, requested_at: row.refund_requested_at });
  } catch (err) {
    console.error("requestBookingRefund error:", err);
    return res.status(500).json({ message: "Не удалось отправить запрос возврата" });
  }
};

module.exports = {
  createBooking,
  getProviderBookings,
  getProviderOutgoingBookings,
  getMyBookings,
  getGroupBookings,
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
  createPaymentOrder,
  requestBookingRefund,
  downloadBookingInvoice,
  downloadBookingVoucher,
  downloadBookingRoomingList,
  downloadBookingItinerary,
  canAccessBooking,
  canActAsBookingPayer,
  canPlaceBookingHold,
  canMarkBookingPaid,
  canProviderQuoteStatus,
  canConfirmBookingStatus,
  canCancelBookingStatus,
  canRejectBookingStatus,
  hasPaidHotelPayment,
  isLiveHotelReservation,
};
