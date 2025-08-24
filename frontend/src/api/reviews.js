// frontend/src/api/reviews.js
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL;

/* ---------- helpers ---------- */
function authHeaders() {
  const token =
    localStorage.getItem("token") ||           // провайдер
    localStorage.getItem("providerToken") ||   // провайдер (альт)
    localStorage.getItem("clientToken");       // клиент
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function throwAlreadyLeft() {
  const e = new Error("review_already_exists");
  e.code = "review_already_exists";
  throw e;
}

// 409 → нормализуем в e.code="review_already_exists"
function rethrowConflict(err) {
  if (err?.response?.status === 409 && err?.response?.data?.error === "review_already_exists") {
    throwAlreadyLeft();
  }
  throw err;
}

// На случай когда сервер по ошибке вернёт 200/201 с { error: "review_already_exists" }
function assertNoAlreadyLeft(res) {
  const key = res?.data?.error || res?.data?.code || null;
  if (key === "review_already_exists") throwAlreadyLeft();
}

// Универсальный POST для отзывов
async function postReview(url, body) {
  try {
    const res = await axios.post(url, body, { headers: authHeaders() });
    assertNoAlreadyLeft(res);
    return res.data;
  } catch (err) {
    rethrowConflict(err);
  }
}

/* ---------- PROVIDER ---------- */
export async function getProviderReviews(providerId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/provider/${providerId}`, {
    params: { limit, offset },
  });
  return data; // { items, stats:{count,avg} }
}

export function addProviderReview(providerId, { rating, text, booking_id }) {
  return postReview(`${API}/api/reviews/provider/${providerId}`, { rating, text, booking_id });
}

/* ---------- CLIENT ---------- */
export async function getClientReviews(clientId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/client/${clientId}`, {
    params: { limit, offset },
  });
  return data;
}

export function addClientReview(clientId, { rating, text, booking_id }) {
  return postReview(`${API}/api/reviews/client/${clientId}`, { rating, text, booking_id });
}

/* ---------- SERVICE (если используете) ---------- */
export async function getServiceReviews(serviceId, { limit = 20, offset = 0 } = {}) {
  const { data } = await axios.get(`${API}/api/reviews/service/${serviceId}`, {
    params: { limit, offset },
  });
  return data;
}

export function addServiceReview(serviceId, { rating, text, booking_id }) {
  return postReview(`${API}/api/reviews/service/${serviceId}`, { rating, text, booking_id });
}
