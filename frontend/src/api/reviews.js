// frontend/src/api/reviews.js
import { apiGet, apiPost } from "../api";

/** ===== READ ===== */

// провайдер: { stats: {avg, count}, items: [...] }
export async function getProviderReviews(providerId, { limit = 10, offset = 0 } = {}) {
  const res = await apiGet(`/api/reviews/provider/${providerId}?limit=${limit}&offset=${offset}`);
  if (res && res.stats) return res;
  // бэкап на случай старого формата
  return { stats: { avg: Number(res?.avg) || 0, count: Number(res?.count) || 0 }, items: res?.items || [] };
}

export async function getServiceReviews(serviceId, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/service/${serviceId}?limit=${limit}&offset=${offset}`);
}
export async function getClientReviews(clientId, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/client/${clientId}?limit=${limit}&offset=${offset}`);
}

/** ===== CREATE ===== */

// клиент И/ИЛИ провайдер → провайдеру
export const addProviderReview = (providerId, { rating, text, booking_id } = {}) =>
  apiPost(`/api/reviews/provider/${providerId}`, { rating, text, booking_id });

// используется формой отзыва об услуге (клиент → услуге)
export const createServiceReview = (serviceId, { rating, text, request_id, booking_id } = {}) =>
  apiPost(`/api/reviews/service/${serviceId}`, {
    rating,
    text,
    booking_id: booking_id ?? request_id ?? undefined,
  });

// используется формой отзыва о клиенте (провайдер → клиенту)
export const createClientReview = (clientId, { rating, text, service_id, request_id, booking_id } = {}) =>
  apiPost(`/api/reviews/client/${clientId}`, {
    rating,
    text,
    booking_id: booking_id ?? request_id ?? undefined,
    service_id: service_id ?? undefined,
  });
