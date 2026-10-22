const crypto = require("crypto");
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const PACKAGE_STATUSES = new Set([
  "draft", "request_sent", "partially_confirmed", "confirmed",
  "proposed", "booked", "paid", "cancelled",
]);

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
            b.payment_status, p.name AS provider_name, p.type AS provider_type
       FROM bookings b
       LEFT JOIN providers p ON p.id = b.provider_id
      WHERE b.group_id = $1::uuid
      ORDER BY b.created_at, b.id`,
    [packageId]
  );
  return result.rows;
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
              COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','paid','completed'))::int AS confirmed_count
         FROM tour_packages tp
         LEFT JOIN bookings b ON b.group_id=tp.id
        WHERE tp.owner_provider_id=$1
        GROUP BY tp.id
        ORDER BY tp.updated_at DESC`,
      [ownerId]
    );
    const items = await Promise.all(result.rows.map(async (item) => {
      const bookings = await packageBookings(item.id);
      return {
        ...item,
        is_shared: Boolean(item.share_token_hash),
        share_token_hash: undefined,
        status: derivePackageStatus(bookings, item.status),
        component_count: bookings.length,
        confirmed_count: bookings.filter((booking) => ["confirmed", "paid", "completed"].includes(String(booking.status || "").toLowerCase())).length,
      };
    }));
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
    const result = await pool.query(`SELECT * FROM tour_packages WHERE id=$1::uuid AND owner_provider_id=$2`, [req.params.id, ownerId]);
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
    return res.json({
      ...item,
      share_token_hash: undefined,
      is_shared: Boolean(item.share_token_hash),
      status: derivePackageStatus(bookings, item.status),
      components: bookings,
      revisions: revisions.rows,
      readiness: packageSaleReadiness(bookings, item.proposal_response),
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
  derivePackageStatus,
  packageSaleReadiness,
  hashShareToken,
  createBookingReference,
  escapeTelegramHtml,
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
};

