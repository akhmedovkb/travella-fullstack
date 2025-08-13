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

  // === Only bookings inbox kept (requests list рендерит ProviderInboxList) ===
  const [bookingsInbox, setBookingsInbox] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

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

  /** ===== Load profile + services + stats ===== */
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

    // Stats
    axios
      .get(`${API_BASE}/api/providers/stats`, config)
      .then((res) => setStats(res.data || {}))
      .catch(() => setStats({}));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Bookings inbox ===== */
  const refreshBookings = async () => {
    try {
      setLoadingBookings(true);
      const bk = await axios.get(`${API_BASE}/api/bookings/provider`, config);
      setBookingsInbox(Array.isArray(bk.data) ? bk.data : []);
    } catch (e) {
      console.error("Ошибка загрузки броней", e);
      toast.error(e?.response?.data?.message || "Ошибка загрузки броней");
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    if (token) refreshBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const confirmBooking = async (id) => {
    try {
      setLoadingBookings(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/confirm`, {}, config);
      toast.success("Бронь подтверждена");
      await refreshBookings();
    } catch (e) {
      console.error("Ошибка подтверждения", e);
      toast.error(e?.response?.data?.message || "Ошибка подтверждения");
    } finally {
      setLoadingBookings(false);
    }
  };

  const rejectBooking = async (id) => {
    try {
      setLoadingBookings(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/reject`, {}, config);
      toast.success("Бронь отклонена");
      await refreshBookings();
    } catch (e) {
      console.error("Ошибка отклонения", e);
      toast.error(e?.response?.data?.message || "Ошибка отклонения");
    } finally {
      setLoadingBookings(false);
    }
  };

  const cancelBooking = async (id) => {
    try {
      setLoadingBookings(true);
      await axios.post(`${API_BASE}/api/bookings/${id}/cancel`, {}, config);
      toast.success("Бронь отменена");
      await refreshBookings();
    } catch (e) {
      console.error("Ошибка отмены", e);
      toast.error(e?.response?.data?.message || "Ошибка отмены");
    } finally {
      setLoadingBookings(false);
    }
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
                <h3 className="font-semibold text-lg">{t("change_password")}</h3>
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

          {/* Статистика */}
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

          {/* Отзывы клиентов о провайдере */}
          <div className="px-6 mt-6">
            <ProviderReviews providerId={profile?.id} t={t} />
          </div>
        </div>

        {/* Правый блок: услуги + входящие/брони */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
          <div className="mb-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">{t("services")}</h2>
              {selectedService && (
                <button onClick={resetServiceForm} className="text-sm text-orange-500 underline">
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
                        <img src={s.images[0]} alt="" className="w-12 h-12 object-cover rounded" />
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
            <>
              {/* … ваш существующий код форм редактирования (без изменений) … */}
              {/* для краткости оставлен как в вашей версии; он не связан с входящими */}
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
            <>
              {/* … ваш существующий код создания услуги (без изменений) … */}
            </>
          )}

          {/* ===== ВХОДЯЩИЕ ЗАПРОСЫ (read-only) ===== */}
          <div className="mt-8">
            <ProviderInboxList showHeader />
          </div>

          {/* ===== МОИ БРОНИ ===== */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-semibold">Мои брони</h3>
              <button
                onClick={refreshBookings}
                className="text-sm text-orange-600 underline"
                disabled={loadingBookings}
              >
                Обновить
              </button>
            </div>

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
                          disabled={loadingBookings}
                        >
                          Подтвердить
                        </button>
                        <button
                          onClick={() => rejectBooking(b.id)}
                          className="text-sm bg-red-600 text-white px-3 py-1 rounded"
                          disabled={loadingBookings}
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                    {(b.status === "pending" || b.status === "active") && (
                      <button
                        onClick={() => cancelBooking(b.id)}
                        className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200"
                        disabled={loadingBookings}
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
