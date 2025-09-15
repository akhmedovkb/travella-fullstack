// frontend/src/api.js
const API_BASE = (
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  (typeof window !== "undefined" && window.frontend?.API_BASE) ||
  ""
).replace(/\/+$/, "");

const url = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

function getTokenByRole(role) {
  if (role === "client")   return localStorage.getItem("clientToken");
  if (role === "provider") return localStorage.getItem("token") || localStorage.getItem("providerToken");
  return (
    localStorage.getItem("clientToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken")
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
  const res = await fetch(url(path), {
    headers: buildHeaders(withAuthOrRole),
    credentials: "include",
  });
  return handle(res);
}
export async function apiPost(path, body, withAuthOrRole = true) {
  const res = await fetch(url(path), {
    method: "POST",
    headers: buildHeaders(withAuthOrRole),
    body: JSON.stringify(body ?? {}),
    credentials: "include",
  });
  return handle(res);
}
export async function apiPut(path, body, withAuthOrRole = true) {
  const res = await fetch(url(path), {
    method: "PUT",
    headers: buildHeaders(withAuthOrRole),
    body: JSON.stringify(body ?? {}),
    credentials: "include",
  });
  return handle(res);
}
export async function apiDelete(path, body, withAuthOrRole = true) {
  const res = await fetch(url(path), {
    method: "DELETE",
    headers: buildHeaders(withAuthOrRole),
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}
