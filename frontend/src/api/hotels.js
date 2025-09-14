// frontend/src/api/hotels.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

function authHeaders() {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Список/поиск отелей
export async function searchHotels({ name = "", city = "", page = 1, limit = 20 }) {
  const { data } = await axios.get(`${API_BASE}/api/hotels`, {
    params: { name, city, page, limit },
    headers: authHeaders(),
  });
  // подстраховка формата
  return Array.isArray(data?.items) ? data : { items: data || [], total: (data || []).length };
}

// Детали отеля
export async function getHotel(hotelId) {
  const { data } = await axios.get(`${API_BASE}/api/hotels/${hotelId}`, {
    headers: authHeaders(),
  });
  return data;
}

// Создание (админ)
export async function createHotel(payload) {
  const { data } = await axios.post(`${API_BASE}/api/admin/hotels`, payload, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return data;
}

// Инспекции
export async function listInspections(hotelId, { sort = "top", page = 1, limit = 20 } = {}) {
  const { data } = await axios.get(`${API_BASE}/api/hotels/${hotelId}/inspections`, {
    params: { sort, page, limit },
    headers: authHeaders(),
  });
  return Array.isArray(data?.items) ? data : { items: data || [], total: (data || []).length };
}

export async function createInspection(hotelId, payload) {
  const { data } = await axios.post(`${API_BASE}/api/hotels/${hotelId}/inspections`, payload, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return data;
}

export async function likeInspection(inspectionId) {
  const { data } = await axios.post(`${API_BASE}/api/hotel-inspections/${inspectionId}/like`, {}, {
    headers: authHeaders(),
  });
  return data;
}
