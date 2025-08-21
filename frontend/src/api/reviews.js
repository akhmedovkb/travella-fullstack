// frontend/src/api/reviews.js
import { apiGet, apiPost } from "../api";

/** Нормализация ответа бэка в единый формат */
function normalize(res) {
  // поддержка обоих вариантов: {stats,items} или {avg,count,items}
  const avg   = Number(res?.stats?.avg ?? res?.avg ?? 0) || 0;
  const count = Number(res?.stats?.count ?? res?.count ?? 0) || 0;
  const items = Array.isArray(res?.items) ? res.items : [];
  return { stats: { avg, count }, items };
}

/** ===== Provider ===== */
export async function getProviderReviews(providerId, { limit = 10, offset = 0 } = {}) {
  const res = await apiGet(`/api/reviews/provider/${providerId}?limit=${limit}&offset=${offset}`);
  return normalize(res);
}
export async function addProviderReview(providerId, { rating, text, booking_id } = {}) {
  return apiPost(`/api/reviews/provider/${providerId}`, { rating, text, booking_id });
}

/** ===== Service ===== */
export async function getServiceReviews(serviceId, { limit = 10, offset = 0 } = {}) {
  const res = await apiGet(`/api/reviews/service/${serviceId}?limit=${limit}&offset=${offset}`);
  return normalize(res);
}
export async function addServiceReview(serviceId, { rating, text, booking_id } = {}) {
  return apiPost(`/api/reviews/service/${serviceId}`, { rating, text, booking_id });
}

/** ===== Client ===== */
export async function getClientReviews(clientId, { limit = 10, offset = 0 } = {}) {
  const res = await apiGet(`/api/reviews/client/${clientId}?limit=${limit}&offset=${offset}`);
  return normalize(res);
}
export async function addClientReview(clientId, { rating, text, booking_id } = {}) {
  return apiPost(`/api/reviews/client/${clientId}`, { rating, text, booking_id });
}
