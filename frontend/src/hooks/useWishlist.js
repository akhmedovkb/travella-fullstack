// frontend/src/api.js
const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;

function getTokenByRole(role) {
  if (role === "client")   return localStorage.getItem("clientToken");
  if (role === "provider") return localStorage.getItem("token") || localStorage.getItem("providerToken");
  // fallback: любой
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
  let data; try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

// withAuthOrRole: true | false | "client" | "provider"
function buildHeaders(withAuthOrRole) {
  const base = { "Content-Type": "application/json" };
  if (withAuthOrRole === false) return base;
  const role = withAuthOrRole === "client" || withAuthOrRole === "provider" ? withAuthOrRole : null;
  return { ...base, ...getAuthHeaders(role) };
}

export async function apiGet(path, withAuthOrRole = true) {
  const res = await fetch(`${API_URL}${path}`, { headers: buildHeaders(withAuthOrRole) });
  return handle(res);
}

export async function apiPost(path, body, withAuthOrRole = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(withAuthOrRole),
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function apiPut(path, body, withAuthOrRole = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: buildHeaders(withAuthOrRole),
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function apiDelete(path, body, withAuthOrRole = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(withAuthOrRole),
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}
