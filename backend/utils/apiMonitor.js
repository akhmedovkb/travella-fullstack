/* Простенький in-memory монитор событий внешних API (GeoNames и др.).
 * Хранит последние N событий, умеет отдавать сводку за 1ч/24ч, подсвечивает вероятную проблему квоты.
 */
const MAX_EVENTS = 500;

function ensureBucket(state, provider) {
  if (!state[provider]) state[provider] = { events: [] };
  return state[provider];
}

function pushEvent(bucket, ev) {
  bucket.events.push(ev);
  if (bucket.events.length > MAX_EVENTS) bucket.events.splice(0, bucket.events.length - MAX_EVENTS);
}

function summarize(events, nowMs = Date.now()) {
  const H1 = 60 * 60 * 1000;
  const D1 = 24 * 60 * 60 * 1000;
  const since1h = nowMs - H1;
  const since24h = nowMs - D1;

  let ok1h = 0, err1h = 0, ok24h = 0, err24h = 0;
  const byStatus = {};

  let lastOkAt = null, lastErrAt = null, lastStatus = null, lastMessage = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (lastStatus == null) { lastStatus = e.status ?? null; lastMessage = e.message ?? null; }
    if (e.ok && lastOkAt == null) lastOkAt = e.ts;
    if (!e.ok && lastErrAt == null) lastErrAt = e.ts;

    if (e.ts >= since24h) {
      if (e.ok) ok24h++; else err24h++;
      const k = String(e.status ?? "NA");
      byStatus[k] = (byStatus[k] || 0) + 1;
    }
    if (e.ts >= since1h) {
      if (e.ok) ok1h++; else err1h++;
    }
  }

  const last = events[events.length - 1] || null;
  const likelyQuota =
    !!last && !last.ok && (
      [401, 403, 429].includes(last.status) ||
      /limit|quota|credit/i.test(String(last.message || ""))
    );

  return {
    count_total: events.length,
    ok_1h: ok1h, err_1h: err1h,
    ok_24h: ok24h, err_24h: err24h,
    by_status_24h: byStatus,
    last_status: lastStatus,
    last_message: lastMessage,
    last_ok_at: lastOkAt,
    last_error_at: lastErrAt,
    quota_suspected: likelyQuota,
    updated_at: new Date(nowMs).toISOString(),
  };
}

const STATE = {}; // { provider: { events: [{ts, ok, status, message, meta}], ... } }

/** Записать событие */
function record(provider, { ok, status = null, message = "", meta = null }) {
  const b = ensureBucket(STATE, provider);
  pushEvent(b, {
    ts: Date.now(),
    ok: !!ok,
    status: Number.isFinite(status) ? Number(status) : null,
    message: message ? String(message) : "",
    meta: meta || null,
  });
}

/** Последние N событий */
function getEvents(provider, limit = 50) {
  const b = ensureBucket(STATE, provider);
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return b.events.slice(-n).map((e) => ({
    ...e,
    ts_iso: new Date(e.ts).toISOString(),
  })).reverse();
}

/** Короткая сводка */
function getSummary(provider) {
  const b = ensureBucket(STATE, provider);
  return summarize(b.events);
}

module.exports = { record, getEvents, getSummary };
