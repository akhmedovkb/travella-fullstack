// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useState, useRef } from "react";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import ProviderStatsHeader from "../components/ProviderStatsHeader";
import ProviderReviews from "../components/ProviderReviews";
import ProviderInboxList from "../components/ProviderInboxList";
import { tSuccess, tError, tInfo, tWarn } from "../shared/toast";

// NEW: избранное провайдера
import {
  apiProviderFavorites,
  apiToggleProviderFavorite,
  apiRemoveProviderFavorite,
} from "../api/providerFavorites";

/** ================= Helpers ================= */
async function resizeImageFile(file, maxSide = 1600, quality = 0.85, mime = "image/jpeg") {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });

  const iw = img.width, ih = img.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(mime, quality);
}

/* ===== Доп. полезные хелперы для очистки и «От кого» ===== */
const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};
const clientCache = new Map();

// NEW: локализованный “первый подходящий перевод”
function makeTr(t) {
  return function tr(keys, fallback = "") {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const v = t(k, { defaultValue: "" });
      if (v) return v;
    }
    return fallback;
  };
}

// NEW: извлекаем сообщение сервера (если есть)
const pickServerMessage = (err) =>
  err?.response?.data?.message || err?.message || "";

// NEW: единая обертка для ошибок API
function toastApiError(t, err, keys, fallback) {
  const tr = makeTr(t);
  const msg = pickServerMessage(err) || tr(keys, fallback);
  toast.error(msg);
}

// NEW: сахара для success/info/warn
function toastSuccessT(t, keys, fallback) { toast.success(makeTr(t)(keys, fallback)); }
function toastInfoT(t, keys, fallback)    { toast.info(makeTr(t)(keys, fallback)); }
function toastWarnT(t, keys, fallback)    { toast.warn(makeTr(t)(keys, fallback)); }

function resolveExpireAtFromService(service) {
  const s = service || {};
  const d = s.details || {};
  const cand = firstNonEmpty(
    s.expires_at, s.expire_at, s.expireAt, s.expiration, s.expiration_at, s.expirationAt,
    d.expires_at, d.expire_at, d.expiresAt, d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs
  );
  if (cand) {
    const ts = typeof cand === "number" ? (cand > 1e12 ? cand : cand * 1000) : Date.parse(String(cand));
    if (Number.isFinite(ts)) return ts;
  }
  const dates = [
    d.hotel_check_out, d.endFlightDate, d.returnDate, d.end_flight_date,
    s.hotel_check_out, s.endFlightDate, s.returnDate, s.end_flight_date,
  ].filter(Boolean);
  for (const v of dates) {
    const ts = Date.parse(v);
    if (!Number.isNaN(ts)) return ts;
  }
  const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? s.ttlHours;
  if (ttl) {
    const created = Date.parse(d.created_at || s.created_at || s.createdAt);
    if (!Number.isNaN(created)) return created + Number(ttl) * 3600 * 1000;
  }
  return null;
}
function resolveExpireAtFromRequest(req) {
  const cand = firstNonEmpty(
    req?.expires_at, req?.expire_at, req?.expireAt, req?.expiration, req?.expiration_at, req?.expirationAt
  );
  if (cand) {
    const ts = typeof cand === "number" ? (cand > 1e12 ? cand : cand * 1000) : Date.parse(String(cand));
    if (Number.isFinite(ts)) return ts;
  }
  return resolveExpireAtFromService(req?.service);
}
const isExpiredRequest = (req, now = Date.now()) => {
  const ts = resolveExpireAtFromRequest(req);
  return ts ? now > ts : false;
};

/** Редактор изображений (DnD сортировка, удалить, очистить, обложка) */
function ImagesEditor({
  images,
  onUpload,
  onRemove,
  onReorder,
  onClear,
  dragItem,
  dragOverItem,
  onMakeCover,
  t,
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold">
          {t("service_images", { defaultValue: "Фото услуги" })}
        </h4>
        {!!images?.length && (
          <button
            type="button"
            className="text-sm text-red-600 hover:underline"
            onClick={() => {
              if (confirm(t("clear_all_images_confirm", { defaultValue: "Удалить все изображения?" }))) {
                onClear?.();
              }
            }}
          >
            {t("clear_all", { defaultValue: "Очистить всё" })}
          </button>
        )}
      </div>

      {images?.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((src, idx) => (
            <div
              key={idx}
              className="relative group border rounded overflow-hidden bg-gray-50"
              draggable
              onDragStart={() => (dragItem.current = idx)}
              onDragEnter={() => (dragOverItem.current = idx)}
              onDragEnd={onReorder}
              onDragOver={(e) => e.preventDefault()}
              title={t("drag_to_reorder", { defaultValue: "Перетащите, чтобы поменять порядок" })}
            >
              <img src={src} alt="" className="w-full h-32 object-cover" />
              <div className="absolute top-1 right-1 flex gap-1">
                {onMakeCover && (
                  <button
                    type="button"
                    className="bg-white/90 border rounded px-2 py-0.5 text-xs shadow hidden group-hover:block"
                    onClick={() => onMakeCover(idx)}
                    title={t("make_cover", { defaultValue: "Сделать обложкой" })}
                  >
                    ★
                  </button>
                )}
                <button
                  type="button"
                  className="bg-white/90 border rounded px-2 py-0.5 text-xs shadow hidden group-hover:block"
                  onClick={() => onRemove(idx)}
                >
                  {t("delete", { defaultValue: "Удалить" })}
                </button>
              </div>
              {idx === 0 && (
                <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 bg-white/90 rounded shadow">
                  {t("cover", { defaultValue: "Обложка" })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 mb-2">
          {t("no_images_yet", { defaultValue: "Изображений пока нет" })}
        </div>
      )}

      <div className="mt-3">
        <label className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
          <input type="file" accept="image/*" multiple onChange={onUpload} className="hidden" />
          {t("choose_files", { defaultValue: "Выбрать файлы" })}
        </label>
        <div className="text-xs text-gray-500 mt-1">
          {t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })}
        </div>
      </div>
    </div>
  );
}

// --- min для date / datetime-local (локальное время)
const pad = (n) => String(n).padStart(2, "0");
const todayLocalDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const nowLocalDateTime = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DATE_MIN = todayLocalDate();
const DATETIME_MIN = nowLocalDateTime();

/** ================= Main ================= */
const Dashboard = () => {
  const { t } = useTranslation();

  // Profile
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newCertificate, setNewCertificate] = useState(null);
  const [newAddress, setNewAddress] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stats, setStats] = useState(null);

  // Services
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);

  // Common fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]); // Date[]
  const [images, setImages] = useState([]); // string[]

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Calendar (guide/transport)
  const [bookedDates, setBookedDates] = useState([]);  // Date[]
  const [blockedDates, setBlockedDates] = useState([]); // Date[]
  const [saving, setSaving] = useState(false);

  // Delete service modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState(null);

  // Geography
  const [countryOptions, setCountryOptions] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [departureCity, setDepartureCity] = useState(null);
  const [cityOptionsFrom, setCityOptionsFrom] = useState([]);
  const [cityOptionsTo, setCityOptionsTo] = useState([]);

  // Details for agent categories
  const [details, setDetails] = useState({
    grossPrice: "",
    direction: "",
    directionCountry: "",
    directionFrom: "",
    directionTo: "",
    startDate: "",
    endDate: "",
    hotel: "",
    accommodation: "",
    accommodationCategory: "",
    adt: "",
    chd: "",
    inf: "",
    food: "",
    halal: false,
    transfer: "",
    changeable: false,
    visaIncluded: false,
    netPrice: "",
    expiration: "",
    isActive: true,
    // flight
    flightType: "one_way",
    oneWay: true,
    airline: "",
    returnDate: "",
    startFlightDate: "",
    endFlightDate: "",
    flightDetails: "",
    flightDetailsText: "",
    // event
    location: "",
    eventName: "",
    eventCategory: "",
    ticketDetails: "",
    // visa
    description: "",
    visaCountry: "",
  });

  // Inbox / Bookings (как было)
  const [requestsInbox, setRequestsInbox] = useState([]);
  const [bookingsInbox, setBookingsInbox] = useState([]);
  const [proposalForms, setProposalForms] = useState({});
  const [loadingInbox, setLoadingInbox] = useState(false);

  // NEW: нижние табы (горизонтальная линия): requests | favorites | bookings
  const [bottomTab, setBottomTab] = useState("requests");

  // NEW: избранное поставщика
  const [pfavs, setPfavs] = useState([]);
  const [loadingFavs, setLoadingFavs] = useState(false);

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  /** ===== Utils ===== */
  const isServiceActive = (s) => !s.details?.expiration || new Date(s.details.expiration) > new Date();
  const toDate = (v) => (v ? (v instanceof Date ? v : new Date(v)) : undefined);

  /** ===== API helpers ===== */
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  // Глобальные хелперы для ProviderInboxList: очистка и «От кого»
  useEffect(() => {
    window.__providerCleanupExpired = async () => {
      const urls = [
        `${API_BASE}/api/provider/cleanup-expired`,
        `${API_BASE}/api/providers/cleanup-expired`,
        `${API_BASE}/api/requests/cleanup`,
        `${API_BASE}/api/cleanup/requests`,
        `${API_BASE}/api/requests/purgeExpired`,
      ];
      for (const url of urls) {
        try { await axios.post(url, {}, config); return true; } catch { /* try next */ }
      }
      return false;
    };

    window.__providerClientNameResolver = async (req) => {
      const embedded = req?.client || req?.customer || req?.from || req?.sender || req?.created_by || {};
      const inline = firstNonEmpty(
        embedded?.name, embedded?.title, embedded?.display_name, embedded?.company_name,
        req?.client_name, req?.from_name, req?.sender_name
      );
      if (inline) return inline;

      const id =
        req?.client_id || req?.clientId ||
        req?.customer_id || req?.customerId ||
        req?.user_id || req?.created_by_id;

      if (!id) return "—";
      if (clientCache.has(id)) {
        const cached = clientCache.get(id);
        return cached || "—";
      }

      const endpoints = [
        `${API_BASE}/api/clients/${id}`,
        `${API_BASE}/api/client/${id}`,
        `${API_BASE}/api/users/${id}`,
        `${API_BASE}/api/user/${id}`,
        `${API_BASE}/api/customers/${id}`,
        `${API_BASE}/api/customer/${id}`,
      ];
      for (const url of endpoints) {
        try {
          const res = await axios.get(url, config);
          const obj = res.data?.data || res.data?.item || res.data?.profile || res.data?.client || res.data?.user || res.data?.customer || res.data;
          const name = firstNonEmpty(obj?.name, obj?.title, obj?.display_name, obj?.company_name);
          if (name) { clientCache.set(id, name); return name; }
        } catch {}
      }
      clientCache.set(id, null);
      return "—";
    };

    return () => {
      delete window.__providerCleanupExpired;
      delete window.__providerClientNameResolver;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, token]);

  const loadHotelOptions = async (inputValue) => {
    try {
      const res = await axios.get(
        `${API_BASE}/api/hotels/search?query=${encodeURIComponent(inputValue || "")}`
      );
      return (res.data || []).map((x) => ({ value: x.label || x.name || x, label: x.label || x.name || x }));
    } catch (err) {
      console.error("Ошибка загрузки отелей:", err);
      toast.error(t("hotels_load_error") || "Не удалось загрузить отели");
      return [];
    }
  };

  const loadDepartureCities = async (inputValue) => {
    if (!inputValue) return [];
    try {
      const response = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          name_startsWith: inputValue,
          featureClass: "P",
          maxRows: 10,
          username: import.meta.env.VITE_GEONAMES_USERNAME,
        },
      });
      return response.data.geonames.map((city) => ({
        value: city.name,
        label: `${city.name}, ${city.countryName}`,
      }));
    } catch (error) {
      console.error("Ошибка загрузки городов:", error);
      return [];
    }
  };

  const loadCitiesFromInput = async (inputValue) => {
    if (!inputValue) return [];
    try {
      const response = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          name_startsWith: inputValue,
          featureClass: "P",
          maxRows: 10,
          username: import.meta.env.VITE_GEONAMES_USERNAME,
        },
      });
      return response.data.geonames.map((city) => ({
        value: city.name,
        label: `${city.name}, ${city.countryName}`,
      }));
    } catch (error) {
      console.error("Ошибка загрузки городов:", error);
      return [];
    }
  };

  /** ===== Images handlers ===== */
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const freeSlots = Math.max(0, 10 - images.length);
    const toProcess = files.slice(0, freeSlots);

    const processed = [];
    for (const f of toProcess) {
      if (f.size > 6 * 1024 * 1024) continue;
      try {
        const dataUrl = await resizeImageFile(f, 1600, 0.85, "image/jpeg");
        processed.push(dataUrl);
      } catch {}
    }

    if (processed.length) {
      setImages((prev) => [...prev, ...processed]);
    }
    e.target.value = "";
  };

  const handleRemoveImage = (index) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleReorderImages = () => {
    if (dragItem.current == null || dragOverItem.current == null) return;
    setImages((prev) => {
      const copy = [...prev];
      const [m] = copy.splice(dragItem.current, 1);
      copy.splice(dragOverItem.current, 0, m);
      return copy;
    });
    dragItem.current = dragOverItem.current = null;
  };

  const handleClearImages = () => setImages([]);
  const makeCover = (idx) => {
    setImages((prev) => {
      const copy = [...prev];
      const [cover] = copy.splice(idx, 1);
      copy.unshift(cover);
      return copy;
    });
  };

  /** ===== Calendar save ===== */
  const handleSaveBlockedDates = async () => {
    if (!Array.isArray(blockedDates)) return;
    setSaving(true);
    try {
      const payload = blockedDates.map((d) =>
        typeof d === "string" ? d : new Date(d).toISOString().split("T")[0]
      );
      await axios.post(`${API_BASE}/api/providers/blocked-dates`, { dates: payload }, config);
      toast.success(t("calendar.saved_successfully") || "Даты сохранены");
    } catch (err) {
      console.error("Ошибка сохранения дат", err);
      const msg = err?.response?.data?.message || t("calendar.save_error") || "Ошибка сохранения дат";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /** ===== Delete service modal ===== */
  const confirmDeleteService = (id) => {
    setServiceToDelete(id);
    setDeleteConfirmOpen(true);
  };
  const handleConfirmDelete = () => {
    if (!serviceToDelete) return;
    axios
      .delete(`${API_BASE}/api/providers/services/${serviceToDelete}`, config)
      .then(() => {
        setServices((prev) => prev.filter((s) => s.id !== serviceToDelete));
        if (selectedService?.id === serviceToDelete) setSelectedService(null);
        toast.success(t("service_deleted", { defaultValue: "Услуга удалена" }));
      })
      .catch((err) => {
        console.error("Ошибка удаления услуги", err);
        toast.error(t("delete_error", { defaultValue: "Ошибка удаления услуги" }));
      })
      .finally(() => {
        setDeleteConfirmOpen(false);
        setServiceToDelete(null);
      });
  };

  /** ===== Load dictionaries ===== */
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await axios.get("https://restcountries.com/v3.1/all?fields=name,cca2");
        const countries = response.data.map((country) => ({
          value: country.name.common,
          label: country.name.common,
          code: country.cca2,
        }));
        setCountryOptions(countries.sort((a, b) => a.label.localeCompare(b.label)));
      } catch (error) {
        console.error("Ошибка загрузки стран:", error);
      }
    };
    fetchCountries();
  }, []);

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const response = await axios.get("https://secure.geonames.org/searchJSON", {
          params: {
            featureClass: "P",
            maxRows: 100,
            orderby: "population",
            username: import.meta.env.VITE_GEONAMES_USERNAME,
          },
        });
        const cities = response.data.geonames.map((city) => ({
          value: city.name,
          label: city.name,
        }));
        setCityOptionsFrom(cities);
      } catch (error) {
        console.error("Ошибка загрузки городов отправления:", error);
      }
    };
    fetchCities();
  }, []);

  useEffect(() => {
    if (!selectedCountry?.code) return;
    const fetchCities = async () => {
      try {
        const response = await axios.get("https://secure.geonames.org/searchJSON", {
          params: {
            country: selectedCountry.code,
            featureClass: "P",
            maxRows: 100,
            username: import.meta.env.VITE_GEONAMES_USERNAME,
          },
        });
        const cities = response.data.geonames.map((city) => ({
          value: city.name,
          label: city.name,
        }));
        setCityOptionsTo(cities);
      } catch (error) {
        console.error("Ошибка загрузки городов прибытия:", error);
      }
    };
    fetchCities();
  }, [selectedCountry]);

  /** ===== Load profile + services + stats ===== */
  useEffect(() => {
    axios
      .get(`${API_BASE}/api/providers/profile`, config)
      .then((res) => {
        setProfile(res.data || {});
        setNewLocation(res.data?.location || "");
        setNewSocial(res.data?.social || "");
        setNewPhone(res.data?.phone || "");
        setNewAddress(res.data?.address || "");

        if (["guide", "transport"].includes(res.data?.type)) {
          axios
            .get(`${API_BASE}/api/providers/booked-dates`, config)
            .then((response) => {
              const formatted = (response.data || []).map((item) => new Date(item.date || item));
              setBookedDates(formatted);
            })
            .catch((err) => {
              console.error("Ошибка загрузки занятых дат", err);
              toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
            });
        }
      })
      .catch((err) => {
        console.error("Ошибка загрузки профиля", err);
        toast.error(t("profile_load_error") || "Не удалось загрузить профиль");
      });

    axios
      .get(`${API_BASE}/api/providers/services`, config)
      .then((res) => setServices(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error("Ошибка загрузки услуг", err);
        toast.error(t("services_load_error") || "Не удалось загрузить услуги");
      });

    axios
      .get(`${API_BASE}/api/providers/stats`, config)
      .then((res) => setStats(res.data || {}))
      .catch(() => setStats({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Provider inbox loaders/actions ===== */
  const serverCleanupExpired = async () => {
    if (typeof window.__providerCleanupExpired === "function") {
      try { await window.__providerCleanupExpired(); } catch {}
    }
  };

  const refreshInbox = async () => {
    try {
      setLoadingInbox(true);
      await serverCleanupExpired();

      const [rq, bk] = await Promise.all([
        axios.get(`${API_BASE}/api/requests/provider`, config),
        axios.get(`${API_BASE}/api/bookings/provider`, config),
      ]);

      const now = Date.now();
      const reqs = Array.isArray(rq.data) ? rq.data : [];
      const filtered = reqs.filter((r) => !isExpiredRequest(r, now));

      setRequestsInbox(filtered);
      setBookingsInbox(Array.isArray(bk.data) ? bk.data : []);
    } catch (e) {
      console.error("Ошибка загрузки входящих/броней", e);
      const msg = e?.response?.data?.message || "Ошибка загрузки входящих";
      toast.error(msg);
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    if (token) refreshInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const changeProposalForm = (id, field, value) => {
    setProposalForms((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };
  const sendProposal = async (id) => {
    const body = proposalForms[id] || {};
    try {
      setLoadingInbox(true);
      await axios.post(`${API_BASE}/api/requests/${id}/proposal`, body, config);
      toast.success("Предложение отправлено");
      await refreshInbox();
    } catch (e) {
      console.error("Ошибка отправки предложения", e);
      const msg = e?.response?.data?.message || "Ошибка отправки предложения";
      toast.error(msg);
    } finally {
      setLoadingInbox(false);
    }
  };
  const confirmBooking = async (id) => {
    try {
      setLoadingInbox(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/confirm`, {}, config);
      toast.success("Бронь подтверждена");
      await refreshInbox();
    } catch (e) {
      console.error("Ошибка подтверждения", e);
      toast.error(e?.response?.data?.message || "Ошибка подтверждения");
    } finally {
      setLoadingInbox(false);
    }
  };
  const rejectBooking = async (id) => {
    try {
      setLoadingInbox(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/reject`, {}, config);
      toast.success("Бронь отклонена");
      await refreshInbox();
    } catch (e) {
      console.error("Ошибка отклонения", e);
      toast.error(e?.response?.data?.message || "Ошибка отклонения");
    } finally {
      setLoadingInbox(false);
    }
  };
  const cancelBooking = async (id) => {
    try {
      setLoadingInbox(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/cancel`, {}, config);
      toast.success("Бронь отменена");
      await refreshInbox();
    } catch (e) {
      console.error("Ошибка отмены", e);
      toast.error(e?.response?.data?.message || "Ошибка отмены");
    } finally {
      setLoadingInbox(false);
    }
  };

  /** ===== Profile handlers ===== */
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewPhoto(reader.result);
    reader.readAsDataURL(file);
  };
  const handleCertificateChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewCertificate(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = () => {
    const updated = {};
    if (newLocation !== profile.location) updated.location = newLocation;
    if (newSocial !== profile.social) updated.social = newSocial;
    if (newPhone !== profile.phone) updated.phone = newPhone;
    if (newAddress !== profile.address) updated.address = newAddress;
    if (newPhoto) updated.photo = newPhoto;
    if (newCertificate) updated.certificate = newCertificate;

    if (Object.keys(updated).length === 0) {
      toast.info(t("no_changes") || "Изменений нет");
      return;
    }

    axios
      .put(`${API_BASE}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
        setIsEditing(false);
        toast.success(t("profile_updated") || "Профиль обновлён");
      })
      .catch((err) => {
        console.error("Ошибка обновления профиля", err);
        toast.error(t("update_error") || "Ошибка обновления профиля");
      });
  };

  const handleChangePassword = () => {
    if (!oldPassword) {
      toast.warn(t("enter_current_password") || "Введите текущий пароль");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast.warn(t("password_too_short") || "Минимум 6 символов");
      return;
    }
    axios
      .put(`${API_BASE}/api/providers/password`, { oldPassword, newPassword }, config)
      .then(() => {
        setOldPassword("");
        setNewPassword("");
        toast.success(t("password_changed") || "Пароль обновлён");
      })
      .catch((err) => {
        console.error("Ошибка смены пароля", err);
        toast.error(t("password_error") || (err?.response?.data?.message) || "Ошибка смены пароля");
      });
  };

  /** ===== Service helpers ===== */
  const resetServiceForm = () => {
    setSelectedService(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setCategory("");
    setAvailability([]);
    setImages([]);
    setDetails({
      direction: "",
      directionCountry: "",
      directionFrom: "",
      directionTo: "",
      startDate: "",
      endDate: "",
      hotel: "",
      accommodation: "",
      accommodationCategory: "",
      adt: "",
      chd: "",
      inf: "",
      food: "",
      halal: false,
      transfer: "",
      changeable: false,
      visaIncluded: false,
      netPrice: "",
      expiration: "",
      isActive: true,
      flightType: "one_way",
      oneWay: true,
      airline: "",
      returnDate: "",
      startFlightDate: "",
      endFlightDate: "",
      flightDetails: "",
      flightDetailsText: "",
      location: "",
      eventName: "",
      eventCategory: "",
      ticketDetails: "",
      description: "",
      visaCountry: "",
    });
  };

  const loadServiceToEdit = (service) => {
    setSelectedService(service);
    setCategory(service.category || "");
    setTitle(service.title || "");
    setImages(Array.isArray(service.images) ? service.images : []);
    if (
      ["refused_tour", "author_tour", "refused_hotel", "refused_flight", "refused_event_ticket", "visa_support"].includes(
        service.category
      )
    ) {
      const d = service.details || {};
      setDetails({
        grossPrice: d.grossPrice || d.priceGross || service.grossPrice || service.price_gross || "",
        direction: d.direction || "",
        directionCountry: d.directionCountry || "",
        directionFrom: d.directionFrom || "",
        directionTo: d.directionTo || "",
        startDate: d.startDate || "",
        endDate: d.endDate || "",
        hotel: d.hotel || "",
        accommodation: d.accommodation || "",
        accommodationCategory: d.accommodationCategory || "",
        adt: d.adt || "",
        chd: d.chd || "",
        inf: d.inf || "",
        food: d.food || "",
        halal: d.halal || false,
        transfer: d.transfer || "",
        changeable: d.changeable || false,
        visaIncluded: d.visaIncluded || false,
        netPrice: d.netPrice || "",
        expiration: d.expiration || "",
        isActive: d.isActive ?? true,
        flightType: d.flightType || "one_way",
        oneWay: d.oneWay ?? (d.flightType !== "round_trip"),
        airline: d.airline || "",
        returnDate: d.returnDate || "",
        startFlightDate: d.startFlightDate || "",
        endFlightDate: d.endFlightDate || "",
        flightDetails: d.flightDetails || "",
        flightDetailsText: d.flightDetailsText || "",
        location: d.location || "",
        eventName: d.eventName || "",
        eventCategory: d.eventCategory || "",
        ticketDetails: d.ticketDetails || "",
        description: d.description || "",
        visaCountry: d.visaCountry || "",
      });
    } else {
      setDescription(service.description || "");
      setPrice(service.price || "");
      const sd = service.details || {};
      setDetails((prev) => ({ ...prev, grossPrice: (sd.grossPrice ?? sd.priceGross ?? service.price_gross ?? service.grossPrice ?? "") }));
      setAvailability(
        Array.isArray(service.availability)
          ? service.availability.map(toDate)
          : []
      );
    }
  };

  /** ===== Save service (create/update) ===== */
  const handleSaveService = () => {
    const requiredFieldsByCategory = {
      refused_tour: ["title", "details.directionFrom", "details.directionTo", "details.netPrice"],
      author_tour: ["title", "details.directionFrom", "details.directionTo", "details.netPrice"],
      refused_hotel: ["title", "details.direction", "details.directionTo", "details.startDate", "details.endDate", "details.netPrice"],
      refused_flight: ["title", "details.directionFrom", "details.directionTo", "details.startDate", "details.netPrice", "details.airline"],
      refused_event_ticket: ["title", "details.location", "details.startDate", "details.netPrice"],
      visa_support: ["title", "details.description", "details.netPrice"],
    };
    const isExtendedCategory = category in requiredFieldsByCategory;
    const requiredFields = requiredFieldsByCategory[category] || ["title", "description", "category", "price"];

    const getFieldValue = (path) =>
      path.split(".").reduce((obj, key) => obj?.[key], { title, description, category, price, details });

    const hasEmpty = requiredFields.some((field) => {
      const value = getFieldValue(field);
      return value === "" || value === undefined;
    });

    const needsReturnDate =
      category === "refused_flight" &&
      details.flightType === "round_trip" &&
      (!details.returnDate || details.returnDate === "");

    if (hasEmpty || needsReturnDate) {
      toast.warn(t("fill_all_fields") || "Заполните все обязательные поля");
      return;
    }

    const compact = (obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => {
          if (v === undefined || v === null) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        })
      );

    const __grossNum = (() => {
      const g = details?.grossPrice;
      if (g === "" || g === null || g === undefined) return undefined;
      const n = Number(g);
      return Number.isFinite(n) ? n : undefined;
    })();

    const raw = {
      title,
      category,
      images,
      price: isExtendedCategory ? undefined : price,
      description: isExtendedCategory ? undefined : description,
      availability: isExtendedCategory ? undefined : availability,
      details: isExtendedCategory ? { ...details, ...(__grossNum !== undefined ? { grossPrice: __grossNum } : {}) } : (__grossNum !== undefined ? { grossPrice: __grossNum } : undefined),
    };

    const data = compact(raw);

    const req = selectedService
      ? axios.put(`${API_BASE}/api/providers/services/${selectedService.id}`, data, config)
      : axios.post(`${API_BASE}/api/providers/services`, data, config);

    req
      .then((res) => {
        if (selectedService) {
          setServices((prev) => prev.map((s) => (s.id === selectedService.id ? res.data : s)));
          toast.success(t("service_updated") || "Услуга обновлена");
        } else {
          setServices((prev) => [...prev, res.data]);
          toast.success(t("service_added") || "Услуга добавлена");
        }
        resetServiceForm();
      })
      .catch((err) => {
        console.error(selectedService ? "Ошибка обновления услуги" : "Ошибка добавления услуги", err);
        toast.error(t(selectedService ? "update_error" : "add_error") || "Ошибка");
      });
  };

  /** ====== PROVIDER FAVORITES (ниженее табы) ====== */
  const loadPfavs = async () => {
    setLoadingFavs(true);
    try {
      const data = await apiProviderFavorites();
      setPfavs(Array.isArray(data) ? data : []);
    } finally {
      setLoadingFavs(false);
    }
  };

  const toggleFav = async (serviceId) => {
    const added = await apiToggleProviderFavorite(serviceId);
    if (added === null) return;
    if (!added) setPfavs((prev) => prev.filter((x) => x.id !== serviceId));
    else loadPfavs();
  };

  const removeFromFavs = async (serviceId) => {
    const ok = await apiRemoveProviderFavorite(serviceId);
    if (ok) setPfavs((prev) => prev.filter((x) => x.id !== serviceId));
  };

  useEffect(() => {
    if (token) loadPfavs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (bottomTab === "favorites" && pfavs.length === 0) {
      loadPfavs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab]);

  /** ===== Render ===== */
  return (
    <>
      <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
        {/* Левый блок: профиль */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md flex flex-col">
          {/* ... ЛЕВЫЙ БЛОК без изменений (как у вас) ... */}
          {/* (оставлен весь ваш код профиля, карта, выход, статистика и отзывы) */}

          <div className="flex gap-4">
            <div className="flex flex-col items-center w-1/2">
              <div className="relative flex flex-col items-center">
                <img
                  src={newPhoto || profile.photo || "https://via.placehold.co/96x96"}
                  className="w-24 h-24 rounded-full object-cover mb-2"
                  alt="Фото"
                />
                {isEditing && (
                  <>
                    <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm">
                      {t("choose_files")}
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                    </label>
                    <div className="text-sm text-gray-600 mt-1">
                      {newPhoto ? t("file_chosen") : t("no_files_selected")}
                    </div>
                  </>
                )}
              </div>

              <h3 className="font-semibold text-lg mt-6 mb-2">{t("phone")}</h3>
              {isEditing ? (
                <input
                  type="text"
                  placeholder={t("phone")}
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
                  {profile.phone || t("not_specified")}
                </div>
              )}

              <h3 className="font-semibold text-lg mb-2">{t("address")}</h3>
              {isEditing ? (
                <input
                  type="text"
                  placeholder={t("address")}
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
                  {profile.address || t("not_specified")}
                </div>
              )}

              {profile.address && !isEditing && (
                <div className="w-full mb-4">
                  <iframe
                    title="provider-map"
                    width="100%"
                    height="200"
                    frameBorder="0"
                    scrolling="no"
                    marginHeight="0"
                    marginWidth="0"
                    className="rounded"
                    src={`https://www.google.com/maps?q=${encodeURIComponent(profile.address)}&output=embed`}
                  />
                </div>
              )}

              <button
                onClick={() => {
                  localStorage.removeItem("token");
                  window.location.href = "/login";
                }}
                className="mt-4 bg-red-600 text-white px-4 py-2 rounded font-semibold w-full"
              >
                {t("logout")}
              </button>
            </div>

            <div className="w-1/2 space-y-3">
              <div>
                <label className="block font-medium">{t("name")}</label>
                <div className="border px-3 py-2 rounded bg-gray-100">{profile.name}</div>
              </div>
              <div>
                <label className="block font-medium">{t("type")}</label>
                <div className="border px-3 py-2 rounded bg-gray-100">{t(profile.type)}</div>
              </div>
              <div>
                <label className="block font-medium">{t("location")}</label>
                {isEditing ? (
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    className="border px-3 py-2 rounded w-full"
                  />
                ) : (
                  <div className="border px-3 py-2 rounded bg-gray-100">{profile.location}</div>
                )}
              </div>
              <div>
                <label className="block font-medium">{t("social")}</label>
                {isEditing ? (
                  <input
                    value={newSocial}
                    onChange={(e) => setNewSocial(e.target.value)}
                    className="border px-3 py-2 rounded w-full"
                  />
                ) : (
                  <div className="border px-3 py-2 rounded bg-gray-100">{profile.social || t("not_specified")}</div>
                )}
              </div>

              <div>
                <label className="block font-medium">{t("certificate")}</label>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm w-fit">
                      {t("choose_files")}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleCertificateChange} className="hidden" />
                    </label>
                    {newCertificate ? (
                      newCertificate.startsWith("data:image") ? (
                        <img src={newCertificate} alt="Certificate preview" className="w-32 h-32 object-cover border rounded" />
                      ) : (
                        <div className="text-sm text-gray-600">📄 {t("file_chosen")}</div>
                      )
                    ) : (
                      <div className="text-sm text-gray-600">{t("no_files_selected")}</div>
                    )}
                  </div>
                ) : profile.certificate ? (
                  <a href={profile.certificate} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    {t("view_certificate")}
                  </a>
                ) : (
                  <div className="text-gray-500">{t("not_specified")}</div>
                )}
              </div>

              <button
                onClick={isEditing ? handleSaveProfile : () => setIsEditing(true)}
                className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
              >
                {isEditing ? t("save") : t("edit")}
              </button>

              <div className="mt-4">
                <h3 className="font-semibold text-lg mb-2">{t("change_password")}</h3>
                <input
                  type="password"
                  placeholder={t("current_password") || "Текущий пароль"}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
                <input
                  type="password"
                  placeholder={t("new_password")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
                <button onClick={handleChangePassword} className="w-full bg-orange-500 text-white py-2 rounded font-bold">
                  {t("change")}
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 mt-6">
            <ProviderStatsHeader
              rating={Number(profile?.rating) || 0}
              stats={{
                requests_total:  Number(stats?.requests_total)  || 0,
                requests_active: Number(stats?.requests_active) || 0,
                bookings_total:  Number(stats?.bookings_total)  || 0,
                completed:       Number(stats?.completed)       || 0,
                cancelled:       Number(stats?.cancelled)       || 0,
                points:          Number(stats?.points) || Number(stats?.completed) || 0,
              }}
              bonusTarget={500}
              t={t}
            />
          </div>

          <div className="px-6 mt-6">
            <ProviderReviews providerId={profile?.id} t={t} />
          </div>
        </div>

        {/* Правый блок: услуги + вкладки снизу */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
          {/* Верх: Услуги (без изменений логики) */}
          <div className="mb-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">{t("services")}</h2>
              {selectedService && (
                <button
                  onClick={resetServiceForm}
                  className="text-sm text-orange-500 underline"
                >
                  {t("back")}
                </button>
              )}
            </div>

            {/* Список услуг (как было) */}
            {!selectedService && (
              <div className="mt-4 space-y-2">
                {services.filter(isServiceActive).map((s) => (
                  <div
                    key={s.id}
                    className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => loadServiceToEdit(s)}
                  >
                    <div className="flex items-center gap-3">
                      {s.images?.length ? (
                        <img
                          src={s.images[0]}
                          alt=""
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-200" />
                      )}
                      <div className="flex-1">
                        <div className="font-bold text-lg">{s.title}</div>
                        <div className="text-sm text-gray-600">{t(`category.${s.category}`)}</div>
                        {s.details?.netPrice != null ? (
                          <div className="text-sm text-gray-800">
                            {t("net_price")}: {s.details.netPrice} USD
                          </div>
                        ) : s.price != null ? (
                          <div className="text-sm text-gray-800">
                            {t("price")}: {s.price} USD
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Форма редактирования/создания (как было) */}
          {selectedService ? (
            <>
              {/* ... ВЕСЬ ВАШ ТЕКУЩИЙ БОЛЬШОЙ БЛОК ФОРМЫ КАТЕГОРИЙ ... */}
              {/* --- Ниже оставляем неизменным содержимое формы (с ImagesEditor и кнопками) --- */}
              {/* Для краткости в этом ответе: используйте вашу текущую форму без изменений */}
              {/* (Если нужно — пришлю полный блок формы ещё раз 1:1) */}
            </>
          ) : null}

          {/* Горизонтальные табы нижней секции */}
          <div className="mt-6 border-t pt-4">
            <div className="flex items-center gap-2 mb-4">
              {[
                { key: "requests",  label: t("incoming_requests") || "Входящие заявки" },
                { key: "favorites", label: t("favorites") || "Избранное" },
                { key: "bookings",  label: t("my_bookings") || "Мои брони" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setBottomTab(tab.key)}
                  className={`px-4 py-2 rounded-full text-sm border ${
                    bottomTab === tab.key ? "bg-orange-500 text-white border-orange-500" : "bg-white hover:bg-gray-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ВХОДЯЩИЕ ЗАЯВКИ */}
            {bottomTab === "requests" && (
              <section>
                <ProviderInboxList
                  showHeader
                  cleanupExpired={serverCleanupExpired}
                  nameResolver={typeof window !== "undefined" ? window.__providerClientNameResolver : undefined}
                  onAfterAction={refreshInbox}
                />
              </section>
            )}

            {/* ИЗБРАННОЕ */}
            {bottomTab === "favorites" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-semibold">{t("favorites") || "Избранное"}</h3>
                  <button
                    className="text-sm bg-white border px-3 py-1 rounded hover:bg-gray-50"
                    onClick={loadPfavs}
                    disabled={loadingFavs}
                  >
                    {loadingFavs ? (t("loading") || "Загрузка…") : (t("refresh") || "Обновить")}
                  </button>
                </div>

                {loadingFavs && <div className="text-sm text-gray-500 mb-2">{t("loading") || "Загрузка…"}</div>}
                {!loadingFavs && pfavs.length === 0 && (
                  <div className="text-sm text-gray-500">{t("favorites_empty") || "Список пуст"}</div>
                )}

                <div className="space-y-3">
                  {pfavs.map((s) => {
                    const cover = Array.isArray(s.images) && s.images.length ? s.images[0] : null;
                    const net = s.net_price ?? s?.details?.netPrice ?? s.price ?? "—";
                    return (
                      <div key={s.id} className="border rounded-lg p-3 flex items-start gap-3 bg-white">
                        <div className="w-16 h-16 rounded overflow-hidden bg-gray-100">
                          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium">{s.title}</div>
                              <div className="text-xs text-gray-500">{t(`category.${s.category}`) || s.category}</div>
                            </div>
                            <button
                              onClick={() => toggleFav(s.id)}
                              className="text-sm px-2 py-1 rounded border bg-white hover:bg-gray-50"
                              title={t("remove_from_fav") || "Убрать из избранного"}
                            >
                              ★
                            </button>
                          </div>
                          <div className="text-sm mt-1">
                            {(t("net_price") || "Нетто")}: <b>{net}</b> USD
                          </div>
                        </div>
                        <button
                          onClick={() => removeFromFavs(s.id)}
                          className="text-sm bg-white border px-3 py-1 rounded hover:bg-gray-50"
                        >
                          {t("delete") || "Удалить"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* МОИ БРОНИ */}
            {bottomTab === "bookings" && (
              <div>
                <h3 className="text-xl font-semibold mb-3">{t("my_bookings") || "Мои брони"}</h3>
                <div className="space-y-3">
                  {bookingsInbox.length === 0 && (
                    <div className="text-sm text-gray-500">{t("no_bookings") || "Брони отсутствуют."}</div>
                  )}
                  {bookingsInbox.map((b) => (
                    <div key={b.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <div className="font-medium">
                          #{b.id} • {b.service_title || t("service") || "услуга"} • {b.status}
                        </div>
                        <div>{b.price ? `${b.price} ${b.currency || ""}` : "—"}</div>
                      </div>

                      <div className="flex gap-2">
                        {b.status === "pending" && (
                          <>
                            <button
                              onClick={() => confirmBooking(b.id)}
                              className="text-sm bg-green-600 text-white px-3 py-1 rounded"
                              disabled={loadingInbox}
                            >
                              {t("confirm") || "Подтвердить"}
                            </button>
                            <button
                              onClick={() => rejectBooking(b.id)}
                              className="text-sm bg-red-600 text-white px-3 py-1 rounded"
                              disabled={loadingInbox}
                            >
                              {t("reject") || "Отклонить"}
                            </button>
                          </>
                        )}
                        {(b.status === "pending" || b.status === "active") && (
                          <button
                            onClick={() => cancelBooking(b.id)}
                            className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200"
                            disabled={loadingInbox}
                          >
                            {t("cancel") || "Отменить"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Модалка удаления услуги (как было) */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-xl w-[90%] max-w-sm">
            <h2 className="text-lg font-bold mb-4">
              {t("confirm_delete", { defaultValue: "Удалить услугу?" })}
            </h2>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300"
              >
                {t("cancel", { defaultValue: "Отмена" })}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {t("ok", { defaultValue: "Удалить" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {(profile.type === "guide" || profile.type === "transport") && (
        <div className="px-6 pb-10">
          <div className="mt-10 bg-white p-6 rounded shadow border max-w-3xl mx-auto">
            <h3 className="text-lg font-semibold mb-4 text-orange-600">
              {t("calendar.blocking_title")}
            </h3>

            <DayPicker
              mode="multiple"
              selected={blockedDates}
              onSelect={(dates) => setBlockedDates(dates || [])}
              disabled={[{ before: new Date() }, ...bookedDates]}
              modifiers={{ booked: bookedDates }}
              modifiersClassNames={{
                selected: "bg-red-400 text-white",
                booked: "bg-blue-500 text-white",
              }}
              className="border rounded p-4"
            />

            <div className="mt-2 text-sm text-gray-600 flex gap-4">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-400 inline-block" />
                <span>{t("calendar.label_blocked_manual")}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
                <span>{t("calendar.label_booked_by_clients")}</span>
              </div>
            </div>

            <button
              onClick={handleSaveBlockedDates}
              disabled={saving}
              className="mt-4 px-4 py-2 rounded bg-orange-500 text-white font-semibold disabled:opacity-60"
            >
              {saving ? t("saving") || "Сохраняю..." : t("calendar.save_blocked_dates")}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Dashboard;
