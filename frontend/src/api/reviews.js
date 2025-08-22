// frontend/src/api/reviews.js
import { apiGet, apiPost } from "../api";

/* ----- Provider target ----- */
export const getProviderReviews = (providerId, { limit = 20, offset = 0 } = {}) =>
  apiGet(`/api/reviews/provider/${providerId}?limit=${limit}&offset=${offset}`);

export const addProviderReview = (providerId, body) =>
  apiPost(`/api/reviews/provider/${providerId}`, body);

/* ----- (на будущее) Service & Client ----- */
export const getServiceReviews = (serviceId, { limit = 20, offset = 0 } = {}) =>
  apiGet(`/api/reviews/service/${serviceId}?limit=${limit}&offset=${offset}`);

export const addServiceReview = (serviceId, body) =>
  apiPost(`/api/reviews/service/${serviceId}`, body);

export const getClientReviews = (clientId, { limit = 20, offset = 0 } = {}) =>
  apiGet(`/api/reviews/client/${clientId}?limit=${limit}&offset=${offset}`);

export const addClientReview = (clientId, body) =>
  apiPost(`/api/reviews/client/${clientId}`, body);
