const MAP = { status: "m_status", q: "m_q", filter: "m_filter", sort: "m_sort", page: "m_page", pageSize: "m_size", focus: "m_focus" };
const FILTERS = { published: ["all", "telegramFailed", "noUnlocks", "noRequests", "hasRequests"], queue: ["all", "ready", "needFix", "afterCorrection", "no-proof", "no-photo", "no-contact", "gross-below-net", "past-date"] };
export function readQueueLocation(params) {
  const status = ["pending", "published", "rejected", "waiting", "returned"].includes(params.get(MAP.status)) ? params.get(MAP.status) : "pending";
  const allowed = status === "published" ? FILTERS.published : FILTERS.queue;
  const sorts = status === "published" ? ["newest", "problems", "views", "unlocks", "requests"] : ["waiting","returned"].includes(status)?["oldest","priority","newest"]:["priority", "newest", "oldest"];
  const positive = (value, fallback) => /^\d+$/.test(String(value)) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
  return { status, q: (params.get(MAP.q) || "").trim().slice(0,200), filter: allowed.includes(params.get(MAP.filter)) ? params.get(MAP.filter) : "all", sort: sorts.includes(params.get(MAP.sort)) ? params.get(MAP.sort) : sorts[0], page: Math.min(positive(params.get(MAP.page),1),1000000), pageSize: [12,24,48].includes(Number(params.get(MAP.pageSize))) ? Number(params.get(MAP.pageSize)) : 12, focus: positive(params.get(MAP.focus),null) };
}
export function writeQueueLocation(params, patch) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) if (MAP[key]) { if (value === null || value === undefined || value === "") next.delete(MAP[key]); else next.set(MAP[key],String(value)); }
  const normalized = readQueueLocation(next);
  const defaults = { status: "pending", q: "", filter: "all", sort: normalized.status === "published" ? "newest" : ["waiting","returned"].includes(normalized.status)?"oldest":"priority", page: 1, pageSize: 12, focus: null };
  for (const [key, value] of Object.entries(normalized)) { if (value === defaults[key]) next.delete(MAP[key]); else next.set(MAP[key],String(value)); }
  return next;
}
export const queueRequestKey = (state) => JSON.stringify([state.status,state.q,state.filter,state.sort,state.page,state.pageSize]);
export async function fetchModerationQueue(http, { apiBase = "", state, signal, config = {} }) {
  const response = await http.get(`${apiBase}/api/admin/services/queue`, { ...config, signal, params: { status: state.status, q: state.q, filter: state.filter, sort: state.sort, page: state.page, limit: state.pageSize, ...(state.focusId ? { focus_id: state.focusId } : {}) } });
  const data = response.data, p = data?.pagination;
  if (data?.ok !== true || !Array.isArray(data.items) || !p || ![p.page,p.limit,p.total,p.pages].every(Number.isInteger) || p.page < 1 || p.pages < 1 || p.page > p.pages || p.total < 0 || ![12,24,48].includes(p.limit) || !data.metrics || !data.counts || ![...new Set(["pending","rejected","published",state.status])].every(key=>Number.isInteger(data.counts[key])&&data.counts[key]>=0)) throw new Error("Неожиданный ответ очереди. Повторите загрузку.");
  if (p.pages !== Math.max(1,Math.ceil(p.total/p.limit)) || !Number.isInteger(data.metrics.total) || data.metrics.total < p.total || data.metrics.total > data.counts[state.status] || (!state.q && state.filter === "all" && p.total !== data.counts[state.status])) throw new Error("Счётчики очереди не совпадают с результатами. Повторите загрузку.");
  const expected = Math.max(0, Math.min(p.limit,p.total-(p.page-1)*p.limit));
  if (data.items.length !== expected) throw new Error("Ответ очереди неполный. Повторите загрузку.");
  return data;
}
export function createQueueRunner({ request, onData, onError, onLoading }) {
  let generation = 0, controller;
  return {
    async run(state) {
      const id = ++generation;
      controller?.abort();
      const current = new AbortController(); controller = current;
      onLoading(true);
      try {
        const data = await request(state,current.signal);
        if (id !== generation || current.signal.aborted) return null;
        onData(data,state); return data;
      } catch (error) {
        if (id === generation && !current.signal.aborted && error.code !== "ERR_CANCELED") onError(error,state);
        return null;
      } finally { if (id === generation) onLoading(false); }
    },
    cancel() { generation += 1; controller?.abort(); },
  };
}

// Prefer the next visible survivor; when the page fills after removal, use its new row.
export function nextModerationService(previous, decidedId, current) {
  const available = current.filter(item=>String(item.id)!==String(decidedId));
  const index=previous.findIndex(item=>String(item.id)===String(decidedId));
  const next=previous.slice(index+1).find(item=>available.some(row=>String(row.id)===String(item.id)));
  return next?.id ?? available.find(item=>!previous.some(row=>String(row.id)===String(item.id)))?.id ?? available[0]?.id ?? null;
}

export function correctionWaitLabel(service,now=Date.now()) {
 const status=service.moderation_status||service.status;
 const returned=service.status==="pending"||service.moderation_status==="pending";
 const since=returned?(service.correction_returned_at||service.submitted_at):(service.correction_requested_at||service.legacy_correction_requested_at||service.rejected_at);
 if(!since)return "Срок ожидания неизвестен";
 const days=Math.max(0,Math.floor((now-new Date(since).getTime())/86400000));
 if(!Number.isFinite(days))return "Срок ожидания неизвестен";
 return `${returned?"Ждёт повторной проверки":"Ждём поставщика"}: ${days===0?"менее суток":`${days} дн.`}`;
}
