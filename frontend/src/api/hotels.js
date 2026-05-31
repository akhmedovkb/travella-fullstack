// frontend/src/api/hotels.js
import { apiGet, apiPost, apiPut, buildUrl, getAuthHeaders } from "../api";

function appendInspectionFilters(qs, filters = {}) {
  if (filters.sort) qs.set("sort", filters.sort);
  if (filters.city) qs.set("city", filters.city);
  if (filters.month) qs.set("month", String(filters.month));
  if (filters.audience) qs.set("audience", filters.audience);
  if (filters.visit_type || filters.visitType) qs.set("visit_type", filters.visit_type || filters.visitType);
  if (filters.min_score || filters.minScore) qs.set("min_score", String(filters.min_score || filters.minScore));
  if (filters.has_media || filters.hasMedia) qs.set("has_media", "1");
  return qs;
}

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
    let res;
    try {
      res = await fetch(buildUrl(url), {
        method: "POST",
        headers: getAuthHeaders("provider"),
        body: payload,
        credentials: "include",
      });
    } catch (err) {
      const e = new Error(
        "Не удалось отправить инспекцию. Проверьте размер фото/видео и соединение. Если загружаете видео, попробуйте уменьшить файл."
      );
      e.code = "network_upload_failed";
      e.cause = err;
      throw e;
    }

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

/** Список инспекций конкретного отеля. sort: "top" | "new" | "score" */
export function listInspections(hotelId, filters = {}) {
  const qs = appendInspectionFilters(new URLSearchParams(), filters);
  if (!qs.has("sort")) qs.set("sort", "top");
  return apiGet(`/api/hotels/${encodeURIComponent(hotelId)}/inspections?${qs.toString()}`, false);
}

/** Общая лента инспекций по всем отелям с фильтрами. */
export function listAllInspections(filters = {}) {
  const qs = appendInspectionFilters(new URLSearchParams(), filters);
  if (!qs.has("sort")) qs.set("sort", "top");
  return apiGet(`/api/hotels/inspections?${qs.toString()}`, false);
}

/** Лайк инспекции (auto-роль: подойдёт любой доступный токен) */
export function likeInspection(inspectionId) {
  return apiPost(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/like`, {}, true);
}

/** Комментарии к инспекции. */
export function listInspectionComments(inspectionId) {
  return apiGet(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/comments`, false);
}

/** Добавить комментарий к инспекции. */
export function createInspectionComment(inspectionId, text) {
  return apiPost(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/comments`, { text }, true);
}


/** Обновить свою инспекцию или модерировать её админом. */
export function updateInspection(inspectionId, payload) {
  return apiPut(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}`, payload, true);
}

/** Мягко удалить/скрыть свою инспекцию. */
export async function deleteInspection(inspectionId) {
  const res = await fetch(buildUrl(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}`), {
    method: "DELETE",
    headers: getAuthHeaders(true),
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error || data?.message || res.statusText || `HTTP ${res.status}`);
  return data;
}

/** Админ-модерация инспекции. */
export function moderateInspection(inspectionId, payload) {
  return apiPut(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/moderation`, payload, "admin");
}

/** Жалоба на инспекцию. */
export function reportInspection(inspectionId, payload = {}) {
  return apiPost(`/api/hotels/inspections/${encodeURIComponent(inspectionId)}/report`, payload, true);
}

/** Модерация комментария инспекции. */
export function moderateInspectionComment(commentId, payload) {
  return apiPut(`/api/hotels/inspections/comments/${encodeURIComponent(commentId)}/moderation`, payload, "admin");
}

/** Жалоба на комментарий инспекции. */
export function reportInspectionComment(commentId, payload = {}) {
  return apiPost(`/api/hotels/inspections/comments/${encodeURIComponent(commentId)}/report`, payload, true);
}
