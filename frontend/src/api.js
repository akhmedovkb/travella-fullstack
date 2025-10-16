// frontend/src/api.js
function getApiBase() {
  const env =
    (import.meta?.env?.VITE_API_BASE_URL || import.meta?.env?.VITE_API_URL || "").trim();
  const runtime =
    (typeof window !== "undefined" && window.frontend && window.frontend.API_BASE) || "";
  // env приоритетнее, но если его нет — берём runtime-переменную из index.html
  return (env || runtime).replace(/\/+$/, "");
}

const buildUrl = (path) => {
  const base = getApiBase();
  if (!base) {
    // поможет увидеть проблему сразу в консоли
    console.warn("[API] Empty API base, request will go to same-origin:", path);
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

function getTokenByRole(role) {
  if (role === "client")   return localStorage.getItem("clientToken");
  if (role === "provider") return localStorage.getItem("providerToken") || localStorage.getItem("token");
  // по умолчанию: предпочитаем провайдера/админа
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken")
  );
}
export function getAuthHeaders(role = null) {
  const token = getTokenByRole(role);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data || {};
    if (data && (data.error || data.code)) err.code = data.error || data.code;
    throw err;
  }
  return data === null ? {} : data;
}

function buildHeaders(withAuthOrRole) {
  const base = { "Content-Type": "application/json" };
  if (withAuthOrRole === false) return base;
  const role = withAuthOrRole === "client" || withAuthOrRole === "provider" ? withAuthOrRole : null;
  return { ...base, ...getAuthHeaders(role) };
}

export async function apiGet(path, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), { headers: buildHeaders(withAuthOrRole), credentials: "include" });
  return handle(res);
}
export async function apiPost(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "POST", headers: buildHeaders(withAuthOrRole), body: JSON.stringify(body ?? {}), credentials: "include",
  });
  return handle(res);
}
export async function apiPut(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "PUT", headers: buildHeaders(withAuthOrRole), body: JSON.stringify(body ?? {}), credentials: "include",
  });
  return handle(res);
}
export async function apiDelete(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "DELETE", headers: buildHeaders(withAuthOrRole),
    body: body ? JSON.stringify(body) : undefined, credentials: "include",
  });
  return handle(res);
}
