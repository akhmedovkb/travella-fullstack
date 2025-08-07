import React, { useEffect, useState } from "react";
import Select from "react-select";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector"; // ⬅️ Добавлен импорт
import AsyncSelect from "react-select/async";
import { confirmAlert } from "react-confirm-alert";
import "react-confirm-alert/src/react-confirm-alert.css";
import { useMemo } from "react";

const Dashboard = () => {
  const { t } = useTranslation();
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newAddress, setNewAddress] = useState("");
  const [newCertificate, setNewCertificate] = useState(null);
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [messageProfile, setMessageProfile] = useState("");
  const [messageService, setMessageService] = useState("");
  const [images, setImages] = useState([]);
  const handleRemoveImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]);
  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };
  
  const [countryOptions, setCountryOptions] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [departureCity, setDepartureCity] = useState(null);
  const [cityOptionsFrom, setCityOptionsFrom] = useState([]);
  const [cityOptionsTo, setCityOptionsTo] = useState([]);

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
  visaCountry: "",
});
  
  // 🔹 Календарь услуг
  
const [bookedDates, setBookedDates] = useState([]);
const [blockedDatesFromServer, setBlockedDatesFromServer] = useState([]);
const [blockedDatesLocal, setBlockedDatesLocal] = useState([]);
const [datesToAdd, setDatesToAdd] = useState([]);
const [datesToRemove, setDatesToRemove] = useState([]);
  
const toLocalDate = (strOrDate) => {
  if (strOrDate instanceof Date) return new Date(strOrDate.getFullYear(), strOrDate.getMonth(), strOrDate.getDate());
  if (typeof strOrDate === "string") {
    const [year, month, day] = strOrDate.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (typeof strOrDate === "object" && strOrDate.date) {
    const [year, month, day] = strOrDate.date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(strOrDate);
};


const allBlockedDates = useMemo(() => {
  const server = blockedDatesFromServer
    .map((d) => d.date || d)
    .filter((d) => !datesToRemove.includes(d));

  return [...server, ...datesToAdd].map(toLocalDate);
}, [blockedDatesFromServer, datesToAdd, datesToRemove]);


const [bookedDateMap, setBookedDateMap] = useState({});
const [hoveredDateLabel, setHoveredDateLabel] = useState("");
const handleDateClick = (date) => {
  const dateStr = date.toISOString().split("T")[0];

  // Если уже в базе или локальном списке — снять блокировку
  if (blockedDatesLocal.includes(dateStr)) {
    setBlockedDatesLocal(prev => prev.filter(d => d !== dateStr));
    return;
  }

  // Если уже в серверных — убрать (отображается, но можно снять)
  const serverMatch = blockedDatesFromServer.some(d => {
    const dStr = new Date(d.date || d).toISOString().split("T")[0];
    return dStr === dateStr;
  });

  if (serverMatch) {
    setBlockedDatesFromServer(prev =>
      prev.filter(d => {
        const dStr = new Date(d.date || d).toISOString().split("T")[0];
        return dStr !== dateStr;
      })
    );
    return;
  }

  // Иначе — добавить в локальные блокировки
  setBlockedDatesLocal(prev => [...prev, dateStr]);
};
    // 🔹 тут handleCalendarClick
const handleCalendarClick = (date) => {
  if (!(date instanceof Date) || isNaN(date)) return;

  const clicked = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const clickedStr = clicked.toISOString().split("T")[0];

  const isBooked = bookedDates.some(
    (d) => toLocalDate(d).getTime() === clicked.getTime()
  );
  if (isBooked) return;

  // Был на сервере? Удаляем
  if (blockedDatesFromServer.some((d) => (d.date || d) === clickedStr)) {
    setDatesToRemove((prev) =>
      prev.includes(clickedStr)
        ? prev.filter((d) => d !== clickedStr)
        : [...prev, clickedStr]
    );
    return;
  }

  // Локально добавлен — удалить
  if (datesToAdd.includes(clickedStr)) {
    setDatesToAdd((prev) => prev.filter((d) => d !== clickedStr));
  } else {
    setDatesToAdd((prev) => [...prev, clickedStr]);
  }
};



  
  // 🔹 Фильтрация по активности услуг
const isServiceActive = (s) =>
  !s.details?.expiration || new Date(s.details.expiration) > new Date();
  
  // 🔹 Загрузка отелей по запросу
const loadHotelOptions = async (inputValue) => {
  try {
    const res = await axios.get(
      `${import.meta.env.VITE_API_BASE_URL}/api/hotels/search?query=${inputValue}`
    );
    return res.data;
  } catch (err) {
    console.error("Ошибка загрузки отелей:", err);
    return [];
  }
};
  
  

  // Загрузка стран
useEffect(() => {
  const fetchCountries = async () => {
    try {
      const response = await axios.get("https://restcountries.com/v3.1/all?fields=name,cca2");
      const countries = response.data.map((country) => ({
        value: country.name.common,
        label: country.name.common,
        code: country.cca2, // ISO2 код
      }));
      setCountryOptions(countries.sort((a, b) => a.label.localeCompare(b.label)));
    } catch (error) {
      console.error("Ошибка загрузки стран:", error);
    }
  };
  fetchCountries();
}, []);

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

  
// 🔍 Функция загрузки городов по поиску
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
  
// 🔍 Города отправления — независимо от страны
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

  // 📌 загружаем profile
  
  useEffect(() => {
  const token = localStorage.getItem("token");
  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };

  // Загружаем профиль
  axios
    .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
    .then((res) => {
      setProfile(res.data);
      setNewLocation(res.data.location);
      setNewSocial(res.data.social);
      setNewPhone(res.data.phone);
      setNewAddress(res.data.address);

      // Только для гида и транспорта — загрузка дат
      if (["guide", "transport"].includes(res.data.type)) {
        // 🟦 1. Загрузка дат бронирований
        axios
  .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-dates`, config)
  .then((response) => {
    const formatted = response.data.map((item) => toLocalDate(item.date));
    setBookedDates(formatted);

    console.log("📅 bookedDates (из базы):", formatted);

    const map = {};
    response.data.forEach((item) => {
      const dateKey = toLocalDate(item.date).toDateString();
      map[dateKey] = item.serviceTitle || "Дата забронирована поставщиком";
    });
    setBookedDateMap(map);
  })
  .catch((err) => console.error("Ошибка загрузки занятых дат", err));


        // 🔴 2. Загрузка вручную заблокированных дат
        axios
  .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, config)
  .then((response) => {
    const dates = response.data.map((item) => {
      const d = new Date(item.date);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    });
    setBlockedDatesFromServer(dates);

    console.log("🔴 Заблокированные вручную даты:", dates);
  })
  .catch((err) => console.error("Ошибка загрузки блокировок", err));

      }
    })
    .catch((err) => console.error("Ошибка загрузки профиля", err));

  // Услуги
  axios
    .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
    .then((res) => setServices(res.data))
    .catch((err) => console.error("Ошибка загрузки услуг", err));
}, []);


  
const handleSaveBlockedDates = async () => {
  const token = localStorage.getItem("token");
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const format = (arr) =>
    arr.map((date) => new Date(date).toISOString().split("T")[0]);

  try {
    await axios.post(
      `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
      {
        addDates: format(datesToAdd),
        removeDates: datesToRemove,
      },
      config
    );

    setDatesToAdd([]);
    setDatesToRemove([]);

    // Обновляем вручную заблокированные (не booked)
    const res = await axios.get(
      `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
      config
    );
    const dates = res.data.map((item) => toLocalDate(item.date));
    setBlockedDatesFromServer(dates);

    console.log("✅ Обновлены заблокированные даты:", dates);
  } catch (err) {
    console.error("❌ Ошибка сохранения заблокированных дат:", err);
  }
};


  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewPhoto(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCertificateChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewCertificate(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = () => {
    const updated = {};
    if (newLocation !== profile.location) updated.location = newLocation;
    if (newSocial !== profile.social) updated.social = newSocial;
    if (newPhone !== profile.phone) updated.phone = newPhone;
    if (newPhoto) updated.photo = newPhoto;
    if (newCertificate) updated.certificate = newCertificate;
    if (newAddress !== profile.address) updated.address = newAddress;
    if (Object.keys(updated).length === 0) {
      setMessageProfile(t("no_changes"));
      return;
    }

    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
        setIsEditing(false);
        setMessageProfile(t("profile_updated"));
      })
      .catch(() => setMessageProfile(t("update_error")));
  };

  const handleChangePassword = () => {
    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/change-password`,
        { password: newPassword },
        config
      )
      .then(() => {
        setNewPassword("");
        setMessageProfile(t("password_changed"));
      })
      .catch(() => setMessageProfile(t("password_error")));
  };

// Тут поведение кнопки Сохранить услугу

  const handleSaveService = () => {
  const requiredFieldsByCategory = {
    refused_tour: ["title", "category", "details.directionFrom", "details.directionTo", "details.netPrice"],
    author_tour: ["title", "category", "details.directionFrom", "details.directionTo", "details.netPrice"],
    refused_hotel: ["title", "category", "details.direction", "details.directionTo", "details.startDate", "details.endDate", "details.netPrice"],
    refused_flight: ["title", "category", "details.direction", "details.startDate", "details.netPrice", "details.airline", "details.flightDetails", "details.flightType"],
    refused_event_ticket: ["title", "category", "details.location", "details.startDate", "details.netPrice"],
    visa_support: ["title", "category", "details.description", "details.netPrice"]
  };

  const isExtendedCategory = category in requiredFieldsByCategory;
  const requiredFields = requiredFieldsByCategory[category] || ["title", "description", "category", "price"];

  const getFieldValue = (path) => {
    return path.split(".").reduce((obj, key) => obj?.[key], {
      title,
      description,
      category,
      price,
      details,
    });
  };

  const hasEmpty = requiredFields.some((field) => {
    const value = getFieldValue(field);
    return value === "" || value === undefined;
  });

  // 🔁 Дополнительная проверка для returnDate если рейс туда-обратно
  const needsReturnDate =
    category === "refused_flight" &&
    details.flightType === "round_trip" &&
    (!details.returnDate || details.returnDate === "");

  console.log("📋 Проверка обязательных полей для категории:", category);
console.log("🎯 Обязательные поля:", requiredFields);

requiredFields.forEach((field) => {
  const keys = field.split(".");
  const value = keys.reduce((obj, key) => (obj ? obj[key] : undefined), {
    title,
    description,
    category,
    price,
    details,
  });
  console.log(`⛳ ${field}:`, value);
});

    
  if (hasEmpty || needsReturnDate) {
    setMessageService(t("fill_all_fields"));
    return;
  }

  const data = {
    title,
    category,
    images: images || [],
    price: isExtendedCategory ? undefined : price,
    description: isExtendedCategory ? undefined : description,
    availability: isExtendedCategory ? undefined : availability,
    details: isExtendedCategory ? details : undefined
  };

  if (selectedService) {
    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${selectedService.id}`, data, config)
      .then((res) => {
        setServices((prev) =>
          prev.map((s) => (s.id === selectedService.id ? res.data : s))
        );
        resetServiceForm();
        setMessageService(t("service_updated"));
        setTimeout(() => setMessageService(""), 3000);
      })
      .catch((err) => {
        console.error("Ошибка обновления:", err);
        setMessageService(t("update_error"));
      });
  } else {
    axios
      .post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, data, config)
      .then((res) => {
        setServices((prev) => [...prev, res.data]);
        resetServiceForm();
        setMessageService(t("service_added"));
        setTimeout(() => setMessageService(""), 3000);
      })
      .catch((err) => {
        console.error("Ошибка добавления:", err);
        setMessageService(t("add_error"));
      });
  }
};


// сбрасываем все поля 

const resetServiceForm = () => {
  setSelectedService(null);
  setTitle("");
  setDescription("");
  setPrice("");
  setCategory("");
  setAvailability([]);
  setImages([]);
  setDetails({
    directionCountry: "",
    directionFrom: "",
    directionTo: "",
    startDate: "",
    endDate: "",
    hotel: "",
    roomCategory: "",
    accommodation: "",
    food: "",
    transfer: "",
    changeable: false,
    visaIncluded: false,
    netPrice: "",
    expiration: "",
    isActive: true,
    flightDateGo: "",
    flightDateReturn: "",
    flightDetails: "",
    visaCountry: d.visaCountry || "",
  });
};



  const handleDeleteService = (id) => {
    axios
      .delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config)
      .then(() => {
        setServices((prev) => prev.filter((s) => s.id !== id));
        setSelectedService(null);
      })
      .catch(() => setMessageService(t("delete_error")));
  };

  const loadServiceToEdit = (service) => {
  setSelectedService(service);
  setCategory(service.category);
  setTitle(service.title);
  setImages(service.images || []);
  setMessageService("");

  if (
    ["refused_tour", "author_tour", "refused_hotel", "refused_flight", "refused_event_ticket", "visa_support"].includes(service.category)
  ) {
    const d = service.details || {};
    setDetails({
      // Общие поля
      direction: d.direction || "",
      directionFrom: d.directionFrom || "",
      directionTo: d.directionTo || "",
      startDate: d.startDate || "",
      endDate: d.endDate || "",
      hotel: d.hotel || "",
      accommodation: d.accommodation || "",
      food: d.food || "",
      transfer: d.transfer || "",
      changeable: d.changeable || false,
      visaIncluded: d.visaIncluded || false,
      netPrice: d.netPrice || "",
      expiration: d.expiration || "",
      isActive: d.isActive ?? true,

      // Авиабилет
      flightType: d.flightType || "one_way",
      airline: d.airline || "",
      returnDate: d.returnDate || "",
      startFlightDate: d.startFlightDate || "",
      endFlightDate: d.endFlightDate || "",
      flightDetails: d.flightDetails || "",
      flightDetailsText: d.flightDetailsText || "",

      // Отель
      accommodationCategory: d.accommodationCategory || "",
      adt: d.adt || "",
      chd: d.chd || "",
      inf: d.inf || "",

      // Мероприятие
      location: d.location || "",
      eventName: d.eventName || "",
      eventCategory: d.eventCategory || "",
      ticketDetails: d.ticketDetails || "",

      // Виза
      description: d.description || "",
      visaCountry: d.visaCountry || "",
    });
  } else {
    setDescription(service.description || "");
    setPrice(service.price || "");
    setAvailability(service.availability || []);
  }
};




  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const readers = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then((base64Images) => {
      setImages((prev) => [...prev, ...base64Images]);
    });
  };
  
const getCategoryOptions = (type) => {
  switch (type) {
    case "guide":
      return [
        { value: "city_tour", label: t("city_tour") },
        { value: "mountain_tour", label: t("mountain_tour") },
      ];
    case "transport":
      return [
        { value: "city_tour", label: t("city_tour") },
        { value: "mountain_tour", label: t("mountain_tour") },
        { value: "one_way_transfer", label: t("one_way_transfer") },
        { value: "dinner_transfer", label: t("dinner_transfer") },
        { value: "border_transfer", label: t("border_transfer") },
      ];
    case "agent":
      return [
        { value: "refused_tour", label: t("category.refused_tour") },
        { value: "refused_hotel", label: t("category.refused_hotel") },
        { value: "refused_ticket", label: t("category.refused_ticket") },
        { value: "refused_event", label: t("category.refused_event") },
        { value: "visa_support", label: t("category.visa_support") },
        { value: "authored_tour", label: t("category.authored_tour") },
      ];
    case "hotel":
      return [
        { value: "room_rent", label: t("room_rent") },
        { value: "hotel_transfer", label: t("hotel_transfer") },
        { value: "hall_rent", label: t("hall_rent") },
      ];
    default:
      return [];
  }
};



  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">     
      {/* Левый блок */}
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
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
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
            <input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="border px-3 py-2 rounded w-full" />
          ) : (
            <div className="border px-3 py-2 rounded bg-gray-100">{profile.location}</div>
          )}
        </div>
        <div>
          <label className="block font-medium">{t("social")}</label>
          {isEditing ? (
            <input value={newSocial} onChange={(e) => setNewSocial(e.target.value)} className="border px-3 py-2 rounded w-full" />
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
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleCertificateChange}
                  className="hidden"
                />
              </label>

              {newCertificate ? (
                newCertificate.startsWith("data:image") ? (
                  <img
                    src={newCertificate}
                    alt="Certificate preview"
                    className="w-32 h-32 object-cover border rounded"
                  />
                ) : (
                  <div className="text-sm text-gray-600">📄 {t("file_chosen")}</div>
                )
              ) : (
                <div className="text-sm text-gray-600">{t("no_files_selected")}</div>
              )}
            </div>
          ) : profile.certificate ? (
            <a
              href={profile.certificate}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
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

    {messageProfile && <p className="text-sm text-center text-gray-600 mt-4">{messageProfile}</p>}
  </div>

{/* Правый блок */}

<div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
  <div className="mb-6">
    <div className="flex justify-between items-center">
      <h2 className="text-2xl font-bold">{t("services")}</h2>
      {selectedService && (
        <button
          onClick={() => {
            setSelectedService(null);
            setTitle("");
            setDescription("");
            setCategory("");
            setPrice("");
            set([]);
            setImages([]);
          }}
          className="text-sm text-orange-500 underline"
        >
          {t("back")}
        </button>
      )}
    </div>

    <div className="mt-4 space-y-2">
  {/* Услуги гида */}
  {profile.type === "guide" && (
    <>
      {services.filter(isServiceActive).map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-600">{t(`category.${s.category}`)}</div>
          <div className="text-sm text-gray-800">{t("price")}: {s.price} USD </div>
        </div>
      ))}
    </>
  )}

  {/* Услуги транспорта */}
  {profile.type === "transport" && (
    <>
      {services.filter(isServiceActive).map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-600">{t(`category.${s.category}`)}</div>
          <div className="text-sm text-gray-800">{t("price")}: {s.price} USD </div>
        </div>
      ))}
    </>
  )}

  {/* Услуги турагента */}
  {profile.type === "agent" && (
    <>
      {services.filter(isServiceActive).map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="text-sm text-gray-600">{t(`category.${s.category}`)}</div>
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-800">
            {t("net_price")}: {s.details?.netPrice || 0} USD
          </div>
          {s.details?.hotel && (
            <div className="text-xs text-gray-500">{s.details.hotel}</div>
          )}
          {s.details?.directionTo && (
            <div className="text-xs text-gray-500">
              {t("direction_to")}: {s.details.directionTo}
            </div>
          )}
        </div>
      ))}
    </>
  )}

  {/* Услуги отеля */}
  {profile.type === "hotel" && (
    <>
      {services.filter(isServiceActive).map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-600">{t(s.category)}</div>
          <div className="text-sm text-gray-800">{t("price")}: {s.price} USD </div>
        </div>
      ))}
    </>
  )}
</div>

    
  </div>
  
  
  {selectedService ? (["refused_tour", "author_tour"].includes(category) && profile.type === "agent" ? (
    <>
      <h3 className="text-xl font-semibold mb-2">{t("edit_service")}</h3>
      <div className="mb-2">
        <label className="block font-medium mb-1">{t("title")}</label>
       <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("title")} className="w-full border px-3 py-2 rounded mb-2" />
      </div>
        <div className="flex gap-4 mb-2">
          <Select options={countryOptions} value={selectedCountry} onChange={(value) => setSelectedCountry(value)} placeholder={t("direction_country")} noOptionsMessage={() => t("country_not_chosen")} className="w-1/3" />
          <AsyncSelect cacheOptions defaultOptions loadOptions={loadDepartureCities} onChange={(selected) => setDepartureCity(selected)} placeholder={t("direction_from")} noOptionsMessage={() => t("direction_from_not_chosen")} className="w-1/3" />
          <Select options={cityOptionsTo} placeholder={t("direction_to")} noOptionsMessage={() => t("direction_to_not_chosen")} onChange={(value) => setDetails({ ...details, directionTo: value?.value })} className="w-1/3" />
        </div>
        <div className="flex gap-4 mb-2">
          <div className="w-1/2">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("start_flight_date")}</label>
            <input type="date" value={details.startFlightDate || ""} onChange={(e) => setDetails({ ...details, startFlightDate: e.target.value })} className="w-full border px-3 py-2 rounded" />
          </div>
          <div className="w-1/2">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("end_flight_date")}</label>
            <input type="date" value={details.endFlightDate || ""} onChange={(e) => setDetails({ ...details, endFlightDate: e.target.value })} className="w-full border px-3 py-2 rounded" />
          </div>
        </div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("flight_details")}</label>
          <textarea value={details.flightDetails || ""} onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })} placeholder={t("enter_flight_details")} className="w-full border px-3 py-2 rounded" />
        </div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("hotel")}</label>
        <AsyncSelect cacheOptions defaultOptions loadOptions={loadHotelOptions} value={details.hotel ? { value: details.hotel, label: details.hotel } : null} onChange={(selected) => setDetails((prev) => ({ ...prev, hotel: selected ? selected.value : "" }))} placeholder={t("hotel")} noOptionsMessage={() => t("hotel_not_found")} className="mb-3" />
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
          <input type="text" value={details.accommodationCategory || ""} onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })} className="w-full border px-3 py-2 rounded mb-2" placeholder={t("enter_category")} />
          <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
          <input type="text" value={details.accommodation || ""} onChange={(e) => setDetails({ ...details, accommodation: e.target.value })} className="w-full border px-3 py-2 rounded mb-2" placeholder={t("enter_accommodation")} />
        </div>
        <div className="mb-2">
          <label className="block font-medium mb-1">{t("food")}</label>
          <select value={details.food || ""} onChange={(e) => setDetails({ ...details, food: e.target.value })} className="w-full border px-3 py-2 rounded">
            <option value="">{t("food_options.select")}</option>
            <option value="BB">BB - {t("food_options.bb")}</option>
            <option value="HB">HB - {t("food_options.hb")}</option>
            <option value="FB">FB - {t("food_options.fb")}</option>
            <option value="AI">AI - {t("food_options.ai")}</option>
            <option value="UAI">UAI - {t("food_options.uai")}</option>
          </select>
          <label className="inline-flex items-center mt-2">
            <input type="checkbox" checked={details.halal || false} onChange={(e) => setDetails({ ...details, halal: e.target.checked })} className="mr-2" />
            {t("food_options.halal")}
          </label>
        </div>
        <div className="mb-2">
          <label className="block font-medium mb-1">{t("transfer")}</label>
          <select value={details.transfer || ""} onChange={(e) => setDetails({ ...details, transfer: e.target.value })} className="w-full border px-3 py-2 rounded">
            <option value="">{t("transfer_options.select")}</option>
            <option value="individual">{t("transfer_options.individual")}</option>
            <option value="group">{t("transfer_options.group")}</option>
            <option value="none">{t("transfer_options.none")}</option>
          </select>
        </div>
        <label className="inline-flex items-center mb-2">
          <input type="checkbox" checked={details.visaIncluded || false} onChange={(e) => setDetails({ ...details, visaIncluded: e.target.checked })} className="mr-2" />
          {t("visa_included")}
        </label>
        <br />
        <label className="inline-flex items-center mb-2">
          <input type="checkbox" checked={details.changeable || false} onChange={(e) => setDetails({ ...details, changeable: e.target.checked })} className="mr-2" />
          {t("changeable")}
        </label>
        <input value={details.netPrice || ""} onChange={(e) => setDetails({ ...details, netPrice: e.target.value })} placeholder={t("net_price")} className="w-full border px-3 py-2 rounded mb-2" />
        <label className="block font-medium mt-2 mb-1">{t("expiration_timer")}</label>
        <input type="datetime-local" value={details.expiration || ""} onChange={(e) => setDetails({ ...details, expiration: e.target.value })} className="w-full border px-3 py-2 rounded mb-2" />
        <label className="inline-flex items-center mb-4">
          <input type="checkbox" checked={details.isActive || false} onChange={(e) => setDetails({ ...details, isActive: e.target.checked })} className="mr-2" />
          {t("is_active")}
        </label>
      {/* КНОПКА СОХРАНИТЬ */}
      <button
        className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-4"
        onClick={handleSaveService}
      >
        {t("save_service")}
      </button>
      <button
        className="w-full bg-red-600 text-white py-2 rounded font-bold mt-2"
        onClick={() => handleDeleteService(selectedService.id)}
      >
        {t("delete")}
      </button>
    </>
  ) : (category === "refused_hotel" && profile.type === "agent") ? (
    // 🔶 ВСТАВЬ СЮДА форму редактирования отказного отеля:
    <>
      <h3 className="text-xl font-semibold mb-2">{t("edit_service")}</h3>
      <div className="mb-2">
        <label className="block font-medium mb-1">{t("title")}</label>
       <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded mb-2"
       />
      </div>

      <div className="mb-2">
        <label className="block font-medium mb-1">{t("direction_country")}</label>
        <Select
          options={countryOptions}
          value={countryOptions.find((c) => c.value === details.direction)}
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
          value={{ label: details.directionTo, value: details.directionTo }}
          onChange={(selected) => setDetails({ ...details, directionTo: selected?.value || "" })}
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
          onChange={(selected) => setDetails({ ...details, hotel: selected?.value || "" })}
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
      </div>

      <div className="mb-2">
        <label className="block font-medium mb-1">{t("transfer")}</label>
        <select
          value={details.transfer || ""}
          onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
          className="w-full border px-3 py-2 rounded"
        >
          <option value="">{t("transfer_options.select")}</option>
          <option value="group">{t("transfer_options.individual")}</option>
          <option value="individual">{t("transfer_options.group")}</option>
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

      <button
        className="w-full bg-orange-500 text-white py-2 rounded font-bold"
        onClick={handleSaveService}
      >
        {t("save_service")}
      </button>
      <button
        className="w-full bg-red-600 text-white py-2 rounded font-bold mt-2"
        onClick={() => handleDeleteService(selectedService.id)}
      >
        {t("delete")}
      </button>
    </>
  ) : (category === "refused_flight" && profile.type === "agent") ? (
    // 🔶 ВСТАВЬ СЮДА форму редактирования отказного отеля:
    <>
        {/* ✈️ Форма отказного авиабилета */}
    <h3 className="text-xl font-semibold mb-2">{t("new_refused_airtkt")}</h3>

    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={t("title")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    {/* Направление */}
    <div className="flex gap-4 mb-2">
  {/* Страна направления */}
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

  {/* Город отправления (AsyncSelect) */}
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

  {/* Город прибытия */}
  <Select
    options={cityOptionsTo}
    value={
      cityOptionsTo.find((opt) => opt.value === details.directionTo) || null
    }
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

   {/* Радиокнопки: В одну сторону / туда-обратно */}
<div className="mb-3">
  <label className="block font-medium mb-1">{t("flight_type")}</label>
  <div className="flex gap-4">
    <label className="inline-flex items-center">
      <input
        type="radio"
        checked={details.flightType === "one_way"}
        onChange={() =>
          setDetails({
            ...details,
            flightType: "one_way",
            oneWay: true,
            returnDate: ""
          })
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
          setDetails({
            ...details,
            flightType: "round_trip",
            oneWay: false
          })
        }
        className="mr-2"
      />
      {t("round_trip")}
    </label>
  </div>
</div>


    {/* Даты */}
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

      {details.oneWay === false && (
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

    {/* Авиакомпания */}
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

    {/* Детали рейса */}
    <div className="mb-2">
      <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
      <textarea
        value={details.flightDetails || ""}
        onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
        placeholder={t("enter_flight_details")}
        className="w-full border px-3 py-2 rounded"
      />
    </div>

    {/* Цена */}
    <input
      value={details.netPrice || ""}
      onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-3"
    />

     {/* ⏳ Таймер актуальности */}
    <div className="mb-3">
      <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
      <input
        type="datetime-local"
        value={details.expiration || ""}
        onChange={(e) =>
          setDetails({ ...details, expiration: e.target.value })
        }
        className="w-full border px-3 py-2 rounded"
      />
    </div>
    
    {/* Актуальность */}
    <label className="inline-flex items-center mb-4">
      <input
        type="checkbox"
        checked={details.isActive || false}
        onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
        className="mr-2"
      />
      {t("is_active")}
    </label>

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>              
    </>  
  
  ) : (category === "refused_event_ticket" && profile.type === "agent") ? (
    // 🔶 ВСТАВЬ СЮДА форму редактирования отказного билета на мероприятие:
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
        ].find((opt) => opt.value === details.eventCategory)
      }
      onChange={(selected) =>
        setDetails({ ...details, eventCategory: selected.value })
      }
      placeholder={t("select_event_category")}
      className="mb-2"
    />

    <input
      type="text"
      value={details.location || ""}
      onChange={(e) =>
        setDetails({ ...details, location: e.target.value })
      }
      placeholder={t("location")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="date"
      value={details.startDate || ""}
      onChange={(e) =>
        setDetails({ ...details, startDate: e.target.value })
      }
      placeholder={t("event_date")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="text"
      value={details.ticketDetails || ""}
      onChange={(e) =>
        setDetails({ ...details, ticketDetails: e.target.value })
      }
      placeholder={t("ticket_details")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="number"
      value={details.netPrice || ""}
      onChange={(e) =>
        setDetails({ ...details, netPrice: e.target.value })
      }
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <label className="inline-flex items-center mb-2">
      <input
        type="checkbox"
        checked={details.isActive || false}
        onChange={(e) =>
          setDetails({ ...details, isActive: e.target.checked })
        }
        className="mr-2"
      />
      {t("is_active")}
    </label>

    <input
      type="datetime-local"
      value={details.expiration || ""}
      onChange={(e) =>
        setDetails({ ...details, expiration: e.target.value })
      }
      placeholder={t("expiration_timer")}
      className="w-full border px-3 py-2 rounded mb-4"
    />

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>
    </>  
      ) : (category === "visa_support" && profile.type === "agent") ? (
    // 🔶 ВСТАВЬ СЮДА форму редактирования отказного билета на мероприятие:
    <>
        <h3 className="text-xl font-bold text-orange-600 mb-4">{t("new_visa_support")}</h3>
     
      <input
    type="text"
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder={t("title")}
    className="w-full border px-3 py-2 rounded mb-2"
      />
    
      {/* Выбор страны */}
    <Select
      options={countryOptions}
      value={countryOptions.find((option) => option.value === details.visaCountry)}
      onChange={(selected) => {
        setDetails({ ...details, visaCountry: selected?.value });
      }}
      placeholder={t("select_country")}
      noOptionsMessage={() => t("country_not_chosen")}
      className="mb-2"
    />

    {/* Описание визовой поддержки */}
    <textarea
      value={details.description}
      onChange={(e) => setDetails({ ...details, description: e.target.value })}
      placeholder={t("description")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    {/* Цена */}
    <input
      type="number"
      value={details.netPrice}
      onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    {/* Чекбокс актуальности */}
    <label className="flex items-center space-x-2 mb-2">
      <input
        type="checkbox"
        checked={details.isActive}
        onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
      />
      <span>{t("is_active")}</span>
    </label>

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>                                
    </>                  
                     ) : (
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
      <div className="mb-4">
       <label className="block font-medium mb-1">{t("upload_images")}</label>
       <div className="mb-2">
        <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
        {t("choose_files")}
         <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          className="hidden"
         />
        </label>
        <div className="mt-1 text-sm text-gray-600">
        {images.length > 0
        ? t("file_chosen", { count: images.length })
        : t("no_files_selected")}
        </div>
       </div>

        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => (
            <div key={idx} className="relative">
              <img
                src={img}
                alt={`preview-${idx}`}
                className="w-20 h-20 object-cover rounded"
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(idx)}
                className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                title="Удалить"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save")}
        </button>
        <button
          className="w-full bg-red-600 text-white py-2 rounded font-bold"
          onClick={() => handleDeleteService(selectedService.id)}
        >
          {t("delete")}
        </button>
      </div>
    </>
   ) 
  ) : (
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
    // Сбросить дополнительные поля
    setDetails({
      direction: "",
      startDate: "",
      endDate: "",
      hotel: "",
      accommodation: "",
      food: "",
      transfer: "",
      changeable: false,
      visaIncluded: false,
      netPrice: "",
      expiration: "",
      isActive: true,
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

{/* 🟧 Показываем форму ТОЛЬКО если выбрана категория */}
{category && (
  <>
     {(category === "refused_tour" || category === "author_tour") && profile.type === "agent" ? (
      <>
      <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={t("title")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

      {/* тут вводим направление */}
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
    setDetails((prev) => ({ ...prev, directionFrom: selected?.value }));
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
    setDetails({ ...details, directionTo: value?.value })
  }
  className="w-1/3"
/>

</div>


      {/* тут вводим даты отпр и прил */}
      
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


        {/* тут вводим отель */}
    <label className="block text-sm font-medium text-gray-700 mb-1">
  {t("hotel")}
</label>
<AsyncSelect
  cacheOptions
  defaultOptions
  loadOptions={loadHotelOptions}
  value={details.hotel ? { value: details.hotel, label: details.hotel } : null}
  onChange={(selected) =>
    setDetails((prev) => ({ ...prev, hotel: selected ? selected.value : "" }))
  }
  placeholder={t("hotel")}
  noOptionsMessage={() => t("hotel_not_found")}
  className="mb-3"
/>

    {/* тут вводим accommodation */}

    <div className="mb-4">
  <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
  <input
    type="text"
    value={details.accommodationCategory || ""}
    onChange={(e) =>
      setDetails({ ...details, accommodationCategory: e.target.value })
    }
    className="w-full border px-3 py-2 rounded mb-2"
    placeholder={t("enter_category")}
  />
       {/* тут вводим размешение */}
  <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
  <input
    type="text"
    value={details.accommodation || ""}
    onChange={(e) =>
      setDetails({ ...details, accommodation: e.target.value })
    }
    className="w-full border px-3 py-2 rounded mb-2"
    placeholder={t("enter_accommodation")}
  />

  <div className="flex gap-4">
    <div className="flex flex-col">
      <label className="text-sm font-medium">{t("adt")}</label>
      <input
        type="number"
        value={details.adt || ""}
        onChange={(e) =>
          setDetails({ ...details, adt: e.target.value })
        }
        className="w-24 border px-2 py-1 rounded"
      />
    </div>

    <div className="flex flex-col">
      <label className="text-sm font-medium">{t("chd")}</label>
      <input
        type="number"
        value={details.chd || ""}
        onChange={(e) =>
          setDetails({ ...details, chd: e.target.value })
        }
        className="w-24 border px-2 py-1 rounded"
      />
    </div>

    <div className="flex flex-col">
      <label className="text-sm font-medium">{t("inf")}</label>
      <input
        type="number"
        value={details.inf || ""}
        onChange={(e) =>
          setDetails({ ...details, inf: e.target.value })
        }
        className="w-24 border px-2 py-1 rounded"
      />
    </div>
  </div>
</div>

        {/* тут вводим питание */}
      
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

          {/* тут вводим трансфер */}
      
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
    <br></br>
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

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>
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
      value={countryOptions.find((c) => c.value === details.direction)}
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

  <button
    className="w-full bg-orange-500 text-white py-2 rounded font-bold"
    onClick={handleSaveService}
  >
    {t("save_service")}
  </button>
</>

    ) : category === "refused_flight" && profile.type === "agent" ? (
      <>
        {/* ✈️ Форма отказного авиабилета */}
    <h3 className="text-xl font-semibold mb-2">{t("new_refused_airtkt")}</h3>

    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={t("title")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

      {/* Направление */}
    <div className="flex gap-4 mb-2">
  {/* Страна направления */}
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

  {/* Город отправления (AsyncSelect) */}
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

  {/* Город прибытия */}
  <Select
    options={cityOptionsTo}
    value={
      cityOptionsTo.find((opt) => opt.value === details.directionTo) || null
    }
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

   {/* Радиокнопки: В одну сторону / туда-обратно */}
<div className="mb-3">
  <label className="block font-medium mb-1">{t("flight_type")}</label>
  <div className="flex gap-4">
    <label className="inline-flex items-center">
      <input
        type="radio"
        checked={details.flightType === "one_way"}
        onChange={() =>
          setDetails({
            ...details,
            flightType: "one_way",
            oneWay: true,
            returnDate: ""
          })
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
          setDetails({
            ...details,
            flightType: "round_trip",
            oneWay: false
          })
        }
        className="mr-2"
      />
      {t("round_trip")}
    </label>
  </div>
</div>


    {/* Даты */}
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

      {details.oneWay === false && (
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

    {/* Авиакомпания */}
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

    {/* Детали рейса */}
    <div className="mb-2">
      <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
      <textarea
        value={details.flightDetails || ""}
        onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
        placeholder={t("enter_flight_details")}
        className="w-full border px-3 py-2 rounded"
      />
    </div>

    {/* Цена */}
    <input
      value={details.netPrice || ""}
      onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-3"
    />

        {/* ⏳ Таймер актуальности */}
    <div className="mb-3">
      <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
      <input
        type="datetime-local"
        value={details.expiration || ""}
        onChange={(e) =>
          setDetails({ ...details, expiration: e.target.value })
        }
        className="w-full border px-3 py-2 rounded"
      />
    </div>
        
    {/* Актуальность */}
    <label className="inline-flex items-center mb-4">
      <input
        type="checkbox"
        checked={details.isActive || false}
        onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
        className="mr-2"
      />
      {t("is_active")}
    </label>

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>
  </>
    ) : category === "refused_event_ticket" && profile.type === "agent" ? (
      <>
        {/* 🎫 Форма отказного билета на мероприятие */}
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
        ].find((opt) => opt.value === details.eventCategory)
      }
      onChange={(selected) =>
        setDetails({ ...details, eventCategory: selected.value })
      }
      placeholder={t("select_event_category")}
      className="mb-2"
    />

    <input
      type="text"
      value={details.location || ""}
      onChange={(e) =>
        setDetails({ ...details, location: e.target.value })
      }
      placeholder={t("location")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="date"
      value={details.startDate || ""}
      onChange={(e) =>
        setDetails({ ...details, startDate: e.target.value })
      }
      placeholder={t("event_date")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="text"
      value={details.ticketDetails || ""}
      onChange={(e) =>
        setDetails({ ...details, ticketDetails: e.target.value })
      }
      placeholder={t("ticket_details")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <input
      type="number"
      value={details.netPrice || ""}
      onChange={(e) =>
        setDetails({ ...details, netPrice: e.target.value })
      }
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    <label className="inline-flex items-center mb-2">
      <input
        type="checkbox"
        checked={details.isActive || false}
        onChange={(e) =>
          setDetails({ ...details, isActive: e.target.checked })
        }
        className="mr-2"
      />
      {t("is_active")}
    </label>

    <input
      type="datetime-local"
      value={details.expiration || ""}
      onChange={(e) =>
        setDetails({ ...details, expiration: e.target.value })
      }
      placeholder={t("expiration_timer")}
      className="w-full border px-3 py-2 rounded mb-4"
    />

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>
      </>
    ) : category === "visa_support" && profile.type === "agent" ? (
      <>
        {/* 🛂 Форма визовой поддержки */}
        <h3 className="text-xl font-bold text-orange-600 mb-4">{t("new_visa_support")}</h3>

        <input
    type="text"
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder={t("title")}
    className="w-full border px-3 py-2 rounded mb-2"
      />
        

    {/* Выбор страны */}
    <Select
      options={countryOptions}
      value={countryOptions.find((option) => option.value === details.visaCountry)}
      onChange={(selected) => {
        setDetails({ ...details, visaCountry: selected?.value });
      }}
      placeholder={t("select_country")}
      noOptionsMessage={() => t("country_not_chosen")}
      className="mb-2"
    />

    {/* Описание визовой поддержки */}
    <textarea
      value={details.description}
      onChange={(e) => setDetails({ ...details, description: e.target.value })}
      placeholder={t("description")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    {/* Цена */}
    <input
      type="number"
      value={details.netPrice}
      onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
      placeholder={t("net_price")}
      className="w-full border px-3 py-2 rounded mb-2"
    />

    {/* Чекбокс актуальности */}
    <label className="flex items-center space-x-2 mb-2">
      <input
        type="checkbox"
        checked={details.isActive}
        onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
      />
      <span>{t("is_active")}</span>
    </label>

    <button
      className="w-full bg-orange-500 text-white py-2 rounded font-bold"
      onClick={handleSaveService}
    >
      {t("save_service")}
    </button>
      </>
    ) : (
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

        {/* Изображения */}
        <div className="mb-4">
          <label className="block font-medium mb-1">{t("upload_images")}</label>
          <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
            {t("choose_files")}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
          </label>
          <div className="mt-1 text-sm text-gray-600">
            {images.length > 0
              ? t("file_chosen", { count: images.length })
              : t("no_files_selected")}
          </div>
          <div className="flex gap-2 flex-wrap mt-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative">
                <img
                  src={img}
                  alt={`preview-${idx}`}
                  className="w-20 h-20 object-cover rounded"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                  title={t("delete")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

            <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
      </>
    )}
  </>
)}


    </>
  )}

  {messageService && (
    <p className="text-sm text-center text-gray-600 mt-4">{messageService}</p>
  )}
{/* Перенесённый календарь */}
{(profile.type === "guide" || profile.type === "transport") && (
  <div className="mt-10 bg-white p-6 rounded shadow border">
    <h3 className="text-lg font-semibold mb-4 text-orange-600">
      {t("calendar.blocking_title")}
    </h3>
    

<DayPicker
  mode="multiple"
  selected={allBlockedDates}
  disabled={bookedDates.map(toLocalDate)}
  modifiers={{
    blocked: allBlockedDates,
    booked: bookedDates.map(toLocalDate), // ✅ важно!
  }}
  modifiersClassNames={{
    blocked: "bg-red-500 text-white",
    booked: "bg-blue-500 text-white",
  }}
  onDayClick={handleCalendarClick}
  fromDate={new Date()}
/>



    {/* 💾 Кнопка сохранения */}
    <button
      onClick={handleSaveBlockedDates}
      className="mt-4 bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
    >
      {t("calendar.save_blocked_dates")}
    </button>

    {/* 🔎 Легенда */}
    <div className="mt-2 text-sm text-gray-600 flex gap-4">
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-red-400 inline-block"></span>
        <span>{t("calendar.label_blocked_manual")}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-blue-500 inline-block"></span>
        <span>{t("calendar.label_booked_by_clients")}</span>
      </div>
    </div>

    {/* 🧠 Tooltip */}
    {hoveredDateLabel && (
      <div className="mt-2 text-sm italic text-gray-600">
        {hoveredDateLabel}
      </div>
    )}
  </div>
)}
 
</div>
</div>
 
);
};

export default Dashboard;
