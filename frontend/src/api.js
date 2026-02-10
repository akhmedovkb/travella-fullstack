// frontend/src/api.js

export function getApiBase() {
  const env =
    (import.meta?.env?.VITE_API_BASE_URL || import.meta?.env?.VITE_API_URL || "").trim();
  const runtime =
    (typeof window !== "undefined" && window.frontend && window.frontend.API_BASE) || "";
  return (env || runtime).replace(/\/+$/, "");
}

export const buildUrl = (path) => {
  const base = getApiBase();
  if (!base) {
    console.warn("[API] Empty API base, request will go to same-origin:", path);
  }

  const p = path.startsWith("/") ? path : `/${path}`;
  const baseNoSlash = String(base || "").replace(/\/+$/, "");
  if (baseNoSlash.endsWith("/api") && p.startsWith("/api/")) {
    return `${baseNoSlash}${p.slice(4)}`; // drop leading "/api"
  }

  return `${baseNoSlash}${p}`;
};

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickTokenFromObject(obj) {
  if (!obj || typeof obj !== "object") return "";
  return (
    obj.token ||
    obj.accessToken ||
    obj.access_token ||
    obj.jwt ||
    obj?.data?.token ||
    ""
  );
}

function getTokenByRole(role) {
  const r = String(role || "").toLowerCase();

  const directKeysByRole = {
    client: ["clientToken", "token", "adminToken"],
    provider: ["providerToken", "token", "adminToken"],
    admin: ["adminToken", "token"],
  };

  const directKeysAll = [
    "token",
    "adminToken",
    "providerToken",
    "clientToken",
    "accessToken",
    "jwt",
    "authToken",
  ];

  const keys = directKeysByRole[r] || directKeysAll;

  const pickFromStorage = (storage) => {
    for (const k of keys) {
      const v = storage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  // 1) localStorage direct keys
  let t = pickFromStorage(localStorage);
  if (t) return t;

  // 2) sessionStorage direct keys (иногда токен там)
  t = pickFromStorage(sessionStorage);
  if (t) return t;

  // 3) JSON objects (auth/user/session/admin/profile)
  const jsonKeys = ["auth", "user", "session", "admin", "profile"];
  for (const k of jsonKeys) {
    const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (!raw) continue;
    const obj = safeJsonParse(raw);
    const tt = pickTokenFromObject(obj);
    if (tt && String(tt).trim()) return String(tt).trim();
  }

  return "";
}


export function getAuthHeaders(role = null) {
  const token = getTokenByRole(role);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(
      (data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`
    );
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

  const role =
    withAuthOrRole === "client" ||
    withAuthOrRole === "provider" ||
    withAuthOrRole === "admin"
      ? withAuthOrRole
      : null;

  return { ...base, ...getAuthHeaders(role) };
}


/**
 * ✅ Safe JSON stringify:
 * - DO NOT touch normal strings (like "2026-02-08")
 * - If a Date object is present anywhere in body -> serialize as local YYYY-MM-DD
 *   (prevents timezone shift / -1 day bugs)
 */
function safeJsonStringify(obj) {
  return JSON.stringify(obj ?? {}, (key, value) => {
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return value;
  });
}

export async function apiGet(path, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    headers: buildHeaders(withAuthOrRole),
    credentials: "include",
  });
  return handle(res);
}

export async function apiPost(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: buildHeaders(withAuthOrRole),
    body: safeJsonStringify(body),
    credentials: "include",
  });
  return handle(res);
}

export async function apiPut(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "PUT",
    headers: buildHeaders(withAuthOrRole),
    body: safeJsonStringify(body),
    credentials: "include",
  });
  return handle(res);
}

export async function apiDelete(path, body, withAuthOrRole = true) {
  const res = await fetch(buildUrl(path), {
    method: "DELETE",
    headers: buildHeaders(withAuthOrRole),
    body: body ? safeJsonStringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}
