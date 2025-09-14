// frontend/src/api/hotels.js
import { apiGet, apiPost } from "../api";

/** Поиск отелей (доступно всем) */
// Поиск отелей (доступно всем)
// бек ждёт ?query=..., но поддержим старые name/city на всякий случай
export async function searchHotels({ name = "", city = "", country = "", page = 1, limit = 20 } = {}) {
  const q = new URLSearchParams({
    name: name || "",
    city: city || "",
    country: country || "",
    page: String(page),
    limit: String(limit),
  });
  return apiGet(`/api/hotels/search?${q.toString()}`);
}

/** Получить карточку отеля (доступно всем) */
export async function getHotel(hotelId) {
  return apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`);
}

/** Создать новый отель (требует прав провайдера/админа) */
export async function createHotel(payload) {
  // бек проверит, что это админ/модератор — на фронте просто шлём от провайдера
  return apiPost(`/api/hotels`, payload, "provider");
}

/** Создать инспекцию к отелю (только провайдер) */
export async function createInspection(hotelId, payload) {
  return apiPost(`/api/hotels/${encodeURIComponent(hotelId)}/inspections`, payload, "provider");
}

/** Список инспекций (доступно всем). sort: "top" | "new" */
export async function listInspections(hotelId, { sort = "top" } = {}) {
  const q = new URLSearchParams({ sort });
  return apiGet(`/api/hotels/${encodeURIComponent(hotelId)}/inspections?${q.toString()}`);
}

/** Лайк инспекции (любая авторизованная сторона) */
export async function likeInspection(inspectionId) {
  // попытаемся определить, кто залогинен, чтобы прокинуть корректный токен
  const hasProvider = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
  const hasClient = !!localStorage.getItem("clientToken");
  const role = hasProvider ? "provider" : hasClient ? true : undefined;
  return apiPost(`/api/hotel-inspections/${encodeURIComponent(inspectionId)}/like`, {}, role);
}
