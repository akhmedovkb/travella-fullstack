//frontend/src/api/reviews.js

import { apiGet, apiPost } from "../api";

export async function getProviderReviews(id, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/provider/${id}?limit=${limit}&offset=${offset}`);
}
const res = await getProviderReviews(id, { limit, offset });
setStats(res?.stats || { count: 0, avg: 0 });
setItems(Array.isArray(res?.items) ? res.items : []);

export const addProviderReview = async (providerId, body) =>
  apiPost(`/api/reviews/provider/${providerId}`, body); // если бэкенд принимает POST /provider/:id

export async function getClientReviews(id, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/client/${id}?limit=${limit}&offset=${offset}`);
}
export async function getServiceReviews(id, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/service/${id}?limit=${limit}&offset=${offset}`);
}

// 🔹 клиент → провайдер: оставляет отзыв по конкретной услуге
export async function createServiceReview(serviceId, { rating, text, request_id } = {}) {
  return apiPost(`/api/reviews/service/${serviceId}`, {
    rating,
    text,
    request_id, // если хочешь связать с заявкой
  });
}

// 🔹 провайдер → клиент
export async function createClientReview(clientId, { rating, text, service_id, request_id } = {}) {
  return apiPost(`/api/reviews/client/${clientId}`, {
    rating,
    text,
    service_id, // опционально, чтобы хранить связь
    request_id, // опционально
  });
}
