const crypto = require("crypto");
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const PACKAGE_STATUSES = new Set([
  "draft", "request_sent", "partially_confirmed", "confirmed",
  "proposed", "booked", "paid", "cancelled",
]);
const PACKAGE_PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid"]);

function cleanMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function calculateGross(netTotal, markupType, markupValue) {
  const net = cleanMoney(netTotal);
  const value = cleanMoney(markupValue);
  return cleanMoney(markupType === "fixed" ? net + value : net * (1 + value / 100));
}

function canEditTourPackage(status) {
  return !["booked", "paid", "cancelled"].includes(String(status || "").toLowerCase());
}

function normalizePackagePayment(body = {}, grossTotal = 0) {
  const gross = cleanMoney(grossTotal);
  const paidAmount = Math.min(cleanMoney(body.paid_amount), gross);
  let paymentStatus = PACKAGE_PAYMENT_STATUSES.has(body.payment_status) ? body.payment_status : "unpaid";
  if (paidAmount <= 0) paymentStatus = "unpaid";
  else if (paidAmount >= gross && gross > 0) paymentStatus = "paid";
  else paymentStatus = "partial";
  return {
    paymentStatus,
    paidAmount,
    paymentDueAt: body.payment_due_at || null,
    paymentNote: String(body.payment_note || "").trim().slice(0, 1000) || null,
  };
}

function normalizeTraveler(body = {}, index = 0) {
  const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())
    ? String(value).trim()
    : null;
  return {
    fullName: String(body.full_name || "").trim().slice(0, 180),
    travelerType: body.traveler_type === "child" ? "child" : "adult",
    birthDate: isoDate(body.birth_date),
    citizenship: String(body.citizenship || "").trim().slice(0, 80) || null,
    passportNumber: String(body.passport_number || "").trim().toUpperCase().slice(0, 40) || null,
    passportExpiry: isoDate(body.passport_expiry),
    roomType: String(body.room_type || "").trim().slice(0, 80) || null,
    notes: String(body.notes || "").trim().slice(0, 500) || null,
    sortOrder: index,
  };
}

function normalizeComponentOperations(body = {}) {
  const dueAt = String(body.supplier_payment_due_at || "").trim();
  return {
    confirmationReference: String(body.confirmation_reference || "").trim().slice(0, 120) || null,
    supplierPaymentDueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? dueAt : null,
    supplierPaid: body.supplier_paid === true,
    operationalNote: String(body.operational_note || "").trim().slice(0, 1000) || null,
  };
}

function normalizeTourTask(body = {}) {
  const dueAt = String(body.due_at || "").trim().slice(0, 10);
  const priority = ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal";
  return {
    title: String(body.title || "").trim().slice(0, 240),
    assignedTo: String(body.assigned_to || "").trim().slice(0, 120) || null,
    dueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? dueAt : null,
    priority,
    completed: body.completed === true,
  };
}

function derivePackageStatus(rows = [], storedStatus = "draft") {
  if (["proposed", "booked", "paid", "cancelled"].includes(storedStatus)) return storedStatus;
  if (!rows.length) return storedStatus || "draft";
  const statuses = rows.map((row) => String(row.status || "pending").toLowerCase());
  if (statuses.every((status) => ["confirmed", "paid", "completed"].includes(status))) return "confirmed";
  if (statuses.some((status) => ["confirmed", "paid", "completed", "quoted", "awaiting_payment"].includes(status))) {
    return "partially_confirmed";
  }
  return "request_sent";
}

function packageSaleReadiness(rows = [], proposalResponse = null) {
  const accepted = proposalResponse === "accepted";
  const confirmedStatuses = new Set(["confirmed", "paid", "completed"]);
  const blockers = rows.filter((row) => !confirmedStatuses.has(String(row.status || "").toLowerCase()));
  return {
    ready: accepted && rows.length > 0 && blockers.length === 0,
    client_accepted: accepted,
    component_count: rows.length,
    confirmed_count: rows.length - blockers.length,
    blocker_ids: blockers.map((row) => row.id),
  };
}

function packageOperationsReadiness(input = {}) {
  const componentCount = Number(input.componentCount || 0);
  const paxCount = Number(input.paxAdult || 0) + Number(input.paxChild || 0);
  const checks = {
    sale_confirmed: ["booked", "paid"].includes(String(input.status || "").toLowerCase()),
    suppliers_confirmed: componentCount > 0 && Number(input.confirmedCount || 0) === componentCount,
    supplier_orders_accepted: componentCount > 0 && Number(input.supplierOrderAcceptedCount || 0) === componentCount,
    references_complete: componentCount > 0 && Number(input.confirmationCount || 0) === componentCount,
    suppliers_paid: componentCount > 0 && Number(input.supplierPaidCount || 0) === componentCount,
    travelers_complete: paxCount > 0 && Number(input.travelerCount || 0) === paxCount,
    client_paid: String(input.paymentStatus || "unpaid").toLowerCase() === "paid",
  };
  const complete = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  return { checks, complete, total, percent: Math.round((complete / total) * 100), ready: complete === total };
}

function packageOperationsTimeline(input = {}, components = [], today = new Date()) {
  if (String(input.status || "").toLowerCase() === "cancelled") return [];
  const todayKey = today.toISOString().slice(0, 10);
  const events = [];
  const add = (type, dueAt, extra = {}) => {
    const date = String(dueAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000);
    events.push({ type, due_at: date, days, urgency: days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "soon" : "upcoming", ...extra });
  };
  if (String(input.paymentStatus || "unpaid") !== "paid") add("client_payment", input.paymentDueAt);
  components.forEach((component) => {
    if (component.supplier_paid === true) return;
    add("supplier_payment", component.supplier_payment_due_at, {
      booking_id: component.id || null,
      label: component.service_title || component.provider_name || null,
    });
  });
  add("manual_task", input.nextTaskDueAt);
  if (String(input.startDate || "").slice(0, 10) >= todayKey) add("departure", input.startDate);
  const priority = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  return events.sort((a, b) => priority[a.urgency] - priority[b.urgency] || a.due_at.localeCompare(b.due_at));
}

function hashShareToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createShareToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function createBookingReference(date = new Date(), bytes = crypto.randomBytes(3)) {
  const stamp = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `TVL-${stamp}-${Buffer.from(bytes).toString("hex").toUpperCase()}`;
}

function escapeTelegramHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSupplierServiceOrderMessage({ tourPackage = {}, component = {}, travelers = [] } = {}) {
  const serviceDate = component.date ? String(component.date).slice(0, 10) : "—";
  const pax = Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0);
  const travelerNames = travelers.map((item) => String(item.full_name || "").trim()).filter(Boolean);
  return [
    "📋 <b>Новый заказ от DMC</b>",
    `Тур: <b>${escapeTelegramHtml(tourPackage.title || "—")}</b>`,
    tourPackage.booking_reference ? `Номер тура: ${escapeTelegramHtml(tourPackage.booking_reference)}` : "",
    `Услуга: <b>${escapeTelegramHtml(component.service_title || "—")}</b>`,
    `Дата услуги: ${escapeTelegramHtml(serviceDate)}`,
    `Гостей: ${pax}`,
    travelerNames.length ? `Туристы: ${escapeTelegramHtml(travelerNames.join(", "))}` : "",
    component.confirmation_reference ? `Подтверждение: ${escapeTelegramHtml(component.confirmation_reference)}` : "",
    component.operational_note ? `Инструкции: ${escapeTelegramHtml(component.operational_note)}` : "",
    "",
    `<b>${escapeTelegramHtml(tourPackage.agency_name || "Travella partner")}</b>`,
    tourPackage.agency_phone ? `Телефон: ${escapeTelegramHtml(tourPackage.agency_phone)}` : "",
    tourPackage.agency_email ? `Email: ${escapeTelegramHtml(tourPackage.agency_email)}` : "",
  ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n");
}

async function notifyAgencyProposalResponse(item) {
  try {
    const provider = await pool.query(`SELECT to_jsonb(p) AS profile FROM providers p WHERE id=$1 LIMIT 1`, [item.owner_provider_id]);
    const profile = provider.rows[0]?.profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return false;
    const accepted = item.proposal_response === "accepted";
    const site = String(process.env.SITE_PUBLIC_URL || process.env.FRONTEND_URL || "https://travella.uz").replace(/\/+$/, "");
    const lines = [
      accepted ? "✅ <b>Клиент принял предложение</b>" : "✏️ <b>Клиент запросил изменения</b>",
      `Тур: <b>${escapeTelegramHtml(item.title)}</b>`,
      item.client_name ? `Клиент: ${escapeTelegramHtml(item.client_name)}` : "",
      item.proposal_response_message ? `Комментарий: ${escapeTelegramHtml(item.proposal_response_message)}` : "",
      `<a href="${site}/dashboard/bookings?tab=outgoing&amp;package=${encodeURIComponent(item.id)}">Открыть пакет</a>`,
    ].filter(Boolean);
    return tgSend(chatId, lines.join("\n"));
  } catch (error) {
    console.warn("notifyAgencyProposalResponse failed:", error?.message || error);
    return false;
  }
}

function publicPackageView(row = {}) {
  return {
    title: row.title,
    status: row.status,
    currency: row.currency,
    gross_total: row.gross_total,
    pax_adult: row.pax_adult,
    pax_child: row.pax_child,
    start_date: row.start_date,
    end_date: row.end_date,
    quote_valid_until: row.quote_valid_until,
    route: row.route || {},
    itinerary: Array.isArray(row.itinerary) ? row.itinerary : [],
    client_name: row.client_name || null,
    proposal_response: row.proposal_response || null,
    proposal_response_message: row.proposal_response_message || null,
    proposal_responded_at: row.proposal_responded_at || null,
    booking_reference: row.booking_reference || null,
    booked_at: row.booked_at || null,
    payment_status: row.payment_status || "unpaid",
    paid_amount: row.paid_amount || 0,
    payment_due_at: row.payment_due_at || null,
    paid_at: row.paid_at || null,
    revision: Number(row.current_revision || 0),
    agency: {
      name: row.agency_name || "Travella partner",
      phone: row.agency_phone || null,
      email: row.agency_email || null,
    },
  };
}

async function ensureTourPackagesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_packages (
      id UUID PRIMARY KEY,
      owner_provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      currency VARCHAR(8) NOT NULL DEFAULT 'UZS',
      net_total NUMERIC(18,2) NOT NULL DEFAULT 0,
      markup_type VARCHAR(16) NOT NULL DEFAULT 'percent',
      markup_value NUMERIC(18,2) NOT NULL DEFAULT 0,
      gross_total NUMERIC(18,2) NOT NULL DEFAULT 0,
      pax_adult INTEGER NOT NULL DEFAULT 0,
      pax_child INTEGER NOT NULL DEFAULT 0,
      start_date DATE,
      end_date DATE,
      quote_valid_until TIMESTAMPTZ,
      route JSONB NOT NULL DEFAULT '{}'::jsonb,
      itinerary JSONB NOT NULL DEFAULT '[]'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      client_name TEXT,
      client_phone TEXT,
      client_email TEXT,
      client_company TEXT,
      share_token_hash VARCHAR(64),
      shared_at TIMESTAMPTZ,
      share_expires_at TIMESTAMPTZ,
      proposal_response VARCHAR(32),
      proposal_response_message TEXT,
      proposal_responded_at TIMESTAMPTZ,
      booking_reference VARCHAR(32),
      booked_at TIMESTAMPTZ,
      payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
      paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      payment_due_at TIMESTAMPTZ,
      payment_note TEXT,
      paid_at TIMESTAMPTZ,
      current_revision INTEGER NOT NULL DEFAULT 0,
      accepted_revision INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS client_name TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS client_phone TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS client_email TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS client_company TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_response VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_response_message TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_responded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid'`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_note TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS accepted_revision INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_packages_owner_updated ON tour_packages(owner_provider_id, updated_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_packages_share_token ON tour_packages(share_token_hash) WHERE share_token_hash IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_packages_booking_reference ON tour_packages(booking_reference) WHERE booking_reference IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_revisions (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(package_id, version)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_revisions_package ON tour_package_revisions(package_id, version DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_payment_events (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      payment_status VARCHAR(16) NOT NULL,
      paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      payment_due_at TIMESTAMPTZ,
      payment_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_payment_events_package ON tour_package_payment_events(package_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_travelers (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      traveler_type VARCHAR(16) NOT NULL DEFAULT 'adult',
      birth_date DATE,
      citizenship TEXT,
      passport_number TEXT,
      passport_expiry DATE,
      room_type TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_travelers_package ON tour_package_travelers(package_id, sort_order, id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_component_ops (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      confirmation_reference TEXT,
      supplier_payment_due_at DATE,
      supplier_paid BOOLEAN NOT NULL DEFAULT FALSE,
      operational_note TEXT,
      service_order_sent_at TIMESTAMPTZ,
      service_order_status VARCHAR(16),
      service_order_responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(package_id, booking_id)
    )
  `);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_paid BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_status VARCHAR(16)`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_responded_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_component_ops_package ON tour_package_component_ops(package_id, booking_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_component_events (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      event_type VARCHAR(32) NOT NULL,
      actor_type VARCHAR(24) NOT NULL DEFAULT 'system',
      actor_telegram_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_component_events_booking ON tour_package_component_events(package_id, booking_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_tasks (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      task_type VARCHAR(32),
      booking_id BIGINT REFERENCES bookings(id) ON DELETE CASCADE,
      assigned_to TEXT,
      due_at DATE,
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE tour_package_tasks ADD COLUMN IF NOT EXISTS task_type VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_package_tasks ADD COLUMN IF NOT EXISTS booking_id BIGINT REFERENCES bookings(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_tasks_package ON tour_package_tasks(package_id, completed, due_at)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_package_tasks_open_system ON tour_package_tasks(package_id, booking_id, task_type) WHERE completed=FALSE AND task_type IS NOT NULL`);
}

function packageSnapshot(row = {}) {
  const snapshot = { ...row };
  delete snapshot.share_token_hash;
  delete snapshot.is_shared;
  return snapshot;
}

function requireProviderOwner(req, res) {
  if (String(req.user?.role || "").toLowerCase() !== "provider" || !Number(req.user?.id)) {
    res.status(403).json({ message: "Tour packages are available to agencies and DMC providers" });
    return null;
  }
  return Number(req.user.id);
}

async function packageBookings(packageId) {
  const result = await pool.query(
    `SELECT b.id, b.status, b.provider_id, b.provider_price, b.currency,
            b.payment_status, b.date, b.provider_note,
            s.title AS service_title,
            p.name AS provider_name, p.type AS provider_type, p.phone AS provider_phone,
            p.social AS provider_telegram,
            ops.confirmation_reference, ops.supplier_payment_due_at,
            COALESCE(ops.supplier_paid,FALSE) AS supplier_paid, ops.operational_note,
            ops.service_order_sent_at,ops.service_order_status,ops.service_order_responded_at,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id',event.id,'event_type',event.event_type,'actor_type',event.actor_type,
                'created_at',event.created_at,'metadata',event.metadata
              ) ORDER BY event.created_at DESC,event.id DESC)
              FROM tour_package_component_events event
              WHERE event.package_id=$1::uuid AND event.booking_id=b.id
            ),'[]'::jsonb) AS service_order_events
       FROM bookings b
       LEFT JOIN providers p ON p.id = b.provider_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN tour_package_component_ops ops ON ops.package_id=$1::uuid AND ops.booking_id=b.id
      WHERE b.group_id = $1::uuid
      ORDER BY b.created_at, b.id`,
    [packageId]
  );
  return result.rows;
}

async function updateTourPackageComponentOperations(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const current = await pool.query(
      `SELECT tp.status
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    if (String(current.rows[0].status) === "cancelled") return res.status(409).json({ message: "Cancelled packages cannot be changed" });
    const value = normalizeComponentOperations(req.body);
    const result = await pool.query(
      `INSERT INTO tour_package_component_ops(
         package_id,booking_id,confirmation_reference,supplier_payment_due_at,supplier_paid,operational_note
       ) VALUES($1::uuid,$2,$3,$4::date,$5,$6)
       ON CONFLICT(package_id,booking_id) DO UPDATE SET
         confirmation_reference=EXCLUDED.confirmation_reference,
         supplier_payment_due_at=EXCLUDED.supplier_payment_due_at,
         supplier_paid=EXCLUDED.supplier_paid,
         operational_note=EXCLUDED.operational_note,
         updated_at=NOW()
       RETURNING booking_id,confirmation_reference,supplier_payment_due_at,supplier_paid,operational_note,updated_at`,
      [packageId, bookingId, value.confirmationReference, value.supplierPaymentDueAt, value.supplierPaid, value.operationalNote]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageComponentOperations error:", error);
    return res.status(500).json({ message: "Failed to update component operations" });
  }
}

function normalizePackageBody(body = {}) {
  const markupType = body.markup_type === "fixed" ? "fixed" : "percent";
  const netTotal = cleanMoney(body.net_total);
  const markupValue = cleanMoney(body.markup_value);
  return {
    title: String(body.title || "Tour proposal").trim().slice(0, 180) || "Tour proposal",
    status: PACKAGE_STATUSES.has(body.status) ? body.status : "draft",
    currency: String(body.currency || "UZS").trim().toUpperCase().slice(0, 8) || "UZS",
    netTotal,
    markupType,
    markupValue,
    grossTotal: calculateGross(netTotal, markupType, markupValue),
    paxAdult: Math.max(0, Math.trunc(Number(body.pax_adult) || 0)),
    paxChild: Math.max(0, Math.trunc(Number(body.pax_child) || 0)),
    startDate: body.start_date || null,
    endDate: body.end_date || null,
    quoteValidUntil: body.quote_valid_until || null,
    route: body.route && typeof body.route === "object" ? body.route : {},
    itinerary: Array.isArray(body.itinerary) ? body.itinerary : [],
    meta: body.meta && typeof body.meta === "object" ? body.meta : {},
    clientName: String(body.client_name || "").trim().slice(0, 180) || null,
    clientPhone: String(body.client_phone || "").trim().slice(0, 80) || null,
    clientEmail: String(body.client_email || "").trim().slice(0, 180) || null,
    clientCompany: String(body.client_company || "").trim().slice(0, 180) || null,
  };
}

async function createTourPackage(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const id = String(req.body?.id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ message: "Valid package UUID is required" });
    }
    const value = normalizePackageBody(req.body);
    const result = await pool.query(
      `INSERT INTO tour_packages (
         id, owner_provider_id, title, status, currency, net_total, markup_type,
         markup_value, gross_total, pax_adult, pax_child, start_date, end_date,
         quote_valid_until, route, itinerary, meta, client_name, client_phone,
         client_email, client_company
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, status=EXCLUDED.status, currency=EXCLUDED.currency,
         net_total=EXCLUDED.net_total, markup_type=EXCLUDED.markup_type,
         markup_value=EXCLUDED.markup_value, gross_total=EXCLUDED.gross_total,
         pax_adult=EXCLUDED.pax_adult, pax_child=EXCLUDED.pax_child,
         start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
         quote_valid_until=EXCLUDED.quote_valid_until, route=EXCLUDED.route,
         itinerary=EXCLUDED.itinerary, meta=EXCLUDED.meta,
         client_name=EXCLUDED.client_name, client_phone=EXCLUDED.client_phone,
         client_email=EXCLUDED.client_email, client_company=EXCLUDED.client_company,
         updated_at=NOW()
       WHERE tour_packages.owner_provider_id=$2
       RETURNING *`,
      [id, ownerId, value.title, value.status, value.currency, value.netTotal,
        value.markupType, value.markupValue, value.grossTotal, value.paxAdult,
        value.paxChild, value.startDate, value.endDate, value.quoteValidUntil,
        JSON.stringify(value.route), JSON.stringify(value.itinerary), JSON.stringify(value.meta),
        value.clientName, value.clientPhone, value.clientEmail, value.clientCompany]
    );
    if (!result.rowCount) return res.status(403).json({ message: "Package belongs to another agency" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("createTourPackage error:", error);
    return res.status(500).json({ message: "Failed to create tour package" });
  }
}

async function listTourPackages(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const result = await pool.query(
      `SELECT tp.*,
              COUNT(b.id)::int AS component_count,
              COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','paid','completed'))::int AS confirmed_count,
              COUNT(b.id) FILTER (WHERE NULLIF(TRIM(ops.confirmation_reference),'') IS NOT NULL)::int AS confirmation_count,
              COUNT(b.id) FILTER (WHERE COALESCE(ops.supplier_paid,FALSE)=TRUE)::int AS supplier_paid_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='accepted')::int AS supplier_order_accepted_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='sent')::int AS supplier_order_pending_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='declined')::int AS supplier_order_declined_count,
              COUNT(b.id) FILTER (
                WHERE tp.status IN ('booked','paid') AND (
                  ops.service_order_status IS NULL OR
                  ops.service_order_status IN ('declined','failed') OR
                  (ops.service_order_status='sent' AND ops.service_order_sent_at < NOW() - INTERVAL '24 hours')
                )
              )::int AS supplier_order_attention_count,
              (SELECT COUNT(*)::int FROM tour_package_travelers tr WHERE tr.package_id=tp.id) AS traveler_count,
              (SELECT COUNT(*)::int FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE) AS open_task_count,
              (SELECT COUNT(*)::int FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE AND task.due_at < CURRENT_DATE) AS overdue_task_count,
              (SELECT MIN(task.due_at) FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE) AS next_task_due_at,
              COUNT(b.id) FILTER (
                WHERE b.status IN ('confirmed','paid','completed')
                  AND tp.status <> 'cancelled'
                  AND (tp.end_date IS NULL OR tp.end_date >= CURRENT_DATE)
                  AND NULLIF(TRIM(ops.confirmation_reference),'') IS NULL
              )::int AS missing_confirmation_count,
              COUNT(b.id) FILTER (
                WHERE ops.supplier_payment_due_at < CURRENT_DATE
                  AND tp.status <> 'cancelled'
                  AND COALESCE(ops.supplier_paid,FALSE)=FALSE
              )::int AS supplier_overdue_count,
              COUNT(b.id) FILTER (
                WHERE ops.supplier_payment_due_at IS NOT NULL
                  AND tp.status <> 'cancelled'
                  AND COALESCE(ops.supplier_paid,FALSE)=FALSE
              )::int AS supplier_unpaid_count,
              MIN(ops.supplier_payment_due_at) FILTER (
                WHERE ops.supplier_payment_due_at IS NOT NULL
                  AND COALESCE(ops.supplier_paid,FALSE)=FALSE
              ) AS next_supplier_due_at,
              COALESCE(ARRAY_AGG(b.status::text) FILTER (WHERE b.id IS NOT NULL), ARRAY[]::text[]) AS component_statuses
         FROM tour_packages tp
         LEFT JOIN bookings b ON b.group_id=tp.id
         LEFT JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.owner_provider_id=$1
        GROUP BY tp.id
        ORDER BY tp.updated_at DESC`,
      [ownerId]
    );
    const items = result.rows.map((item) => {
      const bookings = (item.component_statuses || []).map((status) => ({ status }));
      const timeline = packageOperationsTimeline({
        status: item.status,
        paymentStatus: item.payment_status,
        paymentDueAt: item.payment_due_at,
        startDate: item.start_date,
        nextTaskDueAt: item.next_task_due_at,
      }, item.next_supplier_due_at ? [{ supplier_payment_due_at: item.next_supplier_due_at }] : []);
      return {
        ...item,
        component_statuses: undefined,
        is_shared: Boolean(item.share_token_hash),
        share_token_hash: undefined,
        status: derivePackageStatus(bookings, item.status),
        operations_readiness: packageOperationsReadiness({
          status: derivePackageStatus(bookings, item.status),
          paymentStatus: item.payment_status,
          paxAdult: item.pax_adult,
          paxChild: item.pax_child,
          travelerCount: item.traveler_count,
          componentCount: item.component_count,
          confirmedCount: item.confirmed_count,
          confirmationCount: item.confirmation_count,
          supplierPaidCount: item.supplier_paid_count,
          supplierOrderAcceptedCount: item.supplier_order_accepted_count,
        }),
        next_action: timeline[0] || null,
      };
    });
    return res.json(items);
  } catch (error) {
    console.error("listTourPackages error:", error);
    return res.status(500).json({ message: "Failed to list tour packages" });
  }
}

async function getTourPackage(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const result = await pool.query(
      `SELECT tp.*,p.name AS agency_name,p.phone AS agency_phone,p.email AS agency_email
         FROM tour_packages tp JOIN providers p ON p.id=tp.owner_provider_id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package not found" });
    const bookings = await packageBookings(req.params.id);
    const item = result.rows[0];
    const revisions = await pool.query(
      `SELECT version,created_at,
              snapshot->>'title' AS title,
              snapshot->>'gross_total' AS gross_total,
              snapshot->>'currency' AS currency
         FROM tour_package_revisions WHERE package_id=$1::uuid ORDER BY version DESC`,
      [req.params.id]
    );
    const paymentEvents = await pool.query(
      `SELECT id,payment_status,paid_amount,payment_due_at,payment_note,created_at
         FROM tour_package_payment_events WHERE package_id=$1::uuid ORDER BY created_at DESC,id DESC`,
      [req.params.id]
    );
    const travelers = await pool.query(
      `SELECT id,full_name,traveler_type,birth_date,citizenship,passport_number,
              passport_expiry,room_type,notes,sort_order
         FROM tour_package_travelers WHERE package_id=$1::uuid ORDER BY sort_order,id`,
      [req.params.id]
    );
    const tasks = await pool.query(
      `SELECT task.id,task.title,task.task_type,task.booking_id,task.assigned_to,task.due_at,
              task.priority,task.completed,task.completed_at,task.created_at,task.updated_at,
              service.title AS service_title
         FROM tour_package_tasks task
         LEFT JOIN bookings booking ON booking.id=task.booking_id
         LEFT JOIN services service ON service.id=booking.service_id
        WHERE task.package_id=$1::uuid
        ORDER BY task.completed ASC, task.due_at ASC NULLS LAST, task.created_at DESC`,
      [req.params.id]
    );
    return res.json({
      ...item,
      share_token_hash: undefined,
      is_shared: Boolean(item.share_token_hash),
      status: derivePackageStatus(bookings, item.status),
      components: bookings,
      revisions: revisions.rows,
      payment_events: paymentEvents.rows,
      travelers: travelers.rows,
      tasks: tasks.rows,
      readiness: packageSaleReadiness(bookings, item.proposal_response),
      operations_readiness: packageOperationsReadiness({
        status: derivePackageStatus(bookings, item.status),
        paymentStatus: item.payment_status,
        paxAdult: item.pax_adult,
        paxChild: item.pax_child,
        travelerCount: travelers.rowCount,
        componentCount: bookings.length,
        confirmedCount: bookings.filter((row) => ["confirmed", "paid", "completed"].includes(String(row.status).toLowerCase())).length,
        confirmationCount: bookings.filter((row) => String(row.confirmation_reference || "").trim()).length,
        supplierPaidCount: bookings.filter((row) => row.supplier_paid === true).length,
        supplierOrderAcceptedCount: bookings.filter((row) => row.service_order_status === "accepted").length,
      }),
      operations_timeline: packageOperationsTimeline({
        status: derivePackageStatus(bookings, item.status),
        paymentStatus: item.payment_status,
        paymentDueAt: item.payment_due_at,
        startDate: item.start_date,
      }, bookings),
    });
  } catch (error) {
    console.error("getTourPackage error:", error);
    return res.status(500).json({ message: "Failed to load tour package" });
  }
}

async function updateTourPackage(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(`SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`, [req.params.id, ownerId]);
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });
    if (!canEditTourPackage(current.rows[0].status)) {
      return res.status(409).json({ message: "Booked, paid or cancelled packages cannot be edited" });
    }
    const value = normalizePackageBody({
      ...current.rows[0],
      ...req.body,
      meta: { ...(current.rows[0].meta || {}), ...(req.body?.meta || {}) },
    });
    const result = await pool.query(
      `UPDATE tour_packages SET title=$3,status=$4,currency=$5,net_total=$6,
         markup_type=$7,markup_value=$8,gross_total=$9,quote_valid_until=$10,
         meta=$11::jsonb, client_name=$12, client_phone=$13, client_email=$14,
         client_company=$15, route=$16::jsonb, itinerary=$17::jsonb,
         pax_adult=$18, pax_child=$19, start_date=$20::date, end_date=$21::date,
         updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2 RETURNING *`,
      [req.params.id, ownerId, value.title, value.status, value.currency, value.netTotal,
        value.markupType, value.markupValue, value.grossTotal, value.quoteValidUntil,
        JSON.stringify(value.meta), value.clientName, value.clientPhone, value.clientEmail,
        value.clientCompany, JSON.stringify(value.route), JSON.stringify(value.itinerary),
        value.paxAdult, value.paxChild, value.startDate, value.endDate]
    );
    return res.json({ ...result.rows[0], share_token_hash: undefined, is_shared: Boolean(result.rows[0].share_token_hash) });
  } catch (error) {
    console.error("updateTourPackage error:", error);
    return res.status(500).json({ message: "Failed to update tour package" });
  }
}

async function shareTourPackage(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(
      `SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });

    const value = normalizePackageBody({ ...current.rows[0], ...req.body });
    const token = createShareToken();
    const fallbackExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const requestedExpiry = value.quoteValidUntil ? new Date(value.quoteValidUntil) : fallbackExpiry;
    const expiresAt = Number.isFinite(requestedExpiry.getTime()) && requestedExpiry > new Date()
      ? requestedExpiry
      : fallbackExpiry;
    const isFinal = ["booked", "paid"].includes(String(current.rows[0].status));
    const nextRevision = isFinal ? Number(current.rows[0].current_revision || 0) : Number(current.rows[0].current_revision || 0) + 1;
    const result = await pool.query(
      `UPDATE tour_packages SET title=$3, client_name=$4, client_phone=$5,
         client_email=$6, client_company=$7, quote_valid_until=$8,
         share_token_hash=$9, shared_at=NOW(),
         share_expires_at=CASE WHEN status IN ('booked','paid')
           THEN GREATEST($8::timestamptz, COALESCE(end_date::timestamptz + INTERVAL '7 days', NOW() + INTERVAL '30 days'))
           ELSE $8::timestamptz END,
         proposal_response=CASE WHEN status IN ('booked','paid') THEN proposal_response ELSE NULL END,
         proposal_response_message=CASE WHEN status IN ('booked','paid') THEN proposal_response_message ELSE NULL END,
         proposal_responded_at=CASE WHEN status IN ('booked','paid') THEN proposal_responded_at ELSE NULL END,
         status=CASE WHEN status IN ('booked','paid') THEN status ELSE 'proposed' END,
         current_revision=$10,
         updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2
       RETURNING *`,
      [req.params.id, ownerId, value.title, value.clientName, value.clientPhone,
        value.clientEmail, value.clientCompany, expiresAt.toISOString(), hashShareToken(token), nextRevision]
    );
    if (!isFinal) {
      await pool.query(
        `INSERT INTO tour_package_revisions(package_id,version,snapshot)
         VALUES($1::uuid,$2,$3::jsonb)
         ON CONFLICT(package_id,version) DO UPDATE SET snapshot=EXCLUDED.snapshot,created_at=NOW()`,
        [req.params.id, nextRevision, JSON.stringify(packageSnapshot(result.rows[0]))]
      );
    }
    return res.json({
      id: result.rows[0].id,
      status: result.rows[0].status,
      shared_at: result.rows[0].shared_at,
      share_expires_at: result.rows[0].share_expires_at,
      current_revision: result.rows[0].current_revision,
      token,
    });
  } catch (error) {
    console.error("shareTourPackage error:", error);
    return res.status(500).json({ message: "Failed to create proposal link" });
  }
}

async function respondToTourProposal(req, res) {
  try {
    const token = String(req.params.token || "");
    const response = String(req.body?.response || "").trim().toLowerCase();
    const message = String(req.body?.message || "").trim().slice(0, 2000) || null;
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return res.status(404).json({ message: "Proposal not found" });
    if (!new Set(["accepted", "changes_requested"]).has(response)) {
      return res.status(400).json({ message: "Valid proposal response is required" });
    }
    await ensureTourPackagesTable();
    const result = await pool.query(
      `UPDATE tour_packages SET proposal_response=$2,
         proposal_response_message=$3, proposal_responded_at=NOW(), updated_at=NOW()
         ,accepted_revision=CASE WHEN $2='accepted' THEN current_revision ELSE NULL END
       WHERE share_token_hash=$1 AND share_expires_at > NOW()
       RETURNING id,owner_provider_id,title,client_name,proposal_response,
         proposal_response_message,proposal_responded_at`,
      [hashShareToken(token), response, message]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Proposal not found or expired" });
    setImmediate(() => { notifyAgencyProposalResponse(result.rows[0]); });
    res.set("Cache-Control", "no-store");
    return res.json({
      proposal_response: result.rows[0].proposal_response,
      proposal_response_message: result.rows[0].proposal_response_message,
      proposal_responded_at: result.rows[0].proposal_responded_at,
    });
  } catch (error) {
    console.error("respondToTourProposal error:", error);
    return res.status(500).json({ message: "Failed to save proposal response" });
  }
}

async function confirmTourPackageSale(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(
      `SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });
    const bookings = await packageBookings(req.params.id);
    const readiness = packageSaleReadiness(bookings, current.rows[0].proposal_response);
    if (!readiness.client_accepted) {
      return res.status(409).json({ message: "Client acceptance is required", readiness });
    }
    if (!readiness.component_count) {
      return res.status(409).json({ message: "The package has no booking components", readiness });
    }
    if (!readiness.ready) {
      return res.status(409).json({ message: "All supplier components must be confirmed", readiness });
    }
    const bookingReference = current.rows[0].booking_reference || createBookingReference();
    const result = await pool.query(
      `UPDATE tour_packages SET status='booked', booking_reference=COALESCE(booking_reference,$3),
         booked_at=COALESCE(booked_at,NOW()),
         share_expires_at=GREATEST(
           COALESCE(share_expires_at, NOW()),
           COALESCE(end_date::timestamptz + INTERVAL '7 days', NOW() + INTERVAL '30 days')
         ),
         updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2
       RETURNING *`,
      [req.params.id, ownerId, bookingReference]
    );
    return res.json({ ...result.rows[0], share_token_hash: undefined, is_shared: Boolean(result.rows[0].share_token_hash), readiness });
  } catch (error) {
    console.error("confirmTourPackageSale error:", error);
    return res.status(500).json({ message: "Failed to confirm package sale" });
  }
}

async function updateTourPackagePayment(req, res) {
  let client;
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(
      `SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });
    if (!["booked", "paid"].includes(String(current.rows[0].status || "").toLowerCase())) {
      return res.status(409).json({ message: "Confirm the package sale before recording client payment" });
    }
    const payment = normalizePackagePayment(req.body, current.rows[0].gross_total);
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tour_packages SET payment_status=$3, paid_amount=$4,
         payment_due_at=$5, payment_note=$6,
         paid_at=CASE WHEN $3='paid' THEN COALESCE(paid_at,NOW()) ELSE NULL END,
         status=CASE WHEN $3='paid' THEN 'paid' ELSE 'booked' END,
         updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2 RETURNING *`,
      [req.params.id, ownerId, payment.paymentStatus, payment.paidAmount,
        payment.paymentDueAt, payment.paymentNote]
    );
    await client.query(
      `INSERT INTO tour_package_payment_events(package_id,payment_status,paid_amount,payment_due_at,payment_note)
       VALUES($1::uuid,$2,$3,$4,$5)`,
      [req.params.id, payment.paymentStatus, payment.paidAmount, payment.paymentDueAt, payment.paymentNote]
    );
    await client.query("COMMIT");
    return res.json({ ...result.rows[0], share_token_hash: undefined, is_shared: Boolean(result.rows[0].share_token_hash) });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("updateTourPackagePayment error:", error);
    return res.status(500).json({ message: "Failed to update package payment" });
  } finally {
    client?.release();
  }
}

async function replaceTourPackageTravelers(req, res) {
  let client;
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(
      `SELECT id,status,pax_adult,pax_child FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });
    if (String(current.rows[0].status) === "cancelled") return res.status(409).json({ message: "Cancelled packages cannot be changed" });
    const rows = Array.isArray(req.body?.travelers) ? req.body.travelers.slice(0, 200).map(normalizeTraveler) : [];
    if (rows.some((row) => !row.fullName)) return res.status(400).json({ message: "Every traveler must have a full name" });
    const capacity = Number(current.rows[0].pax_adult || 0) + Number(current.rows[0].pax_child || 0);
    if (rows.length > capacity) return res.status(400).json({ message: "Traveler count exceeds package PAX" });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`DELETE FROM tour_package_travelers WHERE package_id=$1::uuid`, [req.params.id]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO tour_package_travelers(package_id,full_name,traveler_type,birth_date,citizenship,
           passport_number,passport_expiry,room_type,notes,sort_order)
         VALUES($1::uuid,$2,$3,$4::date,$5,$6,$7::date,$8,$9,$10)`,
        [req.params.id, row.fullName, row.travelerType, row.birthDate, row.citizenship,
          row.passportNumber, row.passportExpiry, row.roomType, row.notes, row.sortOrder]
      );
    }
    await client.query(`UPDATE tour_packages SET updated_at=NOW() WHERE id=$1::uuid`, [req.params.id]);
    await client.query("COMMIT");
    const result = await pool.query(
      `SELECT id,full_name,traveler_type,birth_date,citizenship,passport_number,
              passport_expiry,room_type,notes,sort_order
         FROM tour_package_travelers WHERE package_id=$1::uuid ORDER BY sort_order,id`,
      [req.params.id]
    );
    return res.json({ travelers: result.rows });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("replaceTourPackageTravelers error:", error);
    return res.status(500).json({ message: "Failed to update travelers" });
  } finally {
    client?.release();
  }
}

async function sendTourPackageServiceOrder(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const result = await pool.query(
      `SELECT tp.title,tp.status,tp.booking_reference,tp.pax_adult,tp.pax_child,
              agency.name AS agency_name,agency.phone AS agency_phone,agency.email AS agency_email,
              b.id,b.date,s.title AS service_title,to_jsonb(supplier) AS supplier_profile,
              ops.confirmation_reference,ops.operational_note
         FROM tour_packages tp
         JOIN providers agency ON agency.id=tp.owner_provider_id
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         LEFT JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    const item = result.rows[0];
    if (!["booked", "paid"].includes(String(item.status || "").toLowerCase())) {
      return res.status(409).json({ message: "Confirm the tour sale before sending supplier orders" });
    }
    const profile = item.supplier_profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return res.status(409).json({ message: "Supplier Telegram is not connected" });
    const travelers = await pool.query(
      `SELECT full_name FROM tour_package_travelers WHERE package_id=$1::uuid ORDER BY sort_order,id`,
      [packageId]
    );
    const message = buildSupplierServiceOrderMessage({ tourPackage: item, component: item, travelers: travelers.rows });
    const keyboard = { inline_keyboard: [[
      { text: "✅ Принять заказ", callback_data: `tour_order:${bookingId}:accepted` },
      { text: "❌ Отклонить", callback_data: `tour_order:${bookingId}:declined` },
    ]] };
    const saved = await pool.query(
      `INSERT INTO tour_package_component_ops(package_id,booking_id,service_order_sent_at,service_order_status,service_order_responded_at)
       VALUES($1::uuid,$2,NOW(),'sent',NULL)
       ON CONFLICT(package_id,booking_id) DO UPDATE SET
         service_order_sent_at=NOW(),service_order_status='sent',service_order_responded_at=NULL,updated_at=NOW()
       RETURNING service_order_sent_at,service_order_status,service_order_responded_at`,
      [packageId, bookingId]
    );
    if (!(await tgSend(chatId, message, { reply_markup: keyboard }))) {
      await pool.query(
        `UPDATE tour_package_component_ops SET service_order_sent_at=NULL,service_order_status='failed',updated_at=NOW()
         WHERE package_id=$1::uuid AND booking_id=$2`,
        [packageId, bookingId]
      );
      await pool.query(
        `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type)
         VALUES($1::uuid,$2,'delivery_failed','dmc')`,
        [packageId, bookingId]
      );
      return res.status(502).json({ message: "Failed to send supplier order" });
    }
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type)
       VALUES($1::uuid,$2,'sent','dmc')
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId]
    );
    return res.json({ sent: true, ...saved.rows[0], service_order_event: event.rows[0] });
  } catch (error) {
    console.error("sendTourPackageServiceOrder error:", error);
    return res.status(500).json({ message: "Failed to send supplier order" });
  }
}

async function createTourPackageTask(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const value = normalizeTourTask(req.body);
    if (!value.title) return res.status(400).json({ message: "Task title is required" });
    const result = await pool.query(
      `INSERT INTO tour_package_tasks(package_id,title,assigned_to,due_at,priority,completed,completed_at)
       SELECT tp.id,$3,$4,$5::date,$6,$7,CASE WHEN $7 THEN NOW() ELSE NULL END
         FROM tour_packages tp WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2
       RETURNING id,title,assigned_to,due_at,priority,completed,completed_at,created_at,updated_at`,
      [req.params.id, ownerId, value.title, value.assignedTo, value.dueAt, value.priority, value.completed]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("createTourPackageTask error:", error);
    return res.status(500).json({ message: "Failed to create task" });
  }
}

async function updateTourPackageTask(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const value = normalizeTourTask(req.body);
    if (!value.title) return res.status(400).json({ message: "Task title is required" });
    const result = await pool.query(
      `UPDATE tour_package_tasks task SET
         title=$4,assigned_to=$5,due_at=$6::date,priority=$7,completed=$8,
         completed_at=CASE WHEN $8 AND task.completed=FALSE THEN NOW() WHEN NOT $8 THEN NULL ELSE task.completed_at END,
         updated_at=NOW()
       FROM tour_packages tp
       WHERE task.id=$3 AND task.package_id=$1::uuid AND tp.id=task.package_id AND tp.owner_provider_id=$2
       RETURNING task.id,task.title,task.assigned_to,task.due_at,task.priority,task.completed,task.completed_at,task.created_at,task.updated_at`,
      [req.params.id, ownerId, req.params.taskId, value.title, value.assignedTo, value.dueAt, value.priority, value.completed]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Task not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageTask error:", error);
    return res.status(500).json({ message: "Failed to update task" });
  }
}

async function deleteTourPackageTask(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const result = await pool.query(
      `DELETE FROM tour_package_tasks task USING tour_packages tp
       WHERE task.id=$3 AND task.package_id=$1::uuid AND tp.id=task.package_id AND tp.owner_provider_id=$2
       RETURNING task.id`,
      [req.params.id, ownerId, req.params.taskId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Task not found" });
    return res.status(204).end();
  } catch (error) {
    console.error("deleteTourPackageTask error:", error);
    return res.status(500).json({ message: "Failed to delete task" });
  }
}

async function revokeTourPackageShare(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const result = await pool.query(
      `UPDATE tour_packages SET share_token_hash=NULL, shared_at=NULL,
         share_expires_at=NULL, updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2 RETURNING id`,
      [req.params.id, ownerId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package not found" });
    return res.status(204).send();
  } catch (error) {
    console.error("revokeTourPackageShare error:", error);
    return res.status(500).json({ message: "Failed to revoke proposal link" });
  }
}

async function getPublicTourProposal(req, res) {
  try {
    const token = String(req.params.token || "");
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return res.status(404).json({ message: "Proposal not found" });
    await ensureTourPackagesTable();
    const result = await pool.query(
      `SELECT tp.*, rev.snapshot AS published_snapshot,
              p.name AS agency_name, p.phone AS agency_phone, p.email AS agency_email
         FROM tour_packages tp
         JOIN providers p ON p.id=tp.owner_provider_id
         LEFT JOIN tour_package_revisions rev
           ON rev.package_id=tp.id AND rev.version=tp.current_revision
        WHERE tp.share_token_hash=$1 AND tp.share_expires_at > NOW()
        LIMIT 1`,
      [hashShareToken(token)]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Proposal not found or expired" });
    res.set("Cache-Control", "no-store");
    const item = result.rows[0];
    const published = item.published_snapshot && typeof item.published_snapshot === "object"
      ? item.published_snapshot
      : item;
    return res.json(publicPackageView({
      ...published,
      status: item.status,
      proposal_response: item.proposal_response,
      proposal_response_message: item.proposal_response_message,
      proposal_responded_at: item.proposal_responded_at,
      booking_reference: item.booking_reference,
      booked_at: item.booked_at,
      payment_status: item.payment_status,
      paid_amount: item.paid_amount,
      payment_due_at: item.payment_due_at,
      paid_at: item.paid_at,
      agency_name: item.agency_name,
      agency_phone: item.agency_phone,
      agency_email: item.agency_email,
    }));
  } catch (error) {
    console.error("getPublicTourProposal error:", error);
    return res.status(500).json({ message: "Failed to load proposal" });
  }
}

module.exports = {
  calculateGross,
  canEditTourPackage,
  normalizePackagePayment,
  normalizeTraveler,
  normalizeComponentOperations,
  normalizeTourTask,
  derivePackageStatus,
  packageSaleReadiness,
  packageOperationsReadiness,
  packageOperationsTimeline,
  hashShareToken,
  createBookingReference,
  escapeTelegramHtml,
  buildSupplierServiceOrderMessage,
  publicPackageView,
  packageSnapshot,
  createTourPackage,
  listTourPackages,
  getTourPackage,
  updateTourPackage,
  shareTourPackage,
  revokeTourPackageShare,
  getPublicTourProposal,
  respondToTourProposal,
  confirmTourPackageSale,
  updateTourPackagePayment,
  replaceTourPackageTravelers,
  updateTourPackageComponentOperations,
  sendTourPackageServiceOrder,
  createTourPackageTask,
  updateTourPackageTask,
  deleteTourPackageTask,
};

