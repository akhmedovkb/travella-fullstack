const { analyzeModerationService, getQueueMetrics, matchesQueueFilter, getPublishedMetrics, matchesPublishedFilter, comparePublishedItems } = require("./moderationQueueAnalysis");
const STATUS_WHERE = {
  pending: "COALESCE(s.moderation_status, s.status) = 'pending'",
  rejected: "COALESCE(s.moderation_status, s.status) = 'rejected'",
  published: "LOWER(COALESCE(s.status, '')) IN ('published','approved','active') AND COALESCE(LOWER(s.moderation_status), 'approved') IN ('approved','published','active')",
};
const QUEUE_FILTERS = ["all", "ready", "needFix", "afterCorrection", "no-proof", "no-photo", "no-contact", "gross-below-net", "past-date"];
const PUBLISHED_FILTERS = ["all", "telegramFailed", "noUnlocks", "noRequests", "hasRequests"];
function normalizeQueueRequest(input = {}) {
  const status = Object.hasOwn(STATUS_WHERE, input.status) ? input.status : "pending";
  const filters = status === "published" ? PUBLISHED_FILTERS : QUEUE_FILTERS;
  const sorts = status === "published" ? ["newest", "problems", "views", "unlocks", "requests"] : ["priority", "newest"];
  const integer = (value, fallback, max) => /^\d+$/.test(String(value)) ? Math.max(1, Math.min(Number(value), max)) : fallback;
  return { status, q: String(input.q || "").trim().slice(0, 200), filter: filters.includes(input.filter) ? input.filter : "all", sort: sorts.includes(input.sort) ? input.sort : sorts[0], page: integer(input.page, 1, 1000000), limit: [12, 24, 48].includes(Number(input.limit)) ? Number(input.limit) : 12, focusId: Number(input.focus_id ?? input.focusId) > 0 ? integer(input.focus_id ?? input.focusId, null, Number.MAX_SAFE_INTEGER) : null };
}
function selectQueuePage(candidates, input) {
  const options = normalizeQueueRequest(input);
  const published = options.status === "published";
  const metrics = published ? getPublishedMetrics(candidates) : getQueueMetrics(candidates);
  const analyses = published ? null : new Map(candidates.map((item) => [item.id, analyzeModerationService(item)]));
  let filtered = candidates.filter((item) => {
    if (published) return matchesPublishedFilter(item, options.filter);
    const analysis = analyses.get(item.id);
    if (options.filter === "all") return true;
    if (options.filter === "ready") return analysis.ready;
    if (options.filter === "needFix") return !analysis.ready;
    if (options.filter === "afterCorrection") return analysis.hasCorrectionHistory;
    return analysis.dangerIssues.some((issue) => issue.key === options.filter);
  });
  filtered.sort((a, b) => {
    let order;
    if (published) order = comparePublishedItems(a, b, options.sort);
    else {
      order = options.sort === "priority" ? analyses.get(b.id).priority - analyses.get(a.id).priority : 0;
      if (!order) order = new Date(b.created_at || b.submitted_at || b.updated_at || 0) - new Date(a.created_at || a.submitted_at || a.updated_at || 0);
    }
    return order || Number(b.id) - Number(a.id);
  });
  const total = filtered.length, pages = Math.max(1, Math.ceil(total / options.limit));
  const focusIndex = options.focusId ? filtered.findIndex((item) => Number(item.id) === options.focusId) : -1;
  const page = focusIndex >= 0 ? Math.floor(focusIndex / options.limit) + 1 : Math.min(options.page, pages);
  const ids = filtered.slice((page - 1) * options.limit, page * options.limit).map((item) => item.id);
  return { ids, metrics, pagination: { page, limit: options.limit, total, pages }, focusFound: focusIndex >= 0 };
}
const LAST_EVENT = `LEFT JOIN LATERAL (SELECT action, reason_code, reason, created_at, actor_id FROM service_moderation_events WHERE service_id = s.id AND action <> 'service_edited' ORDER BY created_at DESC, id DESC LIMIT 1) ev ON TRUE`;
const STATS = `LEFT JOIN (SELECT service_id, COUNT(*)::int AS views_count FROM service_views GROUP BY service_id) v ON v.service_id = s.id
 LEFT JOIN (SELECT service_id, COUNT(*)::int AS contact_unlocks_count FROM client_service_contact_unlocks GROUP BY service_id) u ON u.service_id = s.id
 LEFT JOIN (SELECT service_id, COUNT(*)::int AS quick_requests_count FROM telegram_quick_requests GROUP BY service_id) qr ON qr.service_id = s.id
 LEFT JOIN (SELECT service_id, COUNT(*) FILTER (WHERE action = 'telegram_failed')::int AS telegram_failed_count, COUNT(*) FILTER (WHERE action = 'telegram_sent')::int AS telegram_sent_count FROM service_moderation_events GROUP BY service_id) tg ON tg.service_id = s.id`;
const STAT_FIELDS = `COALESCE(v.views_count,0) AS views_count, COALESCE(u.contact_unlocks_count,0) AS contact_unlocks_count, COALESCE(qr.quick_requests_count,0) AS quick_requests_count, COALESCE(tg.telegram_failed_count,0) AS telegram_failed_count, COALESCE(tg.telegram_sent_count,0) AS telegram_sent_count`;
const EVENT_FIELDS = `ev.action AS last_moderation_action, ev.reason_code AS last_moderation_reason_code, ev.reason AS last_moderation_reason, ev.created_at AS last_moderation_at, ev.actor_id AS last_moderation_actor_id`;
const PROVIDER_FIELDS = `p.name AS provider_name, p.type AS provider_type, p.phone AS provider_phone, p.social AS provider_social, p.telegram_refused_chat_id AS provider_telegram_refused_chat_id, p.telegram_web_chat_id AS provider_telegram_web_chat_id, p.telegram_chat_id AS provider_telegram_chat_id, p.tg_chat_id AS provider_tg_chat_id`;
function queueCandidateQuery(input) {
  const options = normalizeQueueRequest(input), published = options.status === "published";
  const params = [];
  let search = "";
  if (/^#\d+$/.test(options.q)) {
    if (BigInt(options.q.slice(1)) > 9223372036854775807n) search = "AND FALSE";
    else { params.push(options.q.slice(1)); search = "AND s.id = $1::bigint"; }
  } else if (options.q) {
    const text = options.q.replace(/[\\%_]/g, "\\$&");
    params.push(`%${text}%`);
    search = `AND concat_ws(' ', s.id::text, s.title, s.description, s.category, p.name, s.details->>'title', s.details->>'direction', s.details->>'directionCountry', s.details->>'directionFrom', s.details->>'directionTo', s.details->>'hotel', s.details->>'eventName', s.details->>'location', s.details->>'accommodation', s.details->>'roomCategory') ILIKE $1`;
  }
  const columns = published ? "s.id, s.published_at, s.approved_at, s.updated_at" : "s.id, s.title, s.category, s.price, s.details, s.images, s.created_at, s.submitted_at, s.updated_at, s.status, s.moderation_status";
  return { sql: `SELECT ${columns}, ${EVENT_FIELDS}, ${PROVIDER_FIELDS} ${published ? `, ${STAT_FIELDS}` : ""} FROM services s JOIN providers p ON p.id = s.provider_id ${LAST_EVENT} ${published ? STATS : ""} WHERE s.deleted_at IS NULL AND (${STATUS_WHERE[options.status]}) ${search}`, params };
}
async function readModerationQueue(pool, input) {
  const options = normalizeQueueRequest(input), client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); open = true;
    const countResult = await client.query(`SELECT COUNT(*) FILTER (WHERE ${STATUS_WHERE.pending})::int AS pending, COUNT(*) FILTER (WHERE ${STATUS_WHERE.rejected})::int AS rejected, COUNT(*) FILTER (WHERE ${STATUS_WHERE.published})::int AS published FROM services s JOIN providers p ON p.id = s.provider_id WHERE s.deleted_at IS NULL`);
    const query = queueCandidateQuery(options);
    const candidates = (await client.query(query.sql, query.params)).rows;
    if (!options.q && candidates.length !== Number(countResult.rows[0][options.status])) throw new Error("QUEUE_COUNT_MISMATCH");
    const selected = selectQueuePage(candidates, options);
    let items = [];
    if (selected.ids.length) {
      items = (await client.query(`SELECT s.*, ${PROVIDER_FIELDS}, ${EVENT_FIELDS}, ${STAT_FIELDS} FROM services s JOIN providers p ON p.id = s.provider_id ${LAST_EVENT} ${STATS} WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL ORDER BY array_position($1::bigint[], s.id::bigint)`, [selected.ids])).rows;
      if (items.length !== selected.ids.length) throw new Error("QUEUE_SNAPSHOT_MISMATCH");
    }
    await client.query("COMMIT"); open = false;
    return { ok: true, items, counts: countResult.rows[0], metrics: selected.metrics, pagination: selected.pagination, focusFound: selected.focusFound };
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
module.exports = { normalizeQueueRequest, selectQueuePage, queueCandidateQuery, readModerationQueue };
