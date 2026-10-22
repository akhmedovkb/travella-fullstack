const pool = require("../db");

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_packages_owner_updated ON tour_packages(owner_provider_id, updated_at DESC)`);
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
         quote_valid_until, route, itinerary, meta
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,$14,$15::jsonb,$16::jsonb,$17::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, status=EXCLUDED.status, currency=EXCLUDED.currency,
         net_total=EXCLUDED.net_total, markup_type=EXCLUDED.markup_type,
         markup_value=EXCLUDED.markup_value, gross_total=EXCLUDED.gross_total,
         pax_adult=EXCLUDED.pax_adult, pax_child=EXCLUDED.pax_child,
         start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
         quote_valid_until=EXCLUDED.quote_valid_until, route=EXCLUDED.route,
         itinerary=EXCLUDED.itinerary, meta=EXCLUDED.meta, updated_at=NOW()
       WHERE tour_packages.owner_provider_id=$2
       RETURNING *`,
      [id, ownerId, value.title, value.status, value.currency, value.netTotal,
        value.markupType, value.markupValue, value.grossTotal, value.paxAdult,
        value.paxChild, value.startDate, value.endDate, value.quoteValidUntil,
        JSON.stringify(value.route), JSON.stringify(value.itinerary), JSON.stringify(value.meta)]
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
    return res.json({ ...item, status: derivePackageStatus(bookings, item.status), components: bookings });
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
    const value = normalizePackageBody({
      ...current.rows[0],
      ...req.body,
      meta: { ...(current.rows[0].meta || {}), ...(req.body?.meta || {}) },
    });
    const result = await pool.query(
      `UPDATE tour_packages SET title=$3,status=$4,currency=$5,net_total=$6,
         markup_type=$7,markup_value=$8,gross_total=$9,quote_valid_until=$10,
         meta=$11::jsonb,updated_at=NOW()
       WHERE id=$1::uuid AND owner_provider_id=$2 RETURNING *`,
      [req.params.id, ownerId, value.title, value.status, value.currency, value.netTotal,
        value.markupType, value.markupValue, value.grossTotal, value.quoteValidUntil,
        JSON.stringify(value.meta)]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("updateTourPackage error:", error);
    return res.status(500).json({ message: "Failed to update tour package" });
  }
}

module.exports = {
  calculateGross,
  derivePackageStatus,
  createTourPackage,
  listTourPackages,
  getTourPackage,
  updateTourPackage,
};

