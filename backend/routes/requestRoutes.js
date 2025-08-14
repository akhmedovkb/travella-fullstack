// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

/* =========================
   small helpers
   ========================= */
function safeJSON(x) {
  if (!x) return {};
  if (typeof x === "object") return x;
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
function pickFirst(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
function parseTs(v) {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

/** Возвращает UNIX ms истечения услуги.
 *  Порядок полей:
 *  1) details.expiration / expires_at / expiration_at
 *  2) авиабилеты: returnDate | returnFlightDate | end_flight_date
 *     (или startDate | departureFlightDate | start_flight_date для one-way)
 *  3) отель/тур/событие: endDate | hotel_check_out | startDate | checkIn
 *  4) fallback TTL (30д от created_at)
 */
function serviceExpireAtMs(serviceDetails, createdAtMs, ttlDays = 30) {
  const d = safeJSON(serviceDetails);

  const direct =
    parseTs(pickFirst(d.expiration, d.expiration_at, d.expires_at, d.expiresAt)) ||
    parseTs(pickFirst(d.returnDate, d.returnFlightDate, d.end_flight_date)) ||
    parseTs(pickFirst(d.endDate, d.hotel_check_out)) ||
    parseTs(pickFirst(d.startDate, d.checkIn, d.departureFlightDate, d.start_flight_date));

  if (direct) return direct;

  const ttlMs = (ttlDays || 30) * 24 * 60 * 60 * 1000;
  return (createdAtMs || Date.now()) + ttlMs;
}

/** Удаляет все заявки данного провайдера, у которых истёк срок актуальности */
async function purgeExpiredRequestsForProvider(providerId, nowMs = Date.now()) {
  // тянем кандидатов на удаление (берём details услуги и created_at заявки)
  const q = await db.query(
    `SELECT r.id, r.created_at, s.details
       FROM requests r
       JOIN services s ON s.id = r.service_id
      WHERE s.provider_id = $1`,
    [providerId]
  );

  const toDelete = [];
  for (const row of q.rows) {
    const createdAtMs = row.created_at ? Date.parse(row.created_at) : nowMs;
    const exp = serviceExpireAtMs(row.details, createdAtMs);
    if (exp && exp < nowMs) toDelete.push(row.id);
  }

  if (toDelete.length) {
    await db.query(`DELETE FROM requests WHERE id = ANY($1::int[])`, [toDelete]);
  }
  return toDelete.length;
}

/* =========================
   create quick request (client)
   ========================= */
// POST /api/requests (или /quick) — быстрый запрос
router.post(["/", "/quick"], authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ error: "forbidden" });
    }

    const clientId = req.user.id;
    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    // убеждаемся, что услуга существует и узнаём её провайдера
    const svcQ = await db.query(
      `SELECT id, provider_id, title, name
         FROM services
        WHERE id = $1
        LIMIT 1`,
      [service_id]
    );
    if (svcQ.rows.length === 0) {
      return res.status(404).json({ error: "service_not_found" });
    }
    // создаём запрос
    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note, created_at)
       VALUES ($1, $2, 'new', $3, NOW())
       RETURNING id`,
      [service_id, clientId, note || null]
    );

    return res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
});

/* =========================
   provider inbox
   ========================= */
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id || req.user?.role !== "provider") {
      // допускаем и owner/agency, если у вас такие роли — при необходимости расширьте
      // но минимум проверяем наличие id
      if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    }

    const providerId = req.user.id;

    // 1) авто-очистка просроченных
    await purgeExpiredRequestsForProvider(providerId);

    // 2) отдаём актуальные инбокс-заявки
    const q = await db.query(
      `SELECT
          r.id,
          r.created_at,
          r.status,
          r.note,
          s.id    AS service_id,
          COALESCE(s.title, s.name, '—') AS service_title,
          c.id    AS client_id,
          COALESCE(c.name,  '—') AS client_name,
          c.phone AS client_phone,
          c.telegram AS client_telegram
        FROM requests r
        JOIN services s ON s.id = r.service_id
        JOIN clients  c ON c.id = r.client_id
       WHERE s.provider_id = $1
       ORDER BY r.created_at DESC`,
      [providerId]
    );

    const items = q.rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status || "new",
      note: row.note || null,
      service: {
        id: row.service_id,
        title: row.service_title || "—",
      },
      client: {
        id: row.client_id,
        name: row.client_name || "—",
        phone: row.client_phone || null,
        telegram: row.client_telegram || null,
      },
    }));

    res.json({ items });
  } catch (e) {
    console.error("provider inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

router.get("/provider/inbox", authenticateToken, providerInboxHandler);
// алиас под текущий фронт
router.get("/provider", authenticateToken, providerInboxHandler);

/* =========================
   mark as processed (прочитано)
   ========================= */
// POST /api/requests/:id/process  — пометить как обработано (без удаления)
router.post("/:id/process", authenticateToken, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerId = req.user.id;
    const id = Number(req.params.id);

    const upd = await db.query(
      `UPDATE requests r
          SET status = 'processed'
        FROM services s
       WHERE r.id = $1
         AND s.id = r.service_id
         AND s.provider_id = $2
       RETURNING r.id`,
      [id, providerId]
    );

    if (upd.rowCount === 0) return res.status(404).json({ error: "not_found_or_not_owned" });
    res.json({ ok: true });
  } catch (e) {
    console.error("mark processed error:", e);
    res.status(500).json({ error: "process_failed" });
  }
});

/* =========================
   optional: ручное удаление провайдером
   ========================= */
// DELETE /api/requests/:id  — полностью удалить (если понадобится)
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerId = req.user.id;
    const id = Number(req.params.id);

    const del = await db.query(
      `DELETE FROM requests r
        USING services s
       WHERE r.id = $1
         AND s.id = r.service_id
         AND s.provider_id = $2`,
      [id, providerId]
    );

    if (del.rowCount === 0) return res.status(404).json({ error: "not_found_or_not_owned" });
    res.json({ ok: true });
  } catch (e) {
    console.error("delete request error:", e);
    res.status(500).json({ error: "delete_failed" });
  }
});

module.exports = router;
