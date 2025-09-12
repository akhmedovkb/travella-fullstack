const pool = require("../db");

// Унифицированная дата начала услуги для "Ближайшие"
const SERVICE_START_AT_SQL = `
  COALESCE(
    NULLIF(s.details->>'departureFlightDate','')::timestamptz,   -- авиабилеты
    NULLIF(s.details->>'startDate','')::timestamptz,             -- туры
    NULLIF(s.details->>'checkinDate','')::timestamptz,           -- отели
    NULLIF(s.details->>'eventDate','')::timestamptz              -- мероприятия
  ) AS service_start_at
`;

// Средний рейтинг провайдера
const PROVIDER_RATING_SQL = `
  SELECT provider_id, AVG(rating)::float AS avg_rating, COUNT(*)::int AS review_count
  FROM reviews
  GROUP BY provider_id
`;

// Сумма активных «баллов модератора»
const MOD_POINTS_SQL = `
  SELECT provider_id, COALESCE(SUM(points),0)::int AS points_sum
  FROM provider_moderator_points
  WHERE expires_at IS NULL OR expires_at > NOW()
  GROUP BY provider_id
`;

function parsePagination(req) {
  const page  = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "12", 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function whereBaseFilters({ category, providerType }) {
  const clauses = [`s.status IN ('published','approved')`];
  const params = [];
  if (category) {
    params.push(category);
    clauses.push(`s.category = $${params.length}`);
  }
  if (providerType) {
    params.push(providerType);
    clauses.push(`p.type = $${params.length}`);
  }
  return { where: clauses.join(" AND "), params };
}

// -------- Top --------
exports.getTopServices = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const { category, providerType } = req.query;
    const { where, params } = whereBaseFilters({ category, providerType });

    const sql = `
      WITH pr AS (${PROVIDER_RATING_SQL}),
           mp AS (${MOD_POINTS_SQL}),
           base AS (
             SELECT
               s.id, s.title, s.category, s.details, s.images, s.created_at,
               s.price_net, s.price_gross, s.currency,
               p.id AS provider_id, p.name AS provider_name, p.type AS provider_type, p.avatar_url,
               COALESCE(pr.avg_rating, 0) AS avg_rating,
               COALESCE(pr.review_count, 0) AS review_count,
               COALESCE(mp.points_sum, 0) AS mod_points,
               (COALESCE(pr.avg_rating,0)*100 + COALESCE(mp.points_sum,0))::float AS score
             FROM services s
             JOIN providers p ON p.id = s.provider_id
             LEFT JOIN pr ON pr.provider_id = p.id
             LEFT JOIN mp ON mp.provider_id = p.id
             WHERE ${where}
           )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM base
      ORDER BY score DESC, review_count DESC, created_at DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2};
    `;
    const r = await pool.query(sql, [...params, limit, offset]);
    const total = r.rows[0]?.total_count || 0;
    res.json({ items: r.rows.map(({ total_count, ...row }) => row), page, limit, total });
  } catch (e) {
    console.error("getTopServices error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
};

// -------- Новые (последние 24 часа) --------
exports.ge
