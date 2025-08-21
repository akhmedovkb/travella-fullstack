//frontend/src/api/reviews.js

import { apiGet, apiPost } from "../api";

export async function getProviderReviews(id, { limit = 10, offset = 0 } = {}) {
  return apiGet(`/api/reviews/provider/${id}?limit=${limit}&offset=${offset}`);
}
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
