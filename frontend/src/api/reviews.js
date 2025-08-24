// frontend/src/api/reviews.js
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL;

/* helpers */
function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function throwAlreadyLeft() {
  const e = new Error("review_already_exists");
  e.code = "review_already_exists";
  throw e;
}
function assertNoAlreadyLeft(res) {
  const key = res?.data?.error || res?.data?.code || null;
  if (key === "review_already_exists") throwAlreadyLeft();
}

/** Универсальный POST для отзывов: не даём axios самому кидать 409,
 *  сами нормализуем ошибки, чтобы UI всегда ловил e.code. */
async function postReview(url, body) {
  const res = await axios.post(url, body, {
    headers: authHeaders(),
    validateStatus: () => true, // 👈 важное место
  });

  // 1) дубль-отзыв
  if (res.status === 409) throwAlreadyLeft();
  // 2) сервер вернул 2xx, но с { error: "review_already_exists" }
  assertNoAlreadyLeft(res);
  // 3) успех
  if (res.status >= 200 && res.status < 300) return res.data;

  // 4) остальные ошибки — пробрасываем с response
  const err = new Error("request_failed");
  err.response = res;
  throw err;
}

/* ----- Provider target ----- */
export async function getProviderReviews(providerId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/provider/${providerId}`, {
    params: { limit, offset },
  });
  return data;
}
export function addProviderReview(providerId, { rating, text, booking_id }) {
  return postReview(`${API}/api/reviews/provider/${providerId}`, { rating, text, booking_id });
}

/* ----- Client target ----- */
export async function getClientReviews(clientId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/client/${clientId}`, {
    params: { limit, offset },
  });
  return data;
}
export function addClientReview(clientId, { rating, text, booking_id }) {
  return postReview(`${API}/api/reviews/client/${clientId}`, { rating, text, booking_id });
}

/* ----- Service target (если используете) ----- */
export async function getServiceReviews(serviceId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/service/${serviceId}`, {
    params: { limit, offset },
  });
  return data;
}
export func
