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

export async function createReview({ target_type, target_id, rating, text, service_id, request_id }) {
  return apiPost("/api/reviews", {
    target_type,
    target_id,
    rating,
    text,
    service_id,
    request_id,
  });
}
