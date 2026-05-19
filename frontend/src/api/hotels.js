// frontend/src/api/hotels.js
import { apiGet, apiPost, apiPut, buildUrl, getAuthHeaders } from "../api";

export async function listRanked({ type = "top", limit = 20 } = {}) {
  return apiGet(`/api/hotels/ranked?type=${encodeURIComponent(type)}&limit=${limit}`, false);
}

/** Публичный поиск отелей */
export async function searchHotels({ name = "", city = "", country = "", page = 1, limit = 50 } = {}) {
  const qs = new URLSearchParams();
  if (name) qs.set("name", name);
  if (city) qs.set("city", city);
  if (country) qs.set("country", country);
  qs.set("page", String(page));
  qs.set("limit", String(limit));
  qs.set("ext", "0");
  return apiGet(`/api/hotels/search?${qs.toString()}`, false);
}

/** Карточка отеля (публично) */
export function getHotel(hotelId) {
  return apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`, false);
}

/** Создать отель (провайдер/админ) */
export function createHotel(payload) {
  return apiPost(`/api/hotels`, payload, "provider");
}

/** Обновить отель (провайдер/админ) */
export function updateHotel(hotelId, payload) {
  return apiPut(`/api/hotels/${encodeURIComponent(hotelId)}`, payload, "provider");
}

/** Создать обзор/инспекцию отеля. Поддерживает JSON и FormData с фото/видео. */
export async function createInspection(hotelId, payload) {
  const url = `/api/hotels/${encodeURIComponent(hotelId)}/inspections`;

  if (payload instanceof FormData) {
    const res = await fetch(buildUrl(url), {
      method: "POST",
      headers: getAuthHeaders(null),
      body: payload,
      credentials: "include",
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data || {};
      err.code = data?.error || data?.code;
      throw err;
    }

    return data || {};
  }

  return apiPost(url, payload, true);
}

/** Список инспекций (публично). sort: "top" | "new" */
export function listInspections(hotelId, { sort = "top" } = {}) {
  return apiGet(
    `/api/hotels/${encodeURIComponent(hotelId)}/inspections?sort=${encodeURIComponent(sort)}`,
    false
  );
}

/** Лайк инспекции (auto-роль: подойдёт любой доступный токен) */
export function likeInspection(inspectionId) {
  return apiPost(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/like`, {}, true);
}
