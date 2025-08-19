// frontend/src/api/providerFavorites.js
import axios from "axios";
import { toast } from "react-toastify";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

function authConfig() {
  const token = localStorage.getItem("token");
  return { headers: { Authorization: `Bearer ${token}` } };
}

const pickServerMessage = (err) =>
  err?.response?.data?.message || err?.message || "Ошибка запроса";

export async function apiProviderFavorites() {
  try {
    const { data } = await axios.get(`${API_BASE}/api/providers/favorites`, authConfig());
    return Array.isArray(data) ? data : [];
  } catch (err) {
    toast.error(pickServerMessage(err));
    return [];
  }
}

export async function apiToggleProviderFavorite(serviceId) {
  try {
    const { data } = await axios.post(
      `${API_BASE}/api/providers/favorites/toggle`,
      { service_id: serviceId },
      authConfig()
    );
    if (data?.added) {
      toast.success("Добавлено в избранное");
      return true;
    } else {
      toast.info("Убрано из избранного");
      return false;
    }
  } catch (err) {
    toast.error(pickServerMessage(err));
    return null;
  }
}

export async function apiRemoveProviderFavorite(serviceId) {
  try {
    await axios.delete(`${API_BASE}/api/providers/favorites/${serviceId}`, authConfig());
    toast.success("Удалено из избранного");
    return true;
  } catch (err) {
    toast.error(pickServerMessage(err));
    return false;
  }
}
