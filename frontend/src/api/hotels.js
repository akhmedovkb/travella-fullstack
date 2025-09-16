// frontend/src/api/hotels.js
import { apiGet, apiPost, apiPut } from "../api";

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
  qs.set("ext", "0");              // ← только локальная БД
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

/** Создать инспекцию (провайдер/админ) */
export function createInspection(hotelId, payload) {
  return apiPost(`/api/hotels/${encodeURIComponent(hotelId)}/inspections`, payload, "provider");
}

/** Список инспекций (публично). sort: "top" | "new" */
export function listInspections(hotelId, { sort = "top" } = {}) {
  return apiGet(`/api/hotels/${encodeURIComponent(hotelId)}/inspections?sort=${encodeURIComponent(sort)}`, false);
}

/** Лайк инспекции (auto-роль: подойдёт любой доступный токен) */
export function likeInspection(inspectionId) {
  // withAuthOrRole=true — возьмётся любой доступный токен (client/provider)
  return apiPost(`/api/hotel-inspections/${encodeURIComponent(inspectionId)}/like`, {}, true);
}
