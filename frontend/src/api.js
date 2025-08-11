// frontend/src/api.js

// Поддерживаем оба варианта .env: VITE_API_BASE_URL или VITE_API_URL
const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;

// Берём любой доступный токен (клиент / провайдер)
function getAnyToken() {
  return (
    localStorage.getItem("clientToken") ||
    localStorage.getItem("token") ||           // провайдерский (как у тебя было)
    localStorage.getItem("providerToken")
  );
}

export function getAuthHeaders() {
  const token = getAnyToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

export async function apiPost(path, body, withAuth = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? getAuthHeaders() : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function apiGet(path, withAuth = true) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? getAuthHeaders() : {}),
    },
  });
  return handle(res);
}

export async function apiPut(path, body, withAuth = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? getAuthHeaders() : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function apiDelete(path, body, withAuth = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? getAuthHeaders() : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}
