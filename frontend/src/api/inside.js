// frontend/src/api/inside.js
import { apiGet, apiPost, apiPut } from "../api";

export const listParticipants = (params = {}) =>
  apiGet(`/api/inside/admin/participants${toQuery(params)}`);

export const createParticipant = (payload) =>
  apiPost(`/api/inside/admin/participants`, payload);

export const updateParticipant = (id, payload) =>
  apiPut(`/api/inside/admin/participants/${id}`, payload);

export const listCompletionRequests = (params = { status: "pending" }) =>
  apiGet(`/api/inside/admin/requests${toQuery(params)}`);

export const approveRequest = (id, next_chapter) =>
  apiPost(
    `/api/inside/admin/requests/${id}/approve`,
    next_chapter ? { next_chapter } : {}
  );

export const rejectRequest = (id) =>
  apiPost(`/api/inside/admin/requests/${id}/reject`, {});

// ---------- ГЛАВЫ (chapters) ----------

// список всех глав / расписания
export const listChapters = (params = {}) =>
  apiGet(`/api/inside/admin/chapters${toQuery(params)}`);

// создать / обновить главу по chapter_key
export const upsertChapter = (payload) =>
  apiPost(`/api/inside/admin/chapters`, payload);

// ---------- helper ----------

function toQuery(obj) {
  const q = new URLSearchParams();
  Object.entries(obj).forEach(
    ([k, v]) => v !== undefined && v !== null && q.append(k, v)
  );
  const s = q.toString();
  return s ? `?${s}` : "";
}
