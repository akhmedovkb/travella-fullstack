import React, { useEffect, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector"; // ⬅️ Добавлен импорт

import Select from "react-select";
import { countryOptions, cityOptions } from "../data/locationOptions";
const { i18n } = useTranslation();
const currentLang = i18n.language;

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
  const config = { headers: { Authorization: Bearer ${token} } };
  
  const [details, setDetails] = useState({
  directionCountry: "",     // Страна направления
  directionFrom: "",        // Город отправления
  directionTo: "",          // Город прибытия
  flightDepartureDate: "",  // Дата рейса вылета
  flightReturnDate: "",     // Дата рейса обратно
  flightDetails: "",        // Детали рейса
  hotel: "",                // Отель
  accommodationCategory: "",// Категория размещения
  accommodation: "",        // Тип размещения
  adt: "",                  // Взрослые
  chd: "",                  // Дети
  inf: "",                  // Младенцы
  food: "",                 
  halal: false,
  transfer: "",
  changeable: false,
  visaIncluded: false,
  netPrice: "",
  expiration: "",
  isActive: true,
});

  const [blockedDates, setBlockedDates] = useState([]); // ⬅️ Календарь объявлен
  const handleSaveBlockedDates = async () => {
  try {
    await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, {
      dates: blockedDates,
    }, config);
    alert(t("calendar.saved_successfully"));
  } catch (err) {
    console.error("Ошибка сохранения дат:", err);
    alert(t("calendar.save_error"));
  }
      };

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
      .then((res) => {
        setProfile(res.data);
        setNewLocation(res.data.location);
        setNewSocial(res.data.social);
        setNewPhone(res.data.phone);
        setNewAddress(res.data.address);
      })
      .catch((err) => console.error("Ошибка загрузки профиля", err));

    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
      .then((res) => setServices(res.data))
      .catch((err) => console.error("Ошибка загрузки услуг", err));
  }, []);

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

  const handleSaveService = () => {
    if (!title || !description || !category || !price || !length === 0) {
      setMessageService(t("fill_all_fields"));
      return;
    }

    const data = { title, description, category, price, images, details };

    if (selectedService) {
      axios
        .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${selectedService.id}`, data, config)
        .then(() => {
          setServices((prev) =>
            prev.map((s) => (s.id === selectedService.id ? { ...s, ...data } : s))
          );
          setSelectedService(null);
          setTitle("");
          setDescription("");
          setCategory("");
          setPrice("");
          setAvailability([]);
          setImages([]);
          setMessageService(t("service_updated"));
        })
        .catch(() => setMessageService(t("update_error")));
    } else {
      axios
        .post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, data, config)
        .then((res) => {
          setServices((prev) => [...prev, res.data]);
          setTitle("");
          setDescription("");
          setCategory("");
          setPrice("");
          setAvailability([]);
          setMessageService(t("service_added"));
        })
        .catch(() => setMessageService(t("add_error")));
    }
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
    setTitle(service.title);
    setDescription(service.description);
    setCategory(service.category);
    setPrice(service.price);
    setAvailability(service.map((d) => new Date(d)));
    setMessageService("");
    setImages(service.images || []);
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
    <div className="flex justify-between items-start mb-4">
      <h2 className="text-2xl font-bold">{t("provider_profile")}</h2>
      <LanguageSelector />
    </div>

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
              src={https://www.google.com/maps?q=${encodeURIComponent(profile.address)}&output=embed}
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
      {services.map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-600">{t(s.category)}</div>
          <div className="text-sm text-gray-800">
            {t("price")}: {s.price} сум
          </div>
        </div>
      ))}
    </div>
  </div>
  
  {selectedService ? (
    <>
      <select
  value={category}
  onChange={(e) => setCategory(e.target.value)}
  className="w-full border px-3 py-2 rounded mb-2 bg-white"
>
  <option value="">{t("select_category")}</option>
  {getCategoryOptions(profile.type).map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ))}
</select>

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
                alt={preview-${idx}}
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
    {["refused_tour", "author_tour"].includes(category) ? ( <>
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={t("title")}
      className="w-full border px-3 py-2 rounded mb-2"
    />
    {/* 1. Страна и города */}
<label className="block font-medium mt-2 mb-1">{t("country")}</label>
<input
  value={details.country || ""}
  onChange={(e) => setDetails({ ...details, country: e.target.value })}
  placeholder={t("country")}
  className="w-full border px-3 py-2 rounded mb-2"
/>

<div className="flex gap-4 mb-2">
  <div className="w-1/2">
    <label className="block font-medium mb-1">{t("from_city")}</label>
    <input
      value={details.fromCity || ""}
      onChange={(e) => setDetails({ ...details, fromCity: e.target.value })}
      className="w-full border px-3 py-2 rounded"
    />
  </div>
  <div className="w-1/2">
    <label className="block font-medium mb-1">{t("to_city")}</label>
    <input
      value={details.toCity || ""}
      onChange={(e) => setDetails({ ...details, toCity: e.target.value })}
      className="w-full border px-3 py-2 rounded"
    />
  </div>
</div>

{/* 2. Даты и детали рейсов */}
<label className="block font-medium mt-2 mb-1">{t("flight_departure_date")}</label>
<input
  type="date"
  value={details.flightStartDate || ""}
  onChange={(e) => setDetails({ ...details, flightStartDate: e.target.value })}
  className="w-full border px-3 py-2 rounded mb-2"
/>
<input
  value={details.flightStartDetails || ""}
  onChange={(e) => setDetails({ ...details, flightStartDetails: e.target.value })}
  placeholder={t("flight_details")}
  className="w-full border px-3 py-2 rounded mb-4"
/>

<label className="block font-medium mb-1">{t("flight_return_date")}</label>
<input
  type="date"
  value={details.flightEndDate || ""}
  onChange={(e) => setDetails({ ...details, flightEndDate: e.target.value })}
  className="w-full border px-3 py-2 rounded mb-2"
/>
<input
  value={details.flightEndDetails || ""}
  onChange={(e) => setDetails({ ...details, flightEndDetails: e.target.value })}
  placeholder={t("flight_details")}
  className="w-full border px-3 py-2 rounded mb-4"
/>

{/* 3. Отель с автозаполнением */}
<label className="block font-medium mb-1">{t("hotel")}</label>
<input
  list="hotelOptions"
  value={details.hotel || ""}
  onChange={(e) => setDetails({ ...details, hotel: e.target.value })}
  className="w-full border px-3 py-2 rounded mb-2"
/>
<datalist id="hotelOptions">
  <option value="Hyatt Regency" />
  <option value="Radisson Blu" />
  <option value="Hilton Tashkent" />
</datalist>

{/* 4. Размещение с категорией и ADT/CHD/INF */}
<label className="block font-medium mb-1">{t("room_category")}</label>
<input
  value={details.roomCategory || ""}
  onChange={(e) => setDetails({ ...details, roomCategory: e.target.value })}
  className="w-full border px-3 py-2 rounded mb-2"
/>

<label className="block font-medium mb-1">{t("accommodation")}</label>
<input
  value={details.accommodation || ""}
  onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
  className="w-full border px-3 py-2 rounded mb-2"
/>

<div className="flex gap-4 mb-2">
  <div className="w-1/3">
    <label className="block text-sm">{t("adt")}</label>
    <input
      type="number"
      value={details.adt || ""}
      onChange={(e) => setDetails({ ...details, adt: e.target.value })}
      className="w-full border px-3 py-2 rounded"
    />
  </div>
  <div className="w-1/3">
    <label className="block text-sm">{t("chd")}</label>
    <input
      type="number"
      value={details.chd || ""}
      onChange={(e) => setDetails({ ...details, chd: e.target.value })}
      className="w-full border px-3 py-2 rounded"
    />
  </div>
  <div className="w-1/3">
    <label className="block text-sm">{t("inf")}</label>
    <input
      type="number"
      value={details.inf || ""}
      onChange={(e) => setDetails({ ...details, inf: e.target.value })}
      className="w-full border px-3 py-2 rounded"
    />
  </div>
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
                  alt={preview-${idx}}
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

 {/* 📅 Новый отдельный календарь занятости поставщика */}
{profile.type === "guide" || profile.type === "transport" ? (
  <div className="mt-10 bg-white p-6 rounded shadow border">
    <h3 className="text-lg font-semibold mb-4 text-orange-600">
      {t("calendar.blocking_title")}
    </h3>

    <DayPicker
      mode="multiple"
      selected={blockedDates}
      onSelect={setBlockedDates}
      disabled={{ before: new Date() }}
      modifiersClassNames={{
        selected: "bg-red-400 text-white",
      }}
      className="border rounded p-4"
    />

    <button
      onClick={handleSaveBlockedDates}
      className="mt-4 bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
    >
      {t("calendar.save_blocked_dates")}
    </button>
  </div>
): null}
  
    </div>
   </div>
  );
};

export default Dashboard;
