const crypto = require("crypto");
const axios = require("axios");
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const PACKAGE_STATUSES = new Set([
  "draft", "request_sent", "partially_confirmed", "confirmed",
  "proposed", "accepted", "lost", "booked", "paid", "cancelled",
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

function normalizePackageRefund(body = {}, paidAmount = 0) {
  const received = cleanMoney(paidAmount);
  const dueAmount = Math.min(cleanMoney(body.refund_due_amount), received);
  const refundedAmount = Math.min(cleanMoney(body.refunded_amount), dueAmount);
  const status = dueAmount <= 0 ? "not_required" : refundedAmount >= dueAmount ? "refunded" : refundedAmount > 0 ? "partial" : "pending";
  return {
    refundStatus: status,
    refundDueAmount: dueAmount,
    refundedAmount,
    refundDueAt: status === "refunded" || status === "not_required" ? null : body.refund_due_at || null,
    refundNote: String(body.refund_note || "").trim().slice(0, 1000) || null,
  };
}

function normalizeSupplierRefund(body = {}, supplierCost = 0) {
  const paid = cleanMoney(supplierCost);
  const dueAmount = Math.min(cleanMoney(body.supplier_refund_due_amount), paid);
  const receivedAmount = Math.min(cleanMoney(body.supplier_refunded_amount), dueAmount);
  const status = dueAmount <= 0 ? "not_required" : receivedAmount >= dueAmount ? "refunded" : receivedAmount > 0 ? "partial" : "pending";
  return {
    status,
    dueAmount,
    receivedAmount,
    dueAt: status === "refunded" || status === "not_required" ? null : body.supplier_refund_due_at || null,
    note: String(body.supplier_refund_note || "").trim().slice(0, 1000) || null,
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
  const rating = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : null;
  const actualCost = body.actual_supplier_cost === "" || body.actual_supplier_cost == null ? null : cleanMoney(body.actual_supplier_cost);
  return {
    confirmationReference: String(body.confirmation_reference || "").trim().slice(0, 120) || null,
    supplierPaymentDueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? dueAt : null,
    supplierPaid: body.supplier_paid === true,
    operationalNote: String(body.operational_note || "").trim().slice(0, 1000) || null,
    qualityRating: rating(body.quality_rating),
    reliabilityRating: rating(body.reliability_rating),
    performanceNote: String(body.performance_note || "").trim().slice(0, 1000) || null,
    actualSupplierCost: actualCost,
    costVarianceNote: String(body.cost_variance_note || "").trim().slice(0, 1000) || null,
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

function normalizeClientFollowup(body = {}) {
  const supportedChannels = new Set(["phone", "email", "telegram", "whatsapp", "other"]);
  return {
    channel: supportedChannels.has(body.channel) ? body.channel : "phone",
    note: String(body.note || "").trim().slice(0, 1000) || null,
  };
}

function derivePackageStatus(rows = [], storedStatus = "draft") {
  if (["proposed", "accepted", "lost", "booked", "paid", "cancelled"].includes(storedStatus)) return storedStatus;
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
    documents_approved: componentCount > 0 && Number(input.approvedDocumentCount || 0) === componentCount,
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
  if (String(input.status || "").toLowerCase() === "proposed" && !input.proposalResponse) {
    const followupBase = input.lastClientFollowupAt || input.sharedAt;
    if (followupBase) add("client_follow_up", new Date(new Date(followupBase).getTime() + 48 * 60 * 60 * 1000).toISOString());
    add("proposal_expiry", input.quoteValidUntil);
  }
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

function buildSupplierServiceOrderReminderMessage({ tourPackage = {}, component = {} } = {}) {
  return [
    "⏰ <b>Напоминание об ожидающем заказе</b>",
    `Тур: <b>${escapeTelegramHtml(tourPackage.title || "—")}</b>`,
    tourPackage.booking_reference ? `Номер тура: ${escapeTelegramHtml(tourPackage.booking_reference)}` : "",
    `Услуга: <b>${escapeTelegramHtml(component.service_title || "—")}</b>`,
    "Пожалуйста, примите или отклоните заказ кнопкой ниже.",
  ].filter(Boolean).join("\n");
}

function buildSupplierServiceOrderCancellationMessage({ tourPackage = {}, component = {} } = {}) {
  return [
    "🚫 <b>Заказ отменён DMC</b>",
    `Тур: <b>${escapeTelegramHtml(tourPackage.title || "—")}</b>`,
    tourPackage.booking_reference ? `Номер тура: ${escapeTelegramHtml(tourPackage.booking_reference)}` : "",
    `Услуга: <b>${escapeTelegramHtml(component.service_title || "—")}</b>`,
    "Пожалуйста, не выполняйте этот заказ. При необходимости DMC свяжется с вами отдельно.",
  ].filter(Boolean).join("\n");
}

function buildSupplierServiceOrderNoteMessage({ tourPackage = {}, component = {}, note = "" } = {}) {
  return [
    "💬 <b>Сообщение от DMC по заказу</b>",
    `Тур: <b>${escapeTelegramHtml(tourPackage.title || "—")}</b>`,
    tourPackage.booking_reference ? `Номер тура: ${escapeTelegramHtml(tourPackage.booking_reference)}` : "",
    `Услуга: <b>${escapeTelegramHtml(component.service_title || "—")}</b>`,
    "",
    escapeTelegramHtml(note),
  ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n");
}

function buildSupplierDocumentRequestMessage({ tourPackage = {}, component = {} } = {}) {
  return [
    "📎 <b>DMC запрашивает документы по заказу</b>",
    `Тур: <b>${escapeTelegramHtml(tourPackage.title || "—")}</b>`,
    tourPackage.booking_reference ? `Номер тура: ${escapeTelegramHtml(tourPackage.booking_reference)}` : "",
    `Услуга: <b>${escapeTelegramHtml(component.service_title || "—")}</b>`,
    "Пожалуйста, приложите подтверждение, счёт или ваучер кнопкой ниже.",
  ].filter(Boolean).join("\n");
}

async function notifyAgencyProposalResponse(item) {
  try {
    const provider = await pool.query(`SELECT to_jsonb(p) AS profile FROM providers p WHERE id=$1 LIMIT 1`, [item.owner_provider_id]);
    const profile = provider.rows[0]?.profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return false;
    const responseLabels = {
      accepted: "✅ <b>Клиент принял предложение</b>",
      changes_requested: "✏️ <b>Клиент запросил изменения</b>",
      declined: "❌ <b>Клиент отклонил предложение</b>",
    };
    const declineReasonLabels = {
      budget: "бюджет", dates: "даты поездки", itinerary: "программа тура",
      accommodation: "размещение", competitor: "выбран другой вариант",
      plans_changed: "изменились планы", other: "другая причина",
    };
    const site = String(process.env.SITE_PUBLIC_URL || process.env.FRONTEND_URL || "https://travella.uz").replace(/\/+$/, "");
    const lines = [
      responseLabels[item.proposal_response] || "💬 <b>Клиент ответил на предложение</b>",
      `Тур: <b>${escapeTelegramHtml(item.title)}</b>`,
      item.client_name ? `Клиент: ${escapeTelegramHtml(item.client_name)}` : "",
      item.proposal_response_reason ? `Причина: ${declineReasonLabels[item.proposal_response_reason] || escapeTelegramHtml(item.proposal_response_reason)}` : "",
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
    proposal_response_reason: row.proposal_response_reason || null,
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
      manager_name TEXT,
      share_token_hash VARCHAR(64),
      shared_at TIMESTAMPTZ,
      share_expires_at TIMESTAMPTZ,
      proposal_response VARCHAR(32),
      proposal_response_reason VARCHAR(32),
      proposal_response_message TEXT,
      proposal_responded_at TIMESTAMPTZ,
      last_client_followup_at TIMESTAMPTZ,
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
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS manager_name TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_response VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_response_reason VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_response_message TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS proposal_responded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS last_client_followup_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(32)`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid'`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS payment_note TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS accepted_revision INTEGER`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_status VARCHAR(16) NOT NULL DEFAULT 'not_required'`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_due_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_due_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_note TEXT`);
  await pool.query(`ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`);
  await pool.query(`UPDATE tour_packages SET status='accepted',updated_at=NOW() WHERE status='proposed' AND proposal_response='accepted'`);
  await pool.query(`UPDATE tour_packages SET status='lost',updated_at=NOW() WHERE status='proposed' AND proposal_response='declined'`);
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
    CREATE TABLE IF NOT EXISTS tour_package_proposal_responses (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      response VARCHAR(32) NOT NULL,
      reason VARCHAR(32),
      message TEXT,
      responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(package_id, revision)
    )
  `);
  await pool.query(`ALTER TABLE tour_package_proposal_responses ADD COLUMN IF NOT EXISTS reason VARCHAR(32)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_proposal_responses_package ON tour_package_proposal_responses(package_id, revision DESC)`);
  await pool.query(`
    INSERT INTO tour_package_proposal_responses(package_id,revision,response,reason,message,responded_at)
    SELECT id,current_revision,proposal_response,proposal_response_reason,proposal_response_message,COALESCE(proposal_responded_at,NOW())
      FROM tour_packages
     WHERE proposal_response IS NOT NULL AND current_revision > 0
    ON CONFLICT(package_id,revision) DO NOTHING
  `);
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
    CREATE TABLE IF NOT EXISTS tour_package_refund_events (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      refund_status VARCHAR(16) NOT NULL,
      refund_due_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      refunded_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      refund_due_at TIMESTAMPTZ,
      refund_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_refund_events_package ON tour_package_refund_events(package_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_client_contacts (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      channel VARCHAR(16) NOT NULL,
      note TEXT,
      contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_client_contacts_package ON tour_package_client_contacts(package_id, contacted_at DESC)`);
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
      service_order_last_reminded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(package_id, booking_id)
    )
  `);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_paid BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_status VARCHAR(16)`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_responded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS service_order_last_reminded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS quality_rating SMALLINT CHECK (quality_rating BETWEEN 1 AND 5)`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS reliability_rating SMALLINT CHECK (reliability_rating BETWEEN 1 AND 5)`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS performance_note TEXT`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS actual_supplier_cost NUMERIC(18,2)`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS cost_variance_note TEXT`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refund_status VARCHAR(16) NOT NULL DEFAULT 'not_required'`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refund_due_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refunded_amount NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refund_due_at DATE`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refund_note TEXT`);
  await pool.query(`ALTER TABLE tour_package_component_ops ADD COLUMN IF NOT EXISTS supplier_refunded_at TIMESTAMPTZ`);
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
  await pool.query(`ALTER TABLE tour_package_component_events ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_component_events_unread ON tour_package_component_events(package_id, created_at DESC) WHERE event_type='message_received' AND read_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_component_events_supplier_unread ON tour_package_component_events(package_id, created_at DESC) WHERE event_type IN ('message_received','attachment_received') AND read_at IS NULL`);
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_incidents (
      id BIGSERIAL PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
      booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity VARCHAR(16) NOT NULL DEFAULT 'medium',
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      resolution TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_package_incidents_package ON tour_package_incidents(package_id, status, created_at DESC)`);
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
            ops.service_order_last_reminded_at,
            ops.quality_rating,ops.reliability_rating,ops.performance_note,
            ops.actual_supplier_cost,ops.cost_variance_note,
            ops.supplier_refund_status,ops.supplier_refund_due_amount,ops.supplier_refunded_amount,
            ops.supplier_refund_due_at,ops.supplier_refund_note,ops.supplier_refunded_at,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id',event.id,'event_type',event.event_type,'actor_type',event.actor_type,
                'created_at',event.created_at,'metadata',event.metadata,'read_at',event.read_at
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

async function syncSupplierOrderFollowUpTasks(ownerId, packageId = null) {
  const values = [ownerId];
  const packageFilter = packageId ? "AND tp.id=$2::uuid" : "";
  if (packageId) values.push(packageId);
  await pool.query(
    `INSERT INTO tour_package_tasks(package_id,title,task_type,booking_id,due_at,priority)
     SELECT tp.id,
            'Follow up supplier: ' || COALESCE(NULLIF(TRIM(service.title),''),'#' || booking.id::text),
            'follow_up_supplier_order',booking.id,CURRENT_DATE,'high'
       FROM tour_packages tp
       JOIN bookings booking ON booking.group_id=tp.id
       JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=booking.id
       LEFT JOIN services service ON service.id=booking.service_id
      WHERE tp.owner_provider_id=$1 ${packageFilter}
        AND tp.status IN ('booked','paid')
        AND ops.service_order_status='sent'
        AND ops.service_order_sent_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM tour_package_tasks existing
           WHERE existing.package_id=tp.id
             AND existing.booking_id=booking.id
             AND existing.task_type='follow_up_supplier_order'
             AND existing.created_at >= ops.service_order_sent_at
        )
     ON CONFLICT (package_id,booking_id,task_type) WHERE completed=FALSE AND task_type IS NOT NULL
     DO NOTHING`,
    values
  );
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
         package_id,booking_id,confirmation_reference,supplier_payment_due_at,supplier_paid,operational_note,
         quality_rating,reliability_rating,performance_note,actual_supplier_cost,cost_variance_note
       ) VALUES($1::uuid,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(package_id,booking_id) DO UPDATE SET
         confirmation_reference=EXCLUDED.confirmation_reference,
         supplier_payment_due_at=EXCLUDED.supplier_payment_due_at,
         supplier_paid=EXCLUDED.supplier_paid,
         operational_note=EXCLUDED.operational_note,
         quality_rating=EXCLUDED.quality_rating,
         reliability_rating=EXCLUDED.reliability_rating,
         performance_note=EXCLUDED.performance_note,
         actual_supplier_cost=EXCLUDED.actual_supplier_cost,
         cost_variance_note=EXCLUDED.cost_variance_note,
         updated_at=NOW()
       RETURNING booking_id,confirmation_reference,supplier_payment_due_at,supplier_paid,operational_note,
                 quality_rating,reliability_rating,performance_note,actual_supplier_cost,cost_variance_note,updated_at`,
      [packageId, bookingId, value.confirmationReference, value.supplierPaymentDueAt, value.supplierPaid, value.operationalNote, value.qualityRating, value.reliabilityRating, value.performanceNote, value.actualSupplierCost, value.costVarianceNote]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageComponentOperations error:", error);
    return res.status(500).json({ message: "Failed to update component operations" });
  }
}

async function updateTourPackageSupplierRefund(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const current = await pool.query(
      `SELECT tp.status,b.provider_price,COALESCE(ops.actual_supplier_cost,b.provider_price,0) AS supplier_cost,
              COALESCE(ops.supplier_paid,FALSE) AS supplier_paid
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [req.params.id, ownerId, bookingId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    if (String(current.rows[0].status) !== "cancelled") return res.status(409).json({ message: "Supplier refunds can only be recorded for cancelled tours" });
    if (!current.rows[0].supplier_paid) return res.status(409).json({ message: "Supplier payment must be recorded before a refund" });
    const refund = normalizeSupplierRefund(req.body, current.rows[0].supplier_cost);
    const result = await pool.query(
      `UPDATE tour_package_component_ops SET supplier_refund_status=$3,supplier_refund_due_amount=$4,
         supplier_refunded_amount=$5,supplier_refund_due_at=$6::date,supplier_refund_note=$7,
         supplier_refunded_at=CASE WHEN $3='refunded' THEN COALESCE(supplier_refunded_at,NOW()) ELSE NULL END,updated_at=NOW()
        WHERE package_id=$1::uuid AND booking_id=$2
        RETURNING booking_id,supplier_refund_status,supplier_refund_due_amount,supplier_refunded_amount,
          supplier_refund_due_at,supplier_refund_note,supplier_refunded_at,updated_at`,
      [req.params.id, bookingId, refund.status, refund.dueAmount, refund.receivedAmount, refund.dueAt, refund.note]
    );
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,metadata)
       VALUES($1::uuid,$2,'supplier_refund_updated','dmc',jsonb_build_object(
         'status',$3::text,'due_amount',$4::numeric,'received_amount',$5::numeric,'due_at',$6::text,'note',$7::text))
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [req.params.id, bookingId, refund.status, refund.dueAmount, refund.receivedAmount, refund.dueAt, refund.note]
    );
    return res.json({ ...result.rows[0], service_order_event: event.rows[0] });
  } catch (error) {
    console.error("updateTourPackageSupplierRefund error:", error);
    return res.status(500).json({ message: "Failed to update supplier refund" });
  }
}

async function markTourPackageComponentMessagesRead(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const result = await pool.query(
      `UPDATE tour_package_component_events event SET read_at=NOW()
        FROM tour_packages tp,bookings booking
       WHERE event.package_id=$1::uuid AND event.booking_id=$2
         AND event.event_type IN ('message_received','attachment_received') AND event.read_at IS NULL
         AND tp.id=event.package_id AND tp.owner_provider_id=$3
         AND booking.id=event.booking_id AND booking.group_id=tp.id
       RETURNING event.id,event.read_at`,
      [req.params.id, bookingId, ownerId]
    );
    return res.json({ read: result.rowCount, read_at: result.rows[0]?.read_at || null });
  } catch (error) {
    console.error("markTourPackageComponentMessagesRead error:", error);
    return res.status(500).json({ message: "Failed to mark supplier messages as read" });
  }
}

async function downloadTourPackageComponentAttachment(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const bookingId = Number(req.params.bookingId);
    const eventId = Number(req.params.eventId);
    if (![bookingId, eventId].every((value) => Number.isInteger(value) && value > 0)) {
      return res.status(400).json({ message: "Valid booking and event IDs are required" });
    }
    const found = await pool.query(
      `SELECT event.metadata
         FROM tour_package_component_events event
         JOIN tour_packages tp ON tp.id=event.package_id
         JOIN bookings booking ON booking.id=event.booking_id AND booking.group_id=tp.id
        WHERE event.id=$1 AND event.package_id=$2::uuid AND event.booking_id=$3
          AND event.event_type='attachment_received' AND tp.owner_provider_id=$4
        LIMIT 1`,
      [eventId, req.params.id, bookingId, ownerId]
    );
    if (!found.rowCount) return res.status(404).json({ message: "Attachment not found" });
    const metadata = found.rows[0].metadata || {};
    const fileId = String(metadata.file_id || "").trim();
    const token = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!fileId || !token) return res.status(503).json({ message: "Attachment storage is unavailable" });
    const fileInfo = await axios.get(`https://api.telegram.org/bot${token}/getFile`, {
      params: { file_id: fileId }, timeout: 15000,
    });
    const filePath = String(fileInfo.data?.result?.file_path || "");
    if (!filePath) return res.status(502).json({ message: "Telegram did not return the attachment" });
    const file = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      responseType: "stream", timeout: 30000, maxContentLength: 20 * 1024 * 1024,
    });
    const fileName = String(metadata.file_name || "attachment").replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment";
    res.set("Content-Type", String(metadata.mime_type || file.headers["content-type"] || "application/octet-stream"));
    res.set("Content-Disposition", `inline; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.set("Cache-Control", "private, no-store");
    file.data.on("error", (error) => {
      console.error("attachment stream error:", error?.message || error);
      if (!res.headersSent) res.status(502).end(); else res.destroy(error);
    });
    return file.data.pipe(res);
  } catch (error) {
    console.error("downloadTourPackageComponentAttachment error:", error?.response?.data || error?.message || error);
    if (!res.headersSent) return res.status(502).json({ message: "Failed to download attachment" });
    return res.end();
  }
}

async function updateTourPackageComponentAttachment(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const bookingId = Number(req.params.bookingId);
    const eventId = Number(req.params.eventId);
    const documentType = String(req.body?.document_type || "").trim();
    if (![bookingId, eventId].every((value) => Number.isInteger(value) && value > 0) || !["confirmation", "invoice", "voucher", "other"].includes(documentType)) {
      return res.status(400).json({ message: "Valid attachment type is required" });
    }
    const result = await pool.query(
      `UPDATE tour_package_component_events event
          SET metadata=jsonb_set(COALESCE(event.metadata,'{}'::jsonb),'{document_type}',to_jsonb($1::text),TRUE)
         FROM tour_packages tp,bookings booking
        WHERE event.id=$2 AND event.package_id=$3::uuid AND event.booking_id=$4
          AND event.event_type='attachment_received' AND tp.id=event.package_id
          AND tp.owner_provider_id=$5 AND booking.id=event.booking_id AND booking.group_id=tp.id
        RETURNING event.id,event.metadata`,
      [documentType, eventId, req.params.id, bookingId, ownerId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Attachment not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageComponentAttachment error:", error);
    return res.status(500).json({ message: "Failed to update attachment" });
  }
}

async function reviewTourPackageComponentAttachment(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const bookingId = Number(req.params.bookingId);
    const eventId = Number(req.params.eventId);
    const reviewStatus = String(req.body?.review_status || "").trim();
    if (![bookingId, eventId].every((value) => Number.isInteger(value) && value > 0) || !["approved", "rejected"].includes(reviewStatus)) return res.status(400).json({ message: "Valid review status is required" });
    const found = await pool.query(
      `SELECT event.metadata,tp.id AS package_id,tp.title,tp.booking_reference,s.title AS service_title,to_jsonb(supplier) AS supplier_profile
         FROM tour_package_component_events event
         JOIN tour_packages tp ON tp.id=event.package_id
         JOIN bookings booking ON booking.id=event.booking_id AND booking.group_id=tp.id
         LEFT JOIN services s ON s.id=booking.service_id
         LEFT JOIN providers supplier ON supplier.id=booking.provider_id
        WHERE event.id=$1 AND event.package_id=$2::uuid AND event.booking_id=$3
          AND event.event_type='attachment_received' AND tp.owner_provider_id=$4 LIMIT 1`,
      [eventId, req.params.id, bookingId, ownerId]
    );
    if (!found.rowCount) return res.status(404).json({ message: "Attachment not found" });
    const item = found.rows[0];
    const updated = await pool.query(
      `UPDATE tour_package_component_events SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{review_status}',to_jsonb($1::text),TRUE)
        WHERE id=$2 RETURNING id,metadata`,
      [reviewStatus, eventId]
    );
    if (reviewStatus === "approved") {
      await pool.query(`UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW() WHERE package_id=$1::uuid AND booking_id=$2 AND task_type='follow_up_supplier_documents' AND completed=FALSE`, [item.package_id, bookingId]);
    } else {
      await pool.query(
        `INSERT INTO tour_package_tasks(package_id,title,task_type,booking_id,due_at,priority)
         VALUES($1::uuid,$2,'follow_up_supplier_documents',$3,CURRENT_DATE + 1,'high')
         ON CONFLICT (package_id,booking_id,task_type) WHERE completed=FALSE AND task_type IS NOT NULL
         DO UPDATE SET due_at=EXCLUDED.due_at,priority='high',updated_at=NOW()`,
        [item.package_id, `Replace supplier document: ${item.service_title || `#${bookingId}`}`, bookingId]
      );
      const profile = item.supplier_profile || {};
      const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
      if (chatId) await tgSend(chatId, buildSupplierDocumentRequestMessage({ tourPackage: item, component: item }), { reply_markup: { inline_keyboard: [[{ text: "📎 Отправить замену DMC", callback_data: `tour_order_reply:${bookingId}` }]] } });
    }
    const audit = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,metadata)
       VALUES($1::uuid,$2,$3,'dmc',jsonb_build_object('attachment_event_id',$4::bigint))
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [item.package_id, bookingId, reviewStatus === "approved" ? "attachment_approved" : "attachment_rejected", eventId]
    );
    return res.json({ ...updated.rows[0], review_event: audit.rows[0] });
  } catch (error) {
    console.error("reviewTourPackageComponentAttachment error:", error);
    return res.status(500).json({ message: "Failed to review attachment" });
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
    await syncSupplierOrderFollowUpTasks(ownerId);
    const result = await pool.query(
      `SELECT tp.*,
              COUNT(b.id)::int AS component_count,
              COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','paid','completed'))::int AS confirmed_count,
              COUNT(b.id) FILTER (WHERE NULLIF(TRIM(ops.confirmation_reference),'') IS NOT NULL)::int AS confirmation_count,
              COUNT(b.id) FILTER (WHERE COALESCE(ops.supplier_paid,FALSE)=TRUE)::int AS supplier_paid_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='accepted')::int AS supplier_order_accepted_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='sent')::int AS supplier_order_pending_count,
              COUNT(b.id) FILTER (WHERE ops.service_order_status='declined')::int AS supplier_order_declined_count,
              COUNT(b.id) FILTER (WHERE ops.quality_rating IS NOT NULL AND ops.reliability_rating IS NOT NULL)::int AS supplier_reviewed_count,
              COUNT(b.id) FILTER (WHERE ops.actual_supplier_cost IS NOT NULL)::int AS actual_cost_count,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)),0) AS actual_cost_total,
              COUNT(b.id) FILTER (
                WHERE ops.supplier_refund_status IN ('pending','partial')
              )::int AS supplier_refund_pending_count,
              COUNT(b.id) FILTER (
                WHERE ops.supplier_refund_status IN ('pending','partial')
                  AND ops.supplier_refund_due_at < CURRENT_DATE
              )::int AS supplier_refund_overdue_count,
              COALESCE(SUM(GREATEST(
                COALESCE(ops.supplier_refund_due_amount,0) - COALESCE(ops.supplier_refunded_amount,0),0
              )) FILTER (
                WHERE ops.supplier_refund_status IN ('pending','partial')
              ),0) AS supplier_refund_outstanding_total,
              COALESCE(SUM(COALESCE(ops.supplier_refunded_amount,0)),0) AS supplier_refunded_total,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=TRUE
              ),0) AS supplier_paid_total,
              COALESCE(SUM(COALESCE(ops.supplier_refund_due_amount,0)),0) AS supplier_refund_due_total,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
              ),0) AS supplier_payable_total,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
                  AND ops.supplier_payment_due_at < CURRENT_DATE
              ),0) AS supplier_overdue_total,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
                  AND ops.supplier_payment_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
              ),0) AS supplier_due_7d_total,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
                  AND ops.supplier_payment_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
              ),0) AS supplier_due_30d_total,
              COUNT(b.id) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
                  AND ops.supplier_payment_due_at IS NULL
              )::int AS supplier_missing_due_count,
              COALESCE(SUM(COALESCE(ops.actual_supplier_cost,b.provider_price,0)) FILTER (
                WHERE COALESCE(ops.supplier_paid,FALSE)=FALSE
                  AND ops.supplier_payment_due_at IS NULL
              ),0) AS supplier_missing_due_total,
              COUNT(b.id) FILTER (
                WHERE tp.status IN ('booked','paid') AND (
                  ops.service_order_status IS NULL OR
                  ops.service_order_status IN ('declined','failed','cancelled') OR
                  (ops.service_order_status='sent' AND ops.service_order_sent_at < NOW() - INTERVAL '24 hours')
                )
              )::int AS supplier_order_attention_count,
              (SELECT COUNT(*)::int FROM tour_package_travelers tr WHERE tr.package_id=tp.id) AS traveler_count,
              (SELECT COUNT(*)::int FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE) AS open_task_count,
              (SELECT COUNT(*)::int FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE AND task.due_at < CURRENT_DATE) AS overdue_task_count,
              (SELECT COUNT(*)::int FROM tour_package_incidents incident WHERE incident.package_id=tp.id AND incident.status<>'resolved') AS open_incident_count,
              (SELECT COUNT(*)::int FROM tour_package_proposal_responses response
                WHERE response.package_id=tp.id) AS proposal_response_count,
              (SELECT COALESCE(jsonb_object_agg(reasons.reason,reasons.total),'{}'::jsonb) FROM (
                SELECT response.reason,COUNT(*)::int AS total
                  FROM tour_package_proposal_responses response
                 WHERE response.package_id=tp.id AND response.response='declined' AND response.reason IS NOT NULL
                 GROUP BY response.reason
              ) reasons) AS proposal_decline_reasons,
              (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (response.responded_at-revision.created_at))),0)::float
                 FROM tour_package_proposal_responses response
                 JOIN tour_package_revisions revision
                   ON revision.package_id=response.package_id AND revision.version=response.revision
                WHERE response.package_id=tp.id AND response.responded_at >= revision.created_at) AS proposal_avg_response_seconds,
              (SELECT MIN(task.due_at) FROM tour_package_tasks task WHERE task.package_id=tp.id AND task.completed=FALSE) AS next_task_due_at,
              (SELECT COUNT(*)::int FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.event_type IN ('message_received','attachment_received') AND event.read_at IS NULL) AS unread_supplier_reply_count,
              (SELECT event.booking_id FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.event_type IN ('message_received','attachment_received') AND event.read_at IS NULL
                ORDER BY event.created_at DESC,event.id DESC LIMIT 1) AS latest_supplier_reply_booking_id,
              (SELECT COUNT(*)::int FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.event_type='attachment_received') AS supplier_document_count,
              (SELECT COUNT(DISTINCT event.booking_id)::int FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.event_type='attachment_received'
                  AND event.metadata->>'review_status'='approved') AS supplier_document_approved_count,
              (SELECT COUNT(*)::int FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.event_type='attachment_received'
                  AND COALESCE(event.metadata->>'review_status','pending')='pending') AS supplier_document_review_count,
              COUNT(b.id) FILTER (
                WHERE tp.status IN ('booked','paid') AND ops.service_order_status='accepted'
                  AND NOT EXISTS (SELECT 1 FROM tour_package_component_events event
                    WHERE event.package_id=tp.id AND event.booking_id=b.id AND event.event_type='attachment_received'
                      AND COALESCE(event.metadata->>'review_status','pending') IN ('approved','pending'))
              )::int AS missing_supplier_document_count,
              (SELECT COUNT(*)::int FROM (
                SELECT DISTINCT ON (event.booking_id) event.booking_id,event.event_type,event.created_at
                  FROM tour_package_component_events event
                 WHERE event.package_id=tp.id AND event.event_type IN ('message_received','attachment_received','message_sent')
                 ORDER BY event.booking_id,event.created_at DESC,event.id DESC
              ) dialogue WHERE dialogue.event_type IN ('message_received','attachment_received')) AS supplier_reply_pending_count,
              (SELECT dialogue.booking_id FROM (
                SELECT DISTINCT ON (event.booking_id) event.booking_id,event.event_type,event.created_at,event.id
                  FROM tour_package_component_events event
                 WHERE event.package_id=tp.id AND event.event_type IN ('message_received','attachment_received','message_sent')
                 ORDER BY event.booking_id,event.created_at DESC,event.id DESC
              ) dialogue WHERE dialogue.event_type IN ('message_received','attachment_received')
                ORDER BY dialogue.created_at DESC,dialogue.id DESC LIMIT 1) AS latest_supplier_reply_pending_booking_id,
              (SELECT COUNT(*)::int FROM (
                SELECT DISTINCT ON (event.booking_id) event.booking_id,event.event_type,event.created_at
                  FROM tour_package_component_events event
                 WHERE event.package_id=tp.id AND event.event_type IN ('message_received','attachment_received','message_sent')
                 ORDER BY event.booking_id,event.created_at DESC,event.id DESC
              ) dialogue WHERE dialogue.event_type IN ('message_received','attachment_received') AND dialogue.created_at < NOW() - INTERVAL '24 hours') AS supplier_reply_overdue_count,
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
        proposalResponse: item.proposal_response,
        sharedAt: item.shared_at,
        lastClientFollowupAt: item.last_client_followup_at,
        quoteValidUntil: item.quote_valid_until,
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
          approvedDocumentCount: item.supplier_document_approved_count,
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

async function listSupplierPerformance(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const result = await pool.query(
      `SELECT b.provider_id,
              ROUND(AVG(ops.quality_rating)::numeric,2)::float AS quality_rating,
              ROUND(AVG(ops.reliability_rating)::numeric,2)::float AS reliability_rating,
              COUNT(*) FILTER (WHERE ops.quality_rating IS NOT NULL AND ops.reliability_rating IS NOT NULL)::int AS review_count
         FROM tour_package_component_ops ops
         JOIN tour_packages tp ON tp.id=ops.package_id AND tp.owner_provider_id=$1
         JOIN bookings b ON b.id=ops.booking_id
        WHERE ops.quality_rating IS NOT NULL OR ops.reliability_rating IS NOT NULL
        GROUP BY b.provider_id`,
      [ownerId]
    );
    return res.json({ items: result.rows });
  } catch (error) {
    console.error("listSupplierPerformance error:", error);
    return res.status(500).json({ message: "Failed to load supplier performance" });
  }
}

async function getTourPackage(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    await syncSupplierOrderFollowUpTasks(ownerId, req.params.id);
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
      `SELECT rev.version,rev.created_at,
              rev.snapshot->>'title' AS title,
              rev.snapshot->>'gross_total' AS gross_total,
              rev.snapshot->>'currency' AS currency,
              response.response,response.reason AS response_reason,response.message AS response_message,response.responded_at
         FROM tour_package_revisions rev
         LEFT JOIN tour_package_proposal_responses response
           ON response.package_id=rev.package_id AND response.revision=rev.version
        WHERE rev.package_id=$1::uuid ORDER BY rev.version DESC`,
      [req.params.id]
    );
    const paymentEvents = await pool.query(
      `SELECT id,payment_status,paid_amount,payment_due_at,payment_note,created_at
         FROM tour_package_payment_events WHERE package_id=$1::uuid ORDER BY created_at DESC,id DESC`,
      [req.params.id]
    );
    const refundEvents = await pool.query(
      `SELECT id,refund_status,refund_due_amount,refunded_amount,refund_due_at,refund_note,created_at
         FROM tour_package_refund_events WHERE package_id=$1::uuid ORDER BY created_at DESC,id DESC`,
      [req.params.id]
    );
    const clientContacts = await pool.query(
      `SELECT id,channel,note,contacted_at FROM tour_package_client_contacts
        WHERE package_id=$1::uuid ORDER BY contacted_at DESC,id DESC LIMIT 50`,
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
    const incidents = await pool.query(
      `SELECT incident.id,incident.booking_id,incident.title,incident.description,incident.severity,
              incident.status,incident.assigned_to,incident.resolution,incident.resolved_at,
              incident.created_at,incident.updated_at,service.title AS service_title
         FROM tour_package_incidents incident
         LEFT JOIN bookings booking ON booking.id=incident.booking_id
         LEFT JOIN services service ON service.id=booking.service_id
        WHERE incident.package_id=$1::uuid
        ORDER BY CASE incident.status WHEN 'open' THEN 0 WHEN 'monitoring' THEN 1 ELSE 2 END,
                 CASE incident.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 incident.created_at DESC`,
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
      refund_events: refundEvents.rows,
      client_contacts: clientContacts.rows,
      travelers: travelers.rows,
      tasks: tasks.rows,
      incidents: incidents.rows,
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
        approvedDocumentCount: bookings.filter((row) => (row.service_order_events || []).some((event) => event.event_type === "attachment_received" && event.metadata?.review_status === "approved")).length,
      }),
      operations_timeline: packageOperationsTimeline({
        status: derivePackageStatus(bookings, item.status),
        paymentStatus: item.payment_status,
        paymentDueAt: item.payment_due_at,
        startDate: item.start_date,
        proposalResponse: item.proposal_response,
        sharedAt: item.shared_at,
        lastClientFollowupAt: item.last_client_followup_at,
        quoteValidUntil: item.quote_valid_until,
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

async function updateTourPackageManager(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const managerName = String(req.body?.manager_name || "").trim().slice(0, 120) || null;
    const result = await pool.query(
      `UPDATE tour_packages SET manager_name=$3,updated_at=NOW()
        WHERE id=$1::uuid AND owner_provider_id=$2
        RETURNING id,manager_name,updated_at`,
      [req.params.id, ownerId, managerName]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageManager error:", error);
    return res.status(500).json({ message: "Failed to assign tour manager" });
  }
}

async function recordTourPackageClientFollowup(req, res) {
  const client = await pool.connect();
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const followup = normalizeClientFollowup(req.body);
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tour_packages SET last_client_followup_at=NOW(),updated_at=NOW()
        WHERE id=$1::uuid AND owner_provider_id=$2 AND status='proposed' AND proposal_response IS NULL
        RETURNING id,last_client_followup_at,updated_at`,
      [req.params.id, ownerId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Tour proposal is not awaiting a client response" });
    }
    const contact = await client.query(
      `INSERT INTO tour_package_client_contacts(package_id,channel,note,contacted_at)
       VALUES($1::uuid,$2,$3,$4) RETURNING id,channel,note,contacted_at`,
      [req.params.id, followup.channel, followup.note, result.rows[0].last_client_followup_at]
    );
    await client.query("COMMIT");
    return res.json({ ...result.rows[0], contact: contact.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("recordTourPackageClientFollowup error:", error);
    return res.status(500).json({ message: "Failed to record client follow-up" });
  } finally { client.release(); }
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
         proposal_response_reason=CASE WHEN status IN ('booked','paid') THEN proposal_response_reason ELSE NULL END,
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
  const client = await pool.connect();
  try {
    const token = String(req.params.token || "");
    const response = String(req.body?.response || "").trim().toLowerCase();
    const reason = normalizeProposalResponseReason(req.body?.reason);
    const message = String(req.body?.message || "").trim().slice(0, 2000) || null;
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return res.status(404).json({ message: "Proposal not found" });
    if (!isValidProposalResponse(response)) {
      return res.status(400).json({ message: "Valid proposal response is required" });
    }
    if (response === "declined" && !reason) {
      return res.status(400).json({ message: "Valid decline reason is required" });
    }
    await ensureTourPackagesTable();
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tour_packages SET proposal_response=$2,
         proposal_response_message=$3, proposal_response_reason=$4, proposal_responded_at=NOW(), updated_at=NOW()
         ,accepted_revision=CASE WHEN $2='accepted' THEN current_revision ELSE NULL END,
         status=CASE WHEN $2='accepted' THEN 'accepted' WHEN $2='declined' THEN 'lost' ELSE status END
       WHERE share_token_hash=$1 AND share_expires_at > NOW() AND proposal_response IS NULL
       RETURNING id,owner_provider_id,title,client_name,current_revision,proposal_response,proposal_response_reason,
         proposal_response_message,proposal_responded_at`,
      [hashShareToken(token), response, message, response === "declined" ? reason : null]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Proposal not found, expired or already answered" });
    }
    await client.query(
      `INSERT INTO tour_package_proposal_responses(package_id,revision,response,reason,message,responded_at)
       VALUES($1::uuid,$2,$3,$4,$5,$6)
       ON CONFLICT(package_id,revision) DO UPDATE SET
         response=EXCLUDED.response,reason=EXCLUDED.reason,message=EXCLUDED.message,responded_at=EXCLUDED.responded_at`,
      [result.rows[0].id, result.rows[0].current_revision, result.rows[0].proposal_response,
        result.rows[0].proposal_response_reason, result.rows[0].proposal_response_message, result.rows[0].proposal_responded_at]
    );
    await client.query("COMMIT");
    setImmediate(() => { notifyAgencyProposalResponse(result.rows[0]); });
    res.set("Cache-Control", "no-store");
    return res.json({
      proposal_response: result.rows[0].proposal_response,
      proposal_response_reason: result.rows[0].proposal_response_reason,
      proposal_response_message: result.rows[0].proposal_response_message,
      proposal_responded_at: result.rows[0].proposal_responded_at,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("respondToTourProposal error:", error);
    return res.status(500).json({ message: "Failed to save proposal response" });
  } finally { client.release(); }
}

function isValidProposalResponse(value) {
  return new Set(["accepted", "changes_requested", "declined"]).has(String(value || "").trim().toLowerCase());
}

function normalizeProposalResponseReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return new Set(["budget", "dates", "itinerary", "accommodation", "competitor", "plans_changed", "other"]).has(reason) ? reason : null;
}

function normalizeTourCancellationReason(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 1000);
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

async function cancelTourPackage(req, res) {
  let client;
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    const reason = normalizeTourCancellationReason(req.body?.reason);
    if (reason.length < 5) return res.status(400).json({ message: "Cancellation reason is required" });
    await ensureTourPackagesTable();
    client = await pool.connect();
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2 FOR UPDATE`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Tour package not found" }); }
    if (!new Set(["booked", "paid"]).has(String(current.rows[0].status || "").toLowerCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only booked tours can be cancelled" });
    }
    const activeOrders = await client.query(
      `SELECT b.id,s.title AS service_title,to_jsonb(supplier) AS supplier_profile,ops.service_order_status
         FROM bookings b
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         JOIN tour_package_component_ops ops ON ops.package_id=$1::uuid AND ops.booking_id=b.id
        WHERE b.group_id=$1::uuid AND ops.service_order_status IN ('sent','accepted')`,
      [req.params.id]
    );
    await client.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,metadata)
       SELECT package_id,booking_id,'cancelled','dmc',jsonb_build_object('previous_status',service_order_status,'package_cancelled',true)
         FROM tour_package_component_ops
        WHERE package_id=$1::uuid AND service_order_status IN ('sent','accepted')`,
      [req.params.id]
    );
    await client.query(
      `UPDATE tour_package_component_ops SET service_order_status='cancelled',service_order_responded_at=NOW(),updated_at=NOW()
        WHERE package_id=$1::uuid AND service_order_status IN ('sent','accepted')`,
      [req.params.id]
    );
    await client.query(
      `UPDATE tour_package_component_ops ops SET
         supplier_refund_status='pending',
         supplier_refund_due_amount=COALESCE(ops.actual_supplier_cost,booking.provider_price,0),
         supplier_refunded_amount=0,supplier_refund_due_at=NULL,supplier_refund_note=NULL,supplier_refunded_at=NULL,updated_at=NOW()
        FROM bookings booking
       WHERE ops.package_id=$1::uuid AND booking.id=ops.booking_id AND COALESCE(ops.supplier_paid,FALSE)=TRUE`,
      [req.params.id]
    );
    await client.query(
      `UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW()
        WHERE package_id=$1::uuid AND completed=FALSE`,
      [req.params.id]
    );
    const saved = await client.query(
      `UPDATE tour_packages SET status='cancelled',cancellation_reason=$3,cancelled_at=NOW(),
         refund_due_amount=paid_amount,refunded_amount=0,
         refund_status=CASE WHEN paid_amount > 0 THEN 'pending' ELSE 'not_required' END,
         refund_due_at=NULL,refund_note=NULL,refunded_at=NULL,updated_at=NOW()
        WHERE id=$1::uuid AND owner_provider_id=$2
        RETURNING id,status,booking_reference,cancellation_reason,cancelled_at,refund_status,
          refund_due_amount,refunded_amount,refund_due_at,refund_note,refunded_at,updated_at`,
      [req.params.id, ownerId, reason]
    );
    await client.query("COMMIT");
    const notificationResults = await Promise.all(activeOrders.rows.map(async (item) => {
      const profile = item.supplier_profile || {};
      const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
      if (!chatId) return false;
      return Boolean(await tgSend(chatId, buildSupplierServiceOrderCancellationMessage({ tourPackage: current.rows[0], component: item })).catch(() => false));
    }));
    return res.json({
      ...saved.rows[0],
      cancelled_supplier_order_count: activeOrders.rowCount,
      supplier_notifications_failed: notificationResults.filter((sent) => !sent).length,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("cancelTourPackage error:", error);
    return res.status(500).json({ message: "Failed to cancel tour package" });
  } finally { if (client) client.release(); }
}

async function updateTourPackageRefund(req, res) {
  let client;
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const current = await pool.query(
      `SELECT status,paid_amount FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`,
      [req.params.id, ownerId]
    );
    if (!current.rowCount) return res.status(404).json({ message: "Tour package not found" });
    if (String(current.rows[0].status) !== "cancelled") return res.status(409).json({ message: "Refunds can only be recorded for cancelled tours" });
    const refund = normalizePackageRefund(req.body, current.rows[0].paid_amount);
    client = await pool.connect();
    await client.query("BEGIN");
    const saved = await client.query(
      `UPDATE tour_packages SET refund_status=$3,refund_due_amount=$4,refunded_amount=$5,
         refund_due_at=$6,refund_note=$7,refunded_at=CASE WHEN $3='refunded' THEN COALESCE(refunded_at,NOW()) ELSE NULL END,updated_at=NOW()
        WHERE id=$1::uuid AND owner_provider_id=$2
        RETURNING refund_status,refund_due_amount,refunded_amount,refund_due_at,refund_note,refunded_at,updated_at`,
      [req.params.id, ownerId, refund.refundStatus, refund.refundDueAmount, refund.refundedAmount, refund.refundDueAt, refund.refundNote]
    );
    const event = await client.query(
      `INSERT INTO tour_package_refund_events(package_id,refund_status,refund_due_amount,refunded_amount,refund_due_at,refund_note)
       VALUES($1::uuid,$2,$3,$4,$5,$6)
       RETURNING id,refund_status,refund_due_amount,refunded_amount,refund_due_at,refund_note,created_at`,
      [req.params.id, refund.refundStatus, refund.refundDueAmount, refund.refundedAmount, refund.refundDueAt, refund.refundNote]
    );
    await client.query("COMMIT");
    return res.json({ ...saved.rows[0], refund_event: event.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("updateTourPackageRefund error:", error);
    return res.status(500).json({ message: "Failed to update client refund" });
  } finally { if (client) client.release(); }
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
    ], [{ text: "💬 Ответить DMC", callback_data: `tour_order_reply:${bookingId}` }]] };
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
    const closedTasks = await pool.query(
      `UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW()
       WHERE package_id=$1::uuid AND booking_id=$2
         AND task_type='follow_up_supplier_order' AND completed=FALSE
       RETURNING id`,
      [packageId, bookingId]
    );
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type)
       VALUES($1::uuid,$2,'sent','dmc')
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId]
    );
    return res.json({ sent: true, ...saved.rows[0], service_order_event: event.rows[0], closed_task_ids: closedTasks.rows.map((task) => task.id) });
  } catch (error) {
    console.error("sendTourPackageServiceOrder error:", error);
    return res.status(500).json({ message: "Failed to send supplier order" });
  }
}

async function remindTourPackageServiceOrder(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const result = await pool.query(
      `SELECT tp.title,tp.booking_reference,b.id,s.title AS service_title,
              to_jsonb(supplier) AS supplier_profile,ops.service_order_status,
              ops.service_order_last_reminded_at
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    const item = result.rows[0];
    if (item.service_order_status !== "sent") return res.status(409).json({ message: "Supplier order is not awaiting a response" });
    const remindedAt = item.service_order_last_reminded_at ? new Date(item.service_order_last_reminded_at).getTime() : 0;
    const cooldownMs = 60 * 60 * 1000;
    if (remindedAt && Date.now() - remindedAt < cooldownMs) {
      return res.status(429).json({ message: "Supplier reminder is available once per hour", retry_after_seconds: Math.ceil((cooldownMs - (Date.now() - remindedAt)) / 1000) });
    }
    const profile = item.supplier_profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return res.status(409).json({ message: "Supplier Telegram is not connected" });
    const keyboard = { inline_keyboard: [[
      { text: "✅ Принять заказ", callback_data: `tour_order:${bookingId}:accepted` },
      { text: "❌ Отклонить", callback_data: `tour_order:${bookingId}:declined` },
    ], [{ text: "💬 Ответить DMC", callback_data: `tour_order_reply:${bookingId}` }]] };
    const message = buildSupplierServiceOrderReminderMessage({ tourPackage: item, component: item });
    if (!(await tgSend(chatId, message, { reply_markup: keyboard }))) return res.status(502).json({ message: "Failed to send supplier reminder" });
    const saved = await pool.query(
      `UPDATE tour_package_component_ops SET service_order_last_reminded_at=NOW(),updated_at=NOW()
       WHERE package_id=$1::uuid AND booking_id=$2
       RETURNING service_order_last_reminded_at`,
      [packageId, bookingId]
    );
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type)
       VALUES($1::uuid,$2,'reminder_sent','dmc')
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId]
    );
    return res.json({ reminded: true, ...saved.rows[0], service_order_event: event.rows[0] });
  } catch (error) {
    console.error("remindTourPackageServiceOrder error:", error);
    return res.status(500).json({ message: "Failed to send supplier reminder" });
  }
}

async function requestTourPackageSupplierDocuments(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const result = await pool.query(
      `SELECT tp.title,tp.booking_reference,b.id,s.title AS service_title,
              to_jsonb(supplier) AS supplier_profile,ops.service_order_status,
              (SELECT MAX(event.created_at) FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.booking_id=b.id AND event.event_type='document_request_sent') AS last_document_request_at,
              EXISTS(SELECT 1 FROM tour_package_component_events event
                WHERE event.package_id=tp.id AND event.booking_id=b.id AND event.event_type='attachment_received'
                  AND event.metadata->>'review_status'='approved') AS has_document
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    const item = result.rows[0];
    if (item.service_order_status !== "accepted") return res.status(409).json({ message: "Supplier must accept the order before documents can be requested" });
    if (item.has_document) return res.status(409).json({ message: "Supplier document has already been received" });
    const lastRequestAt = item.last_document_request_at ? new Date(item.last_document_request_at).getTime() : 0;
    const cooldownMs = 60 * 60 * 1000;
    if (lastRequestAt && Date.now() - lastRequestAt < cooldownMs) return res.status(429).json({ message: "Document request is available once per hour", retry_after_seconds: Math.ceil((cooldownMs - (Date.now() - lastRequestAt)) / 1000) });
    const profile = item.supplier_profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return res.status(409).json({ message: "Supplier Telegram is not connected" });
    const keyboard = { inline_keyboard: [[{ text: "📎 Отправить документ DMC", callback_data: `tour_order_reply:${bookingId}` }]] };
    if (!(await tgSend(chatId, buildSupplierDocumentRequestMessage({ tourPackage: item, component: item }), { reply_markup: keyboard }))) return res.status(502).json({ message: "Failed to request supplier documents" });
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type)
       VALUES($1::uuid,$2,'document_request_sent','dmc')
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId]
    );
    const task = await pool.query(
      `INSERT INTO tour_package_tasks(package_id,title,task_type,booking_id,due_at,priority)
       VALUES($1::uuid,$2,'follow_up_supplier_documents',$3,CURRENT_DATE + 1,'high')
       ON CONFLICT (package_id,booking_id,task_type) WHERE completed=FALSE AND task_type IS NOT NULL
       DO UPDATE SET title=EXCLUDED.title,due_at=EXCLUDED.due_at,priority='high',updated_at=NOW()
       RETURNING id,title,task_type,booking_id,assigned_to,due_at,priority,completed,created_at,updated_at`,
      [packageId, `Follow up supplier documents: ${item.service_title || `#${bookingId}`}`, bookingId]
    );
    return res.json({ requested: true, service_order_event: event.rows[0], task: task.rows[0] });
  } catch (error) {
    console.error("requestTourPackageSupplierDocuments error:", error);
    return res.status(500).json({ message: "Failed to request supplier documents" });
  }
}

async function cancelTourPackageServiceOrder(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    const result = await pool.query(
      `SELECT tp.title,tp.booking_reference,b.id,s.title AS service_title,
              to_jsonb(supplier) AS supplier_profile,ops.service_order_status
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    const item = result.rows[0];
    if (!["sent", "accepted"].includes(item.service_order_status)) {
      return res.status(409).json({ message: "Supplier order cannot be cancelled in its current status" });
    }
    const profile = item.supplier_profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return res.status(409).json({ message: "Supplier Telegram is not connected" });
    const message = buildSupplierServiceOrderCancellationMessage({ tourPackage: item, component: item });
    if (!(await tgSend(chatId, message))) return res.status(502).json({ message: "Failed to notify supplier about cancellation" });
    const saved = await pool.query(
      `UPDATE tour_package_component_ops SET service_order_status='cancelled',service_order_responded_at=NOW(),updated_at=NOW()
       WHERE package_id=$1::uuid AND booking_id=$2
       RETURNING service_order_status,service_order_responded_at`,
      [packageId, bookingId]
    );
    const closedTasks = await pool.query(
      `UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW()
       WHERE package_id=$1::uuid AND booking_id=$2
         AND task_type IN ('follow_up_supplier_order','follow_up_supplier_documents') AND completed=FALSE
       RETURNING id`,
      [packageId, bookingId]
    );
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,metadata)
       VALUES($1::uuid,$2,'cancelled','dmc',jsonb_build_object('previous_status',$3::text))
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId, item.service_order_status]
    );
    return res.json({ cancelled: true, ...saved.rows[0], service_order_event: event.rows[0], closed_task_ids: closedTasks.rows.map((task) => task.id) });
  } catch (error) {
    console.error("cancelTourPackageServiceOrder error:", error);
    return res.status(500).json({ message: "Failed to cancel supplier order" });
  }
}

async function messageTourPackageServiceOrder(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const packageId = req.params.id;
    const bookingId = Number(req.params.bookingId);
    const note = String(req.body?.message || "").trim().slice(0, 1000);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Valid booking ID is required" });
    if (!note) return res.status(400).json({ message: "Supplier message is required" });
    const result = await pool.query(
      `SELECT tp.title,tp.booking_reference,b.id,s.title AS service_title,
              to_jsonb(supplier) AS supplier_profile,ops.service_order_status
         FROM tour_packages tp
         JOIN bookings b ON b.group_id=tp.id AND b.id=$3
         LEFT JOIN services s ON s.id=b.service_id
         LEFT JOIN providers supplier ON supplier.id=b.provider_id
         JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
        WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2`,
      [packageId, ownerId, bookingId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package component not found" });
    const item = result.rows[0];
    if (!["sent", "accepted"].includes(item.service_order_status)) {
      return res.status(409).json({ message: "Send the supplier order before messaging the supplier" });
    }
    const profile = item.supplier_profile || {};
    const chatId = profile.telegram_web_chat_id || profile.telegram_chat_id || profile.tg_chat_id || profile.telegram_refused_chat_id;
    if (!chatId) return res.status(409).json({ message: "Supplier Telegram is not connected" });
    const message = buildSupplierServiceOrderNoteMessage({ tourPackage: item, component: item, note });
    const keyboard = { inline_keyboard: [[{ text: "💬 Ответить DMC", callback_data: `tour_order_reply:${bookingId}` }]] };
    if (!(await tgSend(chatId, message, { reply_markup: keyboard }))) return res.status(502).json({ message: "Failed to send supplier message" });
    const event = await pool.query(
      `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,metadata)
       VALUES($1::uuid,$2,'message_sent','dmc',jsonb_build_object('message',$3::text))
       RETURNING id,event_type,actor_type,created_at,metadata`,
      [packageId, bookingId, note]
    );
    return res.json({ sent: true, service_order_event: event.rows[0] });
  } catch (error) {
    console.error("messageTourPackageServiceOrder error:", error);
    return res.status(500).json({ message: "Failed to send supplier message" });
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

async function createTourPackageIncident(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const title = String(req.body.title || "").trim().slice(0, 240);
    const severity = ["low", "medium", "high", "critical"].includes(req.body.severity) ? req.body.severity : "medium";
    const bookingId = Number(req.body.booking_id) || null;
    if (!title) return res.status(400).json({ message: "Incident title is required" });
    const result = await pool.query(
      `INSERT INTO tour_package_incidents(package_id,booking_id,title,description,severity,assigned_to)
       SELECT tp.id,$3,$4,$5,$6,$7 FROM tour_packages tp
       WHERE tp.id=$1::uuid AND tp.owner_provider_id=$2
         AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM bookings b WHERE b.group_id=tp.id AND b.id=$3))
       RETURNING *`,
      [req.params.id, ownerId, bookingId, title, String(req.body.description || "").trim().slice(0, 2000) || null, severity, String(req.body.assigned_to || "").trim().slice(0, 160) || null]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Tour package or component not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("createTourPackageIncident error:", error);
    return res.status(500).json({ message: "Failed to create incident" });
  }
}

async function updateTourPackageIncident(req, res) {
  try {
    const ownerId = requireProviderOwner(req, res);
    if (!ownerId) return;
    await ensureTourPackagesTable();
    const status = ["open", "monitoring", "resolved"].includes(req.body.status) ? req.body.status : "open";
    const resolution = String(req.body.resolution || "").trim().slice(0, 2000) || null;
    if (status === "resolved" && !resolution) return res.status(400).json({ message: "Resolution is required" });
    const result = await pool.query(
      `UPDATE tour_package_incidents incident SET status=$4,resolution=$5,assigned_to=$6,
         resolved_at=CASE WHEN $4='resolved' THEN COALESCE(incident.resolved_at,NOW()) ELSE NULL END,updated_at=NOW()
       FROM tour_packages tp WHERE incident.id=$3 AND incident.package_id=$1::uuid
         AND tp.id=incident.package_id AND tp.owner_provider_id=$2
       RETURNING incident.*`,
      [req.params.id, ownerId, req.params.incidentId, status, resolution, String(req.body.assigned_to || "").trim().slice(0, 160) || null]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Incident not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackageIncident error:", error);
    return res.status(500).json({ message: "Failed to update incident" });
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
      proposal_response_reason: item.proposal_response_reason,
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
  normalizePackageRefund,
  normalizeSupplierRefund,
  normalizeTraveler,
  normalizeComponentOperations,
  normalizeTourTask,
  normalizeClientFollowup,
  derivePackageStatus,
  packageSaleReadiness,
  packageOperationsReadiness,
  packageOperationsTimeline,
  hashShareToken,
  createBookingReference,
  escapeTelegramHtml,
  buildSupplierServiceOrderMessage,
  buildSupplierServiceOrderReminderMessage,
  buildSupplierServiceOrderCancellationMessage,
  buildSupplierServiceOrderNoteMessage,
  buildSupplierDocumentRequestMessage,
  publicPackageView,
  isValidProposalResponse,
  normalizeProposalResponseReason,
  normalizeTourCancellationReason,
  packageSnapshot,
  createTourPackage,
  listTourPackages,
  listSupplierPerformance,
  getTourPackage,
  updateTourPackage,
  updateTourPackageManager,
  recordTourPackageClientFollowup,
  shareTourPackage,
  revokeTourPackageShare,
  getPublicTourProposal,
  respondToTourProposal,
  confirmTourPackageSale,
  updateTourPackagePayment,
  cancelTourPackage,
  updateTourPackageRefund,
  replaceTourPackageTravelers,
  updateTourPackageComponentOperations,
  updateTourPackageSupplierRefund,
  markTourPackageComponentMessagesRead,
  downloadTourPackageComponentAttachment,
  updateTourPackageComponentAttachment,
  reviewTourPackageComponentAttachment,
  sendTourPackageServiceOrder,
  remindTourPackageServiceOrder,
  requestTourPackageSupplierDocuments,
  cancelTourPackageServiceOrder,
  messageTourPackageServiceOrder,
  createTourPackageTask,
  updateTourPackageTask,
  deleteTourPackageTask,
  createTourPackageIncident,
  updateTourPackageIncident,
};

