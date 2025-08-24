// frontend/src/api/reviews.js
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL;

function authHeaders() {
  const token =
    localStorage.getItem("token") ||           // провайдер
    localStorage.getItem("providerToken") ||   // провайдер (альт)
    localStorage.getItem("clientToken");       // клиент
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function rethrowConflict(err) {
  if (err?.response?.status === 409 && err?.response?.data?.error === "review_already_exists") {
    const e = new Error("review_already_exists");
    e.code = "review_already_exists";
    throw e;
  }
  throw err;
}

/* ---------- PROVIDER ---------- */
export async function getProviderReviews(providerId) {
  const { data } = await axios.get(`${API}/api/reviews/provider/${providerId}`);
  return data; // { items, stats:{count,avg} }
}
export async function addProviderReview(providerId, { rating, text, booking_id }) {
  try {
    const { data } = await axios.post(
      `${API}/api/reviews/provider/${providerId}`,
      { rating, text, booking_id },
      { headers: authHeaders() }
    );
    return data;
  } catch (err) {
    rethrowConflict(err);
  }
}

/* ---------- CLIENT ---------- */
export async function getClientReviews(clientId) {
  const { data } = await axios.get(`${API}/api/reviews/client/${clientId}`);
  return data;
}
export async function addClientReview(clientId, { rating, text, booking_id }) {
  try {
    const { data } = await axios.post(
      `${API}/api/reviews/client/${clientId}`,
      { rating, text, booking_id },
      { headers: authHeaders() }
    );
    return data;
  } catch (err) {
    rethrowConflict(err);
  }
}

/* ---------- SERVICE (если используете) ---------- */
export async function getServiceReviews(serviceId) {
  const { data } = await axios.get(`${API}/api/reviews/service/${serviceId}`);
  return data;
}
export async function addServiceReview(serviceId, { rating, text, booking_id }) {
  try {
    const { data } = await axios.post(
      `${API}/api/reviews/service/${serviceId}`,
      { rating, text, booking_id },
      { headers: authHeaders() }
    );
    return data;
  } catch (err) {
    rethrowConflict(err);
  }
}
