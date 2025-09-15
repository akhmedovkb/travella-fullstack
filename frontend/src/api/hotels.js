// frontend/src/api/hotels.js
import axios from "axios";

// Базовый URL API (может быть пустым — тогда пойдут относительные пути)
const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const apiURL = (path) => `${API_BASE}${path}`;

// ─────────── Авторизация ───────────
// Храним совместимость с текущими ключами localStorage
function getToken(role) {
  if (role === "provider") {
    return (
      localStorage.getItem("providerToken") ||
      localStorage.getItem("token") || // бэкап старого имени
      null
    );
  }
  if (role === "client" || role === true) {
    return localStorage.getItem("clientToken") || null;
  }
  // auto: сначала пробуем провайдера, затем клиента
  return (
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("clientToken") ||
    null
  );
}

function makeHeaders(role) {
  const t = getToken(role);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Единые обёртки над axios с разворачиванием ошибок
async function httpGet(path, { params, role } = {}) {
  try {
    const res = await axios.get(url(path), {
      params,
      withCredentials: true,
      headers: makeHeaders(role),
    });
    return res.data;
  } catch (e) {
    throw normalizeErr(e);
  }
}

async function httpPost(path, body = {}, role) {
  try {
    const res = await axios.post(url(path), body, {
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
        ...makeHeaders(role),
      },
    });
    return res.data;
  } catch (e) {
    throw normalizeErr(e);
  }
}

async function httpPut(path, body = {}, role) {
  try {
    const res = await axios.put(url(path), body, {
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
        ...makeHeaders(role),
      },
    });
    return res.data;
  } catch (e) {
    throw normalizeErr(e);
  }
}

function normalizeErr(e) {
  const status = e?.response?.status;
  const message =
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    "Request failed";
  const err = new Error(message);
  err.status = status;
  err.data = e?.response?.data;
  return err;
}

// ─────────── Публичные методы API ───────────

/** Поиск отелей (доступно всем) */
export async function searchHotels({
  name = "",
  city = "",
  country = "",
  page = 1,
  limit = 20,
} = {}) {
  const params = {
    name: name || "",
    city: city || "",
    country: country || "",
    page: String(page),
    limit: String(limit),
  };
  return httpGet("/api/hotels/search", { params });
}

/** Получить карточку отеля (доступно всем) */
export async function getHotel(hotelId) {
  return httpGet(`/api/hotels/${encodeURIComponent(hotelId)}`);
}

/** Создать новый отель (провайдер/админ) */
export async function createHotel(payload) {
  return httpPost(`/api/hotels`, payload, "provider");
}

/** Обновить существующий отель (провайдер/админ) */
export async function updateHotel(hotelId, payload) {
  return httpPut(`/api/hotels/${encodeURIComponent(hotelId)}`, payload, "provider");
}

/** Создать инспекцию к отелю (только провайдер) */
export async function createInspection(hotelId, payload) {
  return httpPost(
    `/api/hotels/${encodeURIComponent(hotelId)}/inspections`,
    payload,
    "provider"
  );
}

/** Список инспекций (доступно всем). sort: "top" | "new" */
export async function listInspections(hotelId, { sort = "top" } = {}) {
  return httpGet(`/api/hotels/${encodeURIComponent(hotelId)}/inspections`, {
    params: { sort },
  });
}

/** Лайк инспекции (авто-роль: сначала провайдер, затем клиент) */
export async function likeInspection(inspectionId) {
  // auto — выберет доступный токен (provider > client)
  return httpPost(`/api/hotel-inspections/${encodeURIComponent(inspectionId)}/like`, {}, undefined);
}
