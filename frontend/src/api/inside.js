// frontend/src/api/inside.js
import { apiGet, apiPost, apiPut } from "../api"; // ← было "./index"

export const listParticipants = (params = {}) =>
  apiGet(`/api/admin/inside/participants${toQuery(params)}`);

export const createParticipant = (payload) =>
  apiPost(`/api/admin/inside/participants`, payload);

export const updateParticipant = (id, payload) =>
  apiPut(`/api/admin/inside/participants/${id}`, payload);

export const listCompletionRequests = (status = "pending") =>
  apiGet(`/api/admin/inside/requests?status=${encodeURIComponent(status)}`);

export const approveRequest = (id, next_chapter) =>
  apiPost(
    `/api/admin/inside/requests/${id}/approve`,
    next_chapter ? { next_chapter } : {}
  );

export const rejectRequest = (id) =>
  apiPost(`/api/admin/inside/requests/${id}/reject`, {});

function toQuery(obj) {
  const q = new URLSearchParams();
  Object.entries(obj).forEach(
    ([k, v]) => v !== undefined && v !== null && q.append(k, v)
  );
  const s = q.toString();
  return s ? `?${s}` : "";
}
