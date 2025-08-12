import React, { useEffect, useState, useRef } from "react";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import ProviderStatsHeader from "../components/ProviderStatsHeader";

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

/** Редактор изображений (DnD сортировка, удалить, очистить, обложка) */
function ImagesEditor({
  images,
  onUpload,
  onRemove,
  onReorder,
  onClear,          // опционально
  dragItem,
  dragOverItem,
  onMakeCover,      // опционально
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
  const [newPassword, setNewPassword] = useState("");

  // Services
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);

  // Common fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]); // Date[]
  const [images, setImages] = useState([]); // string[] (dataURL/URL)

 
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
  const [selectedCountry, setSelectedCountry] = useState(null); // {value,label,code}
  const [departureCity, setDepartureCity] = useState(null);
  const [cityOptionsFrom, setCityOptionsFrom] = useState([]);
  const [cityOptionsTo, setCityOptionsTo] = useState([]);

  // Details for agent categories
  const [details, setDetails] = useState({
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

  // === Provider Inbox / Bookings ===
  const [requestsInbox, setRequestsInbox] = useState([]); // входящие запросы по услугам провайдера
  const [bookingsInbox, setBookingsInbox] = useState([]); // брони по услугам провайдера
  const [proposalForms, setProposalForms] = useState({});  // { [requestId]: {price, currency, hotel, room, terms, message} }
  const [loadingInbox, setLoadingInbox] = useState(false);

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  /** ===== Utils ===== */
  const isServiceActive = (s) => !s.details?.expiration || new Date(s.details.expiration) > new Date();
  const toDate = (v) => (v ? (v instanceof Date ? v : new Date(v)) : undefined);

  /** ===== API helpers ===== */
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

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
      if (f.size > 6 * 1024 * 1024) continue; // пропускаем >6MB
      try {
        const dataUrl = await resizeImageFile(f, 1600, 0.85, "image/jpeg");
        processed.push(dataUrl);
      } catch {
        // ignore
      }
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
      await axios.post(
        `${API_BASE}/api/providers/blocked-dates`,
        { dates: payload },
        config
      );
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

  // Departure cities (top by population)
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

  // Arrival cities based on selected country
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

  /** ===== Load profile + services ===== */
  useEffect(() => {
    // Profile
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
              const formatted = (response.data || []).map((item) => new Date(item.date));
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

    // Services
    axios
      .get(`${API_BASE}/api/providers/services`, config)
      .then((res) => setServices(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error("Ошибка загрузки услуг", err);
        toast.error(t("services_load_error") || "Не удалось загрузить услуги");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Provider inbox loaders/actions ===== */
  const refreshInbox = async () => {
    try {
      setLoadingInbox(true);
      const [rq, bk] = await Promise.all([
        axios.get(`${API_BASE}/api/requests/provider`, config),
        axios.get(`${API_BASE}/api/bookings/provider`, config),
      ]);
      setRequestsInbox(Array.isArray(rq.data) ? rq.data : []);
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
    if (!newPassword || newPassword.length < 6) {
      toast.warn(t("password_too_short") || "Минимум 6 символов");
      return;
    }
    axios
      .put(`${API_BASE}/api/providers/change-password`, { password: newPassword }, config)
      .then(() => {
        setNewPassword("");
        toast.success(t("password_changed") || "Пароль обновлён");
      })
      .catch((err) => {
        console.error("Ошибка смены пароля", err);
        toast.error(t("password_error") || "Ошибка смены пароля");
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

    const raw = {
      title,
      category,
      images,
      price: isExtendedCategory ? undefined : price,
      description: isExtendedCategory ? undefined : description,
      availability: isExtendedCategory ? undefined : availability,
      details: isExtendedCategory ? details : undefined,
    };

    const data = compact(raw);

    const req = selectedService
      ? axios.put(
          `${API_BASE}/api/providers/services/${selectedService.id}`,
          data,
          config
        )
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

  /** ===== Render ===== */
  return (
    <>
      <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
        {/* Левый блок: профиль */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md flex flex-col">
          <div className="flex gap-4">
            <div className="flex flex-col items-center w-1/2">
              {/* Фото */}
              <div className="relative flex flex-col items-center">
                <img
                  src={newPhoto || profile.photo || "https://via.placeholder.com/96x96"}
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

              {/* Телефон */}
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

              {/* Адрес */}
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

              {/* Карта */}
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

              {/* Выйти */}
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

            {/* Правая часть профиля */}
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

              {/* Сертификат */}
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

              {/* Кнопка сохранить/редактировать */}
              <button
                onClick={isEditing ? handleSaveProfile : () => setIsEditing(true)}
                className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
              >
                {isEditing ? t("save") : t("edit")}
              </button>

              {/* Смена пароля */}
              <div className="mt-4">
                <h3 className="font-semibold text-lg mb-2">{t("change_password")}</h3>
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
           <div>
    <ProviderStatsHeader />
      </div>
        </div>
      

        {/* Правый блок: услуги + входящие/брони */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
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

            {/* Список услуг */}
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

          {/* Форма редактирования/создания */}
          {selectedService ? (
            /* ====== Edit form (by category) ====== */
            <>
              <h3 className="text-xl font-semibold mb-2">{t("edit_service")}</h3>

              {/* Общие поля для названия */}
              <div className="mb-2">
                <label className="block font-medium mb-1">{t("title")}</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("title")}
                  className="w-full border px-3 py-2 rounded mb-2"
                />
              </div>

              {/* ----- CATEGORY-SPECIFIC ----- */}
              {["refused_tour", "author_tour"].includes(category) && profile.type === "agent" && (
                <>
                  <div className="flex gap-4 mb-2">
                    <Select
                      options={countryOptions}
                      value={selectedCountry}
                      onChange={(value) => setSelectedCountry(value)}
                      placeholder={t("direction_country")}
                      noOptionsMessage={() => t("country_not_chosen")}
                      className="w-1/3"
                    />
                    <AsyncSelect
                      cacheOptions
                      defaultOptions
                      loadOptions={loadDepartureCities}
                      onChange={(selected) => {
                        setDepartureCity(selected);
                        setDetails((prev) => ({ ...prev, directionFrom: selected?.value || "" }));
                      }}
                      placeholder={t("direction_from")}
                      noOptionsMessage={() => t("direction_from_not_chosen")}
                      className="w-1/3"
                    />
                    <Select
                      options={cityOptionsTo}
                      placeholder={t("direction_to")}
                      noOptionsMessage={() => t("direction_to_not_chosen")}
                      onChange={(value) =>
                        setDetails((prev) => ({ ...prev, directionTo: value?.value || "" }))
                      }
                      className="w-1/3"
                    />
                  </div>

                  <div className="flex gap-4 mb-2">
                    <div className="w-1/2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("start_flight_date")}</label>
                      <input
                        type="date"
                        value={details.startFlightDate || ""}
                        onChange={(e) => setDetails({ ...details, startFlightDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                    <div className="w-1/2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("end_flight_date")}</label>
                      <input
                        type="date"
                        value={details.endFlightDate || ""}
                        onChange={(e) => setDetails({ ...details, endFlightDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("flight_details")}</label>
                    <textarea
                      value={details.flightDetails || ""}
                      onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                      placeholder={t("enter_flight_details")}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("hotel")}</label>
                  <AsyncSelect
                    cacheOptions
                    defaultOptions
                    loadOptions={loadHotelOptions}
                    value={details.hotel ? { value: details.hotel, label: details.hotel } : null}
                    onChange={(selected) => setDetails((prev) => ({ ...prev, hotel: selected ? selected.value : "" }))}                    placeholder={t("hotel")}
                    noOptionsMessage={() => t("hotel_not_found")}
                    className="mb-3"
                  />

                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
                    <input
                      type="text"
                      value={details.accommodationCategory || ""}
                      onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                      className="w-full border px-3 py-2 rounded mb-2"
                      placeholder={t("enter_category")}
                    />
                    <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
                    <input
                      type="text"
                      value={details.accommodation || ""}
                      onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                      className="w-full border px-3 py-2 rounded mb-2"
                      placeholder={t("enter_accommodation")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("food")}</label>
                    <select
                      value={details.food || ""}
                      onChange={(e) => setDetails({ ...details, food: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("food_options.select")}</option>
                      <option value="BB">BB - {t("food_options.bb")}</option>
                      <option value="HB">HB - {t("food_options.hb")}</option>
                      <option value="FB">FB - {t("food_options.fb")}</option>
                      <option value="AI">AI - {t("food_options.ai")}</option>
                      <option value="UAI">UAI - {t("food_options.uai")}</option>
                    </select>
                    <label className="inline-flex items-center mt-2">
                      <input
                        type="checkbox"
                        checked={details.halal || false}
                        onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                        className="mr-2"
                      />
                      {t("food_options.halal")}
                    </label>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("transfer")}</label>
                    <select
                      value={details.transfer || ""}
                      onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("transfer_options.select")}</option>
                      <option value="individual">{t("transfer_options.individual")}</option>
                      <option value="group">{t("transfer_options.group")}</option>
                      <option value="none">{t("transfer_options.none")}</option>
                    </select>
                  </div>

                  <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.visaIncluded || false}
                      onChange={(e) => setDetails({ ...details, visaIncluded: e.target.checked })}
                      className="mr-2"
                    />
                    {t("visa_included")}
                  </label>
                  <br />
                  <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.changeable || false}
                      onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                      className="mr-2"
                    />
                    {t("changeable")}
                  </label>

                  <input
                    value={details.netPrice || ""}
                    onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                    placeholder={t("net_price")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />
                  <label className="block font-medium mt-2 mb-1">{t("expiration_timer")}</label>
                  <input
                    type="datetime-local"
                    value={details.expiration || ""}
                    onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />
                  <label className="inline-flex items-center mb-4">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    {t("is_active")}
                  </label>
                </>
              )}

              {category === "refused_hotel" && profile.type === "agent" && (
                <>
                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("direction_country")}</label>
                    <Select
                      options={countryOptions}
                      value={countryOptions.find((c) => c.value === details.direction)}
                      onChange={(selected) =>
                        setDetails({ ...details, direction: selected?.value || "" })
                      }
                      placeholder={t("direction_country")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("refused_hotel_city")}</label>
                    <AsyncSelect
                      cacheOptions
                      loadOptions={loadCitiesFromInput}
                      defaultOptions
                      value={details.directionTo ? { label: details.directionTo, value: details.directionTo } : null}
                      onChange={(selected) =>
                        setDetails({ ...details, directionTo: selected?.value || "" })
                      }
                      placeholder={t("select_city")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("refused_hotel_name")}</label>
                    <AsyncSelect
                      cacheOptions
                      loadOptions={loadHotelOptions}
                      defaultOptions
                      value={details.hotel ? { label: details.hotel, value: details.hotel } : null}
                      onChange={(selected) =>
                        setDetails({ ...details, hotel: selected?.value || "" })
                      }
                      placeholder={t("select_hotel")}
                    />
                  </div>

                  <div className="flex gap-4 mb-2">
                    <div className="w-1/2">
                      <label className="block font-medium mb-1">{t("hotel_check_in")}</label>
                      <input
                        type="date"
                        value={details.startDate}
                        onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                    <div className="w-1/2">
                      <label className="block font-medium mb-1">{t("hotel_check_out")}</label>
                      <input
                        type="date"
                        value={details.endDate}
                        onChange={(e) => setDetails({ ...details, endDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("accommodation_category")}</label>
                    <input
                      type="text"
                      value={details.accommodationCategory || ""}
                      onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("accommodation")}</label>
                    <input
                      type="text"
                      value={details.accommodation || ""}
                      onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("food")}</label>
                    <select
                      value={details.food || ""}
                      onChange={(e) => setDetails({ ...details, food: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("food_options.select")}</option>
                      <option value="BB">{t("food_options.bb")}</option>
                      <option value="HB">{t("food_options.hb")}</option>
                      <option value="FB">{t("food_options.fb")}</option>
                      <option value="AI">{t("food_options.ai")}</option>
                      <option value="UAI">{t("food_options.uai")}</option>
                    </select>
                    <label className="inline-flex items-center mt-2">
                      <input
                        type="checkbox"
                        checked={details.halal || false}
                        onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                        className="mr-2"
                      />
                      {t("food_options.halal")}
                    </label>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("transfer")}</label>
                    <select
                      value={details.transfer || ""}
                      onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("transfer_options.select")}</option>
                      <option value="individual">{t("transfer_options.individual")}</option>
                      <option value="group">{t("transfer_options.group")}</option>
                      <option value="none">{t("transfer_options.none")}</option>
                    </select>
                  </div>

                  <div className="mb-2 flex items-center">
                    <input
                      type="checkbox"
                      checked={details.changeable || false}
                      onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                      className="mr-2"
                    />
                    <label>{t("changeable")}</label>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("net_price")}</label>
                    <input
                      type="number"
                      value={details.netPrice || ""}
                      onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("expiration_timer")}</label>
                    <input
                      type="datetime-local"
                      value={details.expiration || ""}
                      onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-4 flex items-center">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    <label>{t("is_active")}</label>
                  </div>
                </>
              )}

              {category === "refused_flight" && profile.type === "agent" && (
                <>
                  <div className="mb-3">
                    <label className="block font-medium mb-1">{t("flight_type")}</label>
                    <div className="flex gap-4">
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          checked={details.flightType === "one_way"}
                          onChange={() =>
                            setDetails({ ...details, flightType: "one_way", oneWay: true, returnDate: "" })
                          }
                          className="mr-2"
                        />
                        {t("one_way")}
                      </label>
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          checked={details.flightType === "round_trip"}
                          onChange={() =>
                            setDetails({ ...details, flightType: "round_trip", oneWay: false })
                          }
                          className="mr-2"
                        />
                        {t("round_trip")}
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-4 mb-3">
                    <div className="w-1/2">
                      <label className="block text-sm font-medium mb-1">{t("departure_date")}</label>
                      <input
                        type="date"
                        value={details.startDate || ""}
                        onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                    {!details.oneWay && (
                      <div className="w-1/2">
                        <label className="block text-sm font-medium mb-1">{t("return_date")}</label>
                        <input
                          type="date"
                          value={details.returnDate || ""}
                          onChange={(e) => setDetails({ ...details, returnDate: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mb-2">
                    <label className="block text-sm font-medium mb-1">{t("airline")}</label>
                    <input
                      type="text"
                      value={details.airline || ""}
                      onChange={(e) => setDetails({ ...details, airline: e.target.value })}
                      placeholder={t("enter_airline")}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
                    <textarea
                      value={details.flightDetails || ""}
                      onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                      placeholder={t("enter_flight_details")}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <input
                    value={details.netPrice || ""}
                    onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                    placeholder={t("net_price")}
                    className="w-full border px-3 py-2 rounded mb-3"
                  />

                  <div className="mb-3">
                    <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
                    <input
                      type="datetime-local"
                      value={details.expiration || ""}
                      onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <label className="inline-flex items-center mb-4">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    {t("is_active")}
                  </label>
                </>
              )}

              {category === "refused_event_ticket" && profile.type === "agent" && (
                <>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("event_name")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <Select
                    options={[
                      { value: "concert", label: t("event_category_concert") },
                      { value: "exhibition", label: t("event_category_exhibition") },
                      { value: "show", label: t("event_category_show") },
                      { value: "masterclass", label: t("event_category_masterclass") },
                      { value: "football", label: t("event_category_football") },
                      { value: "fight", label: t("event_category_fight") },
                    ]}
                    value={
                      [
                        { value: "concert", label: t("event_category_concert") },
                        { value: "exhibition", label: t("event_category_exhibition") },
                        { value: "show", label: t("event_category_show") },
                        { value: "masterclass", label: t("event_category_masterclass") },
                        { value: "football", label: t("event_category_football") },
                        { value: "fight", label: t("event_category_fight") },
                      ].find((opt) => opt.value === details.eventCategory) || null
                    }
                    onChange={(selected) => setDetails({ ...details, eventCategory: selected.value })}
                    placeholder={t("select_event_category")}
                    className="mb-2"
                  />

                  <input
                    type="text"
                    value={details.location || ""}
                    onChange={(e) => setDetails({ ...details, location: e.target.value })}
                    placeholder={t("location")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="date"
                    value={details.startDate || ""}
                    onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                    placeholder={t("event_date")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="text"
                    value={details.ticketDetails || ""}
                    onChange={(e) => setDetails({ ...details, ticketDetails: e.target.value })}
                    placeholder={t("ticket_details")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="number"
                    value={details.netPrice || ""}
                    onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                    placeholder={t("net_price")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    {t("is_active")}
                  </label>

                  <input
                    type="datetime-local"
                    value={details.expiration || ""}
                    onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                    placeholder={t("expiration_timer")}
                    className="w-full border px-3 py-2 rounded mb-4"
                  />
                </>
              )}

              {category === "visa_support" && profile.type === "agent" && (
                <>
                  <h3 className="text-xl font-bold text-orange-600 mb-4">{t("new_visa_support")}</h3>

                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("title")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <Select
                    options={countryOptions}
                    value={countryOptions.find((option) => option.value === details.visaCountry) || null}
                    onChange={(selected) => setDetails({ ...details, visaCountry: selected?.value })}
                    placeholder={t("select_country")}
                    noOptionsMessage={() => t("country_not_chosen")}
                    className="mb-2"
                  />

                  <textarea
                    value={details.description}
                    onChange={(e) => setDetails({ ...details, description: e.target.value })}
                    placeholder={t("description")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="number"
                    value={details.netPrice}
                    onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                    placeholder={t("net_price")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <label className="flex items-center space-x-2 mb-2">
                    <input
                      type="checkbox"
                      checked={details.isActive}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                    />
                    <span>{t("is_active")}</span>
                  </label>
                </>
              )}

              {/* Блок изображений + действия */}
              <ImagesEditor
                images={images}
                onUpload={handleImageUpload}
                onRemove={handleRemoveImage}
                onReorder={handleReorderImages}
                onClear={handleClearImages}
                onMakeCover={makeCover}
                dragItem={dragItem}
                dragOverItem={dragOverItem}
                t={t}
              />

              <button className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2" onClick={handleSaveService}>
                {t("save_service")}
              </button>
              <button
                className="w-full bg-red-600 text-white py-2 rounded font-bold mt-2 disabled:opacity-60"
                onClick={() => confirmDeleteService(selectedService.id)}
                disabled={!selectedService?.id}
              >
                {t("delete")}
              </button>
            </>
          ) : (
            /* ====== Create form ====== */
            <>
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded mb-4">
                {t("new_service_tip")}
              </div>

              {/* Выбор категории */}
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setTitle("");
                  setDescription("");
                  setPrice("");
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
                }}
                className="w-full border px-3 py-2 rounded mb-4 bg-white"
              >
                <option value="">{t("select_category")}</option>
                {profile.type === "guide" && (
                  <>
                    <option value="city_tour_guide">{t("category.city_tour_guide")}</option>
                    <option value="mountain_tour_guide">{t("category.mountain_tour_guide")}</option>
                  </>
                )}
                {profile.type === "transport" && (
                  <>
                    <option value="city_tour_transport">{t("category.city_tour_transport")}</option>
                    <option value="mountain_tour_transport">{t("category.mountain_tour_transport")}</option>
                    <option value="one_way_transfer">{t("category.one_way_transfer")}</option>
                    <option value="dinner_transfer">{t("category.dinner_transfer")}</option>
                    <option value="border_transfer">{t("category.border_transfer")}</option>
                  </>
                )}
                {profile.type === "agent" && (
                  <>
                    <option value="refused_tour">{t("category.refused_tour")}</option>
                    <option value="refused_hotel">{t("category.refused_hotel")}</option>
                    <option value="refused_flight">{t("category.refused_flight")}</option>
                    <option value="refused_event_ticket">{t("category.refused_event_ticket")}</option>
                    <option value="visa_support">{t("category.visa_support")}</option>
                    <option value="author_tour">{t("category.author_tour")}</option>
                  </>
                )}
                {profile.type === "hotel" && (
                  <>
                    <option value="hotel_room">{t("category.hotel_room")}</option>
                    <option value="hotel_transfer">{t("category.hotel_transfer")}</option>
                    <option value="hall_rent">{t("category.hall_rent")}</option>
                  </>
                )}
              </select>

              {/* Форма для выбранной категории */}
              {category && (
                <>
                  {/* Agent categories */}
                  {(category === "refused_tour" || category === "author_tour") && profile.type === "agent" ? (
                    <>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="flex gap-4 mb-2">
                        <Select
                          options={countryOptions}
                          value={selectedCountry}
                          onChange={(value) => setSelectedCountry(value)}
                          placeholder={t("direction_country")}
                          noOptionsMessage={() => t("country_not_chosen")}
                          className="w-1/3"
                        />

                        <AsyncSelect
                          cacheOptions
                          defaultOptions
                          loadOptions={loadDepartureCities}
                          onChange={(selected) => {
                            setDepartureCity(selected);
                            setDetails((prev) => ({ ...prev, directionFrom: selected?.value || "" }));
                          }}
                          placeholder={t("direction_from")}
                          noOptionsMessage={() => t("direction_from_not_chosen")}
                          className="w-1/3"
                        />

                        <Select
                          options={cityOptionsTo}
                          placeholder={t("direction_to")}
                          noOptionsMessage={() => t("direction_to_not_chosen")}
                          onChange={(value) => setDetails({ ...details, directionTo: value?.value || "" })}
                          className="w-1/3"
                        />
                      </div>

                      <div className="flex gap-4 mb-2">
                        <div className="w-1/2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t("start_flight_date")}</label>
                          <input
                            type="date"
                            value={details.startFlightDate || ""}
                            onChange={(e) => setDetails({ ...details, startFlightDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        <div className="w-1/2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t("end_flight_date")}</label>
                          <input
                            type="date"
                            value={details.endFlightDate || ""}
                            onChange={(e) => setDetails({ ...details, endFlightDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t("flight_details")}</label>
                        <textarea
                          value={details.flightDetails || ""}
                          onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                          placeholder={t("enter_flight_details")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("hotel")}</label>
                      <AsyncSelect
                        cacheOptions
                        defaultOptions
                        loadOptions={loadHotelOptions}
                        value={details.hotel ? { value: details.hotel, label: details.hotel } : null}
                        onChange={(selected) => setDetails((prev) => ({ ...prev, hotel: selected ? selected.value : "" }))}
                        placeholder={t("hotel")}
                        noOptionsMessage={() => t("hotel_not_found")}
                        className="mb-3"
                      />

                      <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
                        <input
                          type="text"
                          value={details.accommodationCategory || ""}
                          onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                          className="w-full border px-3 py-2 rounded mb-2"
                          placeholder={t("enter_category")}
                        />
                        <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
                        <input
                          type="text"
                          value={details.accommodation || ""}
                          onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                          className="w-full border px-3 py-2 rounded mb-2"
                          placeholder={t("enter_accommodation")}
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("food")}</label>
                        <select
                          value={details.food || ""}
                          onChange={(e) => setDetails({ ...details, food: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("food_options.select")}</option>
                          <option value="BB">BB - {t("food_options.bb")}</option>
                          <option value="HB">HB - {t("food_options.hb")}</option>
                          <option value="FB">FB - {t("food_options.fb")}</option>
                          <option value="AI">AI - {t("food_options.ai")}</option>
                          <option value="UAI">UAI - {t("food_options.uai")}</option>
                        </select>
                        <label className="inline-flex items-center mt-2">
                          <input
                            type="checkbox"
                            checked={details.halal || false}
                            onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                            className="mr-2"
                          />
                          {t("food_options.halal")}
                        </label>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("transfer")}</label>
                        <select
                          value={details.transfer || ""}
                          onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("transfer_options.select")}</option>
                          <option value="individual">{t("transfer_options.individual")}</option>
                          <option value="group">{t("transfer_options.group")}</option>
                          <option value="none">{t("transfer_options.none")}</option>
                        </select>
                      </div>

                      <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.visaIncluded || false}
                          onChange={(e) => setDetails({ ...details, visaIncluded: e.target.checked })}
                          className="mr-2"
                        />
                        {t("visa_included")}
                      </label>
                      <br />
                      <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.changeable || false}
                          onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                          className="mr-2"
                        />
                        {t("changeable")}
                      </label>

                      <input
                        value={details.netPrice || ""}
                        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                        placeholder={t("net_price")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <label className="block font-medium mt-2 mb-1">{t("expiration_timer")}</label>
                      <input
                        type="datetime-local"
                        value={details.expiration || ""}
                        onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <label className="inline-flex items-center mb-4">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>
                    </>
                  ) : category === "refused_hotel" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_hotel")}</h3>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("direction_country")}</label>
                        <Select
                          options={countryOptions}
                          value={countryOptions.find((c) => c.value === details.direction) || null}
                          onChange={(selected) => setDetails({ ...details, direction: selected?.value || "" })}
                          placeholder={t("direction_country")}
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("refused_hotel_city")}</label>
                        <AsyncSelect
                          cacheOptions
                          loadOptions={loadCitiesFromInput}
                          defaultOptions
                          onChange={(selected) => setDetails({ ...details, directionTo: selected?.value || "" })}
                          placeholder={t("refused_hotel_select_city")}
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("refused_hotel_name")}</label>
                        <AsyncSelect
                          cacheOptions
                          loadOptions={loadHotelOptions}
                          defaultOptions
                          onChange={(selected) => setDetails({ ...details, hotel: selected?.value || "" })}
                          placeholder={t("refused_hotel_select")}
                        />
                      </div>

                      <div className="flex gap-4 mb-2">
                        <div className="w-1/2">
                          <label className="block font-medium mb-1">{t("hotel_check_in")}</label>
                          <input
                            type="date"
                            value={details.startDate}
                            onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        <div className="w-1/2">
                          <label className="block font-medium mb-1">{t("hotel_check_out")}</label>
                          <input
                            type="date"
                            value={details.endDate}
                            onChange={(e) => setDetails({ ...details, endDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("accommodation_category")}</label>
                        <input
                          type="text"
                          value={details.accommodationCategory || ""}
                          onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("accommodation")}</label>
                        <input
                          type="text"
                          value={details.accommodation || ""}
                          onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("food")}</label>
                        <select
                          value={details.food || ""}
                          onChange={(e) => setDetails({ ...details, food: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("food_options.select")}</option>
                          <option value="BB">{t("food_options.bb")}</option>
                          <option value="HB">{t("food_options.hb")}</option>
                          <option value="FB">{t("food_options.fb")}</option>
                          <option value="AI">{t("food_options.ai")}</option>
                          <option value="UAI">{t("food_options.uai")}</option>
                        </select>
                        <label className="inline-flex items-center mt-2">
                          <input
                            type="checkbox"
                            checked={details.halal || false}
                            onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                            className="mr-2"
                          />
                          {t("food_options.halal")}
                        </label>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("transfer")}</label>
                        <select
                          value={details.transfer || ""}
                          onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("transfer_options.select")}</option>
                          <option value="individual">{t("transfer_options.individual")}</option>
                          <option value="group">{t("transfer_options.group")}</option>
                          <option value="none">{t("transfer_options.none")}</option>
                        </select>
                      </div>

                      <div className="mb-2 flex items-center">
                        <input
                          type="checkbox"
                          checked={details.changeable || false}
                          onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                          className="mr-2"
                        />
                        <label>{t("changeable")}</label>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("net_price")}</label>
                        <input
                          type="number"
                          value={details.netPrice || ""}
                          onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("expiration_timer")}</label>
                        <input
                          type="datetime-local"
                          value={details.expiration || ""}
                          onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-4 flex items-center">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        <label>{t("is_active")}</label>
                      </div>
                    </>
                  ) : category === "refused_flight" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_airtkt")}</h3>

                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="flex gap-4 mb-2">
                        <Select
                          options={countryOptions}
                          value={selectedCountry}
                          onChange={(value) => {
                            setSelectedCountry(value);
                            setDetails((prev) => ({
                              ...prev,
                              directionCountry: value?.value || "",
                              direction: `${value?.label || ""} — ${departureCity?.label || ""} → ${details.directionTo || ""}`,
                            }));
                          }}
                          placeholder={t("direction_country")}
                          noOptionsMessage={() => t("country_not_found")}
                          className="w-1/3"
                        />
                        <AsyncSelect
                          cacheOptions
                          defaultOptions
                          loadOptions={loadDepartureCities}
                          onChange={(selected) => {
                            setDepartureCity(selected);
                            setDetails((prev) => ({
                              ...prev,
                              directionFrom: selected?.value || "",
                              direction: `${selectedCountry?.label || ""} — ${selected?.label || ""} → ${details.directionTo || ""}`,
                            }));
                          }}
                          placeholder={t("direction_from")}
                          noOptionsMessage={() => t("direction_from_not_found")}
                          className="w-1/3"
                        />
                        <Select
                          options={cityOptionsTo}
                          value={cityOptionsTo.find((opt) => opt.value === details.directionTo) || null}
                          onChange={(value) => {
                            setDetails((prev) => ({
                              ...prev,
                              directionTo: value?.value || "",
                              direction: `${selectedCountry?.label || ""} — ${departureCity?.label || ""} → ${value?.label || ""}`,
                            }));
                          }}
                          placeholder={t("direction_to")}
                          noOptionsMessage={() => t("direction_to_not_found")}
                          className="w-1/3"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block font-medium mb-1">{t("flight_type")}</label>
                        <div className="flex gap-4">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "one_way"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "one_way", oneWay: true, returnDate: "" })
                              }
                              className="mr-2"
                            />
                            {t("one_way")}
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "round_trip"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "round_trip", oneWay: false })
                              }
                              className="mr-2"
                            />
                            {t("round_trip")}
                          </label>
                        </div>
                      </div>

                      <div className="flex gap-4 mb-3">
                        <div className="w-1/2">
                          <label className="block text-sm font-medium mb-1">{t("departure_date")}</label>
                          <input
                            type="date"
                            value={details.startDate || ""}
                            onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        {!details.oneWay && (
                          <div className="w-1/2">
                            <label className="block text-sm font-medium mb-1">{t("return_date")}</label>
                            <input
                              type="date"
                              value={details.returnDate || ""}
                              onChange={(e) => setDetails({ ...details, returnDate: e.target.value })}
                              className="w-full border px-3 py-2 rounded"
                            />
                          </div>
                        )}
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("airline")}</label>
                        <input
                          type="text"
                          value={details.airline || ""}
                          onChange={(e) => setDetails({ ...details, airline: e.target.value })}
                          placeholder={t("enter_airline")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
                        <textarea
                          value={details.flightDetails || ""}
                          onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                          placeholder={t("enter_flight_details")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <input
                        value={details.netPrice || ""}
                        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                        placeholder={t("net_price")}
                        className="w-full border px-3 py-2 rounded mb-3"
                      />

                      <div className="mb-3">
                        <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
                        <input
                          type="datetime-local"
                          value={details.expiration || ""}
                          onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <label className="inline-flex items-center mb-4">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>
                    </>
                  ) : category === "refused_event_ticket" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_event_ticket")}</h3>

                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("event_name")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <Select
                        options={[
                          { value: "concert", label: t("event_category_concert") },
                          { value: "exhibition", label: t("event_category_exhibition") },
                          { value: "show", label: t("event_category_show") },
                          { value: "masterclass", label: t("event_category_masterclass") },
                          { value: "football", label: t("event_category_football") },
                          { value: "fight", label: t("event_category_fight") },
                        ]}
                        value={
                          [
                            { value: "concert", label: t("event_category_concert") },
                            { value: "exhibition", label: t("event_category_exhibition") },
                            { value: "show", label: t("event_category_show") },
                            { value: "masterclass", label: t("event_category_masterclass") },
                            { value: "football", label: t("event_category_football") },
                            { value: "fight", label: t("event_category_fight") },
                          ].find((opt) => opt.value === details.eventCategory) || null
                        }
                        onChange={(selected) => setDetails({ ...details, eventCategory: selected.value })}
                        placeholder={t("select_event_category")}
                        className="mb-2"
                      />

                      <input
                        type="text"
                        value={details.location || ""}
                        onChange={(e) => setDetails({ ...details, location: e.target.value })}
                        placeholder={t("location")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <input
                        type="date"
                        value={details.startDate || ""}
                        onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                        placeholder={t("event_date")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <input
                        type="text"
                        value={details.ticketDetails || ""}
                        onChange={(e) => setDetails({ ...details, ticketDetails: e.target.value })}
                        placeholder={t("ticket_details")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <input
                        type="number"
                        value={details.netPrice || ""}
                        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                        placeholder={t("net_price")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>

                      <input
                        type="datetime-local"
                        value={details.expiration || ""}
                        onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                        placeholder={t("expiration_timer")}
                        className="w-full border px-3 py-2 rounded mb-4"
                      />
                    </>
                  ) : category === "visa_support" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-bold text-orange-600 mb-4">{t("new_visa_support")}</h3>

                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <Select
                        options={countryOptions}
                        value={countryOptions.find((option) => option.value === details.visaCountry) || null}
                        onChange={(selected) => setDetails({ ...details, visaCountry: selected?.value })}
                        placeholder={t("select_country")}
                        noOptionsMessage={() => t("country_not_chosen")}
                        className="mb-2"
                      />

                      <textarea
                        value={details.description}
                        onChange={(e) => setDetails({ ...details, description: e.target.value })}
                        placeholder={t("description")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <input
                        type="number"
                        value={details.netPrice}
                        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
                        placeholder={t("net_price")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <label className="flex items-center space-x-2 mb-2">
                        <input
                          type="checkbox"
                          checked={details.isActive}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                        />
                        <span>{t("is_active")}</span>
                      </label>
                    </>
                  ) : (
                    /* Simple/other categories (guide/transport/hotel) */
                    <>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t("description")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={t("price")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                    </>
                  )}

                  {/* Блок изображений */}
                  <ImagesEditor
                    images={images}
                    onUpload={handleImageUpload}
                    onRemove={handleRemoveImage}
                    onReorder={handleReorderImages}
                    onClear={handleClearImages}
                    onMakeCover={makeCover}
                    dragItem={dragItem}
                    dragOverItem={dragOverItem}
                    t={t}
                  />

                  <div className="flex gap-4">
                    <button className="w-full bg-orange-500 text-white py-2 rounded font-bold" onClick={handleSaveService}>
                      {t("save_service")}
                    </button>
                    {selectedService?.id && (
                      <button
                        className="w-full bg-red-600 text-white py-2 rounded font-bold"
                        onClick={() => confirmDeleteService(selectedService.id)}
                      >
                        {t("delete")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== ВХОДЯЩИЕ ЗАПРОСЫ (E2E) ===== */}
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Входящие запросы</h3>
              <button
                onClick={refreshInbox}
                className="text-sm text-orange-600 underline"
                disabled={loadingInbox}
              >
                Обновить
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {requestsInbox.length === 0 && (
                <div className="text-sm text-gray-500">Запросов нет.</div>
              )}

              {requestsInbox.map((r) => (
                <div key={r.id} className="border rounded-lg p-3">
                  <div className="text-sm">
                    <div className="font-medium">
                      #{r.id} • service:{r.service_id} • {r.status}
                    </div>
                    {r.note && <div>Заметка: {r.note}</div>}
                  </div>

                  {/* существующий оффер */}
                  {r.proposal && (
                    <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded text-sm">
                      <div className="font-medium mb-1">Отправлен оффер</div>
                      <div>Цена: {r.proposal.price} {r.proposal.currency}</div>
                      {r.proposal.hotel && <div>Отель: {r.proposal.hotel}</div>}
                      {r.proposal.room && <div>Размещение: {r.proposal.room}</div>}
                      {r.proposal.terms && <div>Условия: {r.proposal.terms}</div>}
                      {r.proposal.message && <div>Сообщение: {r.proposal.message}</div>}
                    </div>
                  )}

                  {/* форма оффера */}
                  <div className="grid md:grid-cols-6 gap-2 mt-3">
                    <input
                      placeholder="Цена"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.price || ""}
                      onChange={(e) => changeProposalForm(r.id, "price", e.target.value)}
                    />
                    <input
                      placeholder="Валюта (USD)"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.currency || ""}
                      onChange={(e) => changeProposalForm(r.id, "currency", e.target.value)}
                    />
                    <input
                      placeholder="Отель"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.hotel || ""}
                      onChange={(e) => changeProposalForm(r.id, "hotel", e.target.value)}
                    />
                    <input
                      placeholder="Размещение (DBL/TRPL)"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.room || ""}
                      onChange={(e) => changeProposalForm(r.id, "room", e.target.value)}
                    />
                    <input
                      placeholder="Условия"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.terms || ""}
                      onChange={(e) => changeProposalForm(r.id, "terms", e.target.value)}
                    />
                    <input
                      placeholder="Сообщение"
                      className="border rounded px-2 py-1"
                      value={proposalForms[r.id]?.message || ""}
                      onChange={(e) => changeProposalForm(r.id, "message", e.target.value)}
                    />
                  </div>

                  <div className="mt-2">
                    <button
                      onClick={() => sendProposal(r.id)}
                      className="bg-orange-500 text-white px-3 py-1 rounded"
                      disabled={loadingInbox}
                    >
                      Отправить оффер
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== МОИ БРОНИ (E2E) ===== */}
          <div className="mt-8">
            <h3 className="text-xl font-semibold mb-3">Мои брони</h3>
            <div className="space-y-3">
              {bookingsInbox.length === 0 && (
                <div className="text-sm text-gray-500">Брони отсутствуют.</div>
              )}
              {bookingsInbox.map((b) => (
                <div
                  key={b.id}
                  className="border rounded-lg p-3 flex items-start justify-between gap-3"
                >
                  <div className="text-sm">
                    <div className="font-medium">
                      #{b.id} • {b.service_title || "услуга"} • {b.status}
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
                          Подтвердить
                        </button>
                        <button
                          onClick={() => rejectBooking(b.id)}
                          className="text-sm bg-red-600 text-white px-3 py-1 rounded"
                          disabled={loadingInbox}
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                    {(b.status === "pending" || b.status === "active") && (
                      <button
                        onClick={() => cancelBooking(b.id)}
                        className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200"
                        disabled={loadingInbox}
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* МОДАЛКА УДАЛЕНИЯ УСЛУГИ */}
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

      {/* Календарь блокировок (guide/transport) */}
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
