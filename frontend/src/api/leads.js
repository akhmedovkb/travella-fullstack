// База API берётся из .env (VITE_API_BASE_URL) или из window.frontend.API_BASE,
// и без завершающего слэша
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.frontend && window.frontend.API_BASE) ||
  ""
).replace(/\/+$/, "");

const json = async (res) => {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
};

const qs = (obj = {}) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Создать лид (публичные формы) */
export async function createLead(payload) {
  const res = await fetch(`${API_BASE}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return json(res);
}

/** Список лидов (админка) */
export async function listLeads(filters = {}) {
  const res = await fetch(`${API_BASE}/api/leads${qs(filters)}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  return json(res);
}

/** Обновить статус лида (админка) */
export async function updateLeadStatus(id, status) {
  const res = await fetch(`${API_BASE}/api/leads/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return json(res);
}
