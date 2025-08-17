// frontend/src/api.js

// Универсальная база для API.
// 1) Берём из Vite-переменных, если заданы
// 2) Пытаемся взять из window.frontend (если вдруг есть)
// 3) Иначе — работаем относительным путём ("/api")
const API_BASE = (() => {
  const envBase =
    import.meta?.env?.VITE_API_BASE_URL ||
    import.meta?.env?.VITE_API_URL ||
    "";

  const win = typeof window !== "undefined" ? window : {};
  const cfg = (win.frontend && (win.frontend.API_BASE || win.frontend.API_URL)) || "";

  const base = String(envBase || cfg || "").trim();
  return base.replace(/\/$/, ""); // без завершающего /
})();

// Склеиваем базу с путём; абсолютные URL не трогаем
function withBase(path) {
  const p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  if (!API_BASE) return p; // относительный, например "/api/..."
  return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

function getTokenByRole(role) {
  if (role === "client") return localStorage.getItem("clientToken");
  if (role === "provider")
    return localStorage.getItem("token") || localStorage.getItem("providerToken");
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

// Аккуратно парсим JSON, чтобы 204/304 не ломали логику
async function parseJsonSafe(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handle(res) {
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// withAuthOrRole: true | false | "client" | "provider"
function buildHeaders(withAuthOrRole) {
  const base = { "Content-Type": "application/json" };
  if (withAuthOrRole === false) return base;
  const role =
    withAuthOrRole === "client" || withAuthOrRole === "provider"
      ? withAuthOrRole
      : null;
  return { ...base, ...getAuthHeaders(role) };
}

export async function apiGet(path, withAuthOrRole = true) {
  const res = await fetch(withBase(path), {
    method: "GET",
    headers: buildHeaders(withAuthOrRole),
    credentials: "include",
  });
  return handle(res);
}

export async function apiPost(path, body, withAuthOrRole = true) {
  const res = await fetch(withBase(path), {
    method: "POST",
    headers: buildHeaders(withAuthOrRole),
    body: body != null ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}

export async function apiPut(path, body, withAuthOrRole = true) {
  const res = await fetch(withBase(path), {
    method: "PUT",
    headers: buildHeaders(withAuthOrRole),
    body: body != null ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}

export async function apiDelete(path, body, withAuthOrRole = true) {
  const res = await fetch(withBase(path), {
    method: "DELETE",
    headers: buildHeaders(withAuthOrRole),
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}
