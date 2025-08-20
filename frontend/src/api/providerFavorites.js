// frontend/src/api/providerFavorites.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

// Собираем заголовок авторизации: token || providerToken
function authConfig() {
  const token =
    localStorage.getItem("token") || localStorage.getItem("providerToken");
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers };
}

// Приводим ошибку axios к единому формату: err.status, err.data, err.message
function normalizeAxiosError(e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const message =
    data?.error || data?.message || e?.message || "http_error";
  const err = new Error(message);
  err.status = status;
  err.data = data;
  throw err;
}

// Список избранного провайдера
export async function apiProviderFavorites() {
  try {
    const { data } = await axios.get(
      `${API_BASE}/api/providers/favorites`,
      authConfig()
    );
    // сервер может вернуть массив или объект с items
    return Array.isArray(data) ? data : (data?.items || []);
  } catch (e) {
    normalizeAxiosError(e);
  }
}

// Тоггл избранного (возвращаем единый формат для UI)
export async function apiToggleProviderFavorite(serviceId) {
  try {
    const { data } = await axios.post(
      `${API_BASE}/api/providers/favorites/toggle`,
      { service_id: serviceId },
      authConfig()
    );
    return { added: !!data?.added };
  } catch (e) {
    normalizeAxiosError(e);
  }
}

// Удаление из избранного
export async function apiRemoveProviderFavorite(serviceId) {
  try {
    await axios.delete(
      `${API_BASE}/api/providers/favorites/${serviceId}`,
      authConfig()
    );
    return true;
  } catch (e) {
    normalizeAxiosError(e);
  }
}
