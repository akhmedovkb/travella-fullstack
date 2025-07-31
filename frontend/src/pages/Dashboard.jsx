// frontend/src/pages/Dashboard.jsx

import React, { useEffect, useState } from "react";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector";

const Dashboard = () => {
  const { t } = useTranslation();
  const [newPhoto, setNewPhoto] = useState("");
  const [profile, setProfile] = useState({});
  const [services, setServices] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [images, setImages] = useState([]);
  const [details, setDetails] = useState({});
  const [selectedService, setSelectedService] = useState(null);
  const [blockedDates, setBlockedDates] = useState([]);
  const [countryOptions, setCountryOptions] = useState([]);
  const [cityOptionsTo, setCityOptionsTo] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [departureCity, setDepartureCity] = useState(null);
  const [messageService, setMessageService] = useState("");

  const loadHotelOptions = async (inputValue) => {
    try {
      const res = await axios.get(`/api/hotels/search?query=${inputValue}`);
      return res.data.map((h) => ({ value: h.name, label: h.name }));
    } catch (err) {
      return [];
    }
  };

  const loadDepartureCities = async (inputValue) => {
    try {
      const res = await axios.get(
        `https://wft-geo-db.p.rapidapi.com/v1/geo/cities?namePrefix=${inputValue}`,
        {
          headers: {
            "X-RapidAPI-Key": "YOUR_API_KEY",
            "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
          },
        }
      );
      return res.data.data.map((city) => ({
        label: city.name,
        value: city.name,
      }));
    } catch (err) {
      return [];
    }
  };
  

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const readers = files.map((file) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then((base64Images) => {
      setImages((prev) => [...prev, ...base64Images]);
    });
  };

  const handleRemoveImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const fetchProfile = async () => {
      const token = localStorage.getItem("token");
      const res = await axios.get("/api/providers/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfile(res.data);
    };

    const fetchServices = async () => {
      const token = localStorage.getItem("token");
      const res = await axios.get("/api/providers/services", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setServices(res.data);
    };

    fetchProfile();
    fetchServices();
  }, []);

    const renderCreateForm = () => {
    if (!category) return null;

    if (["refused_tour", "author_tour"].includes(category) && profile.type === "agent") {
      return renderAuthorTourForm(); // реализовано ранее
    }

    if (category === "refused_hotel" && profile.type === "agent") {
      return renderRefusedHotelForm();
    }

    if (category === "refused_event_ticket" && profile.type === "agent") {
      return renderEventTicketForm();
    }

    if (category === "refused_flight" && profile.type === "agent") {
      return renderRefusedFlightForm();
    }

    if (category === "visa_support" && profile.type === "agent") {
      return renderVisaSupportForm();
    }

    return renderUniversalForm();
  };

  const renderEditForm = () => {
    if (!selectedService) return null;

    if (["refused_tour", "author_tour"].includes(category) && profile.type === "agent") {
      return renderAuthorTourForm(true);
    }

    if (category === "refused_hotel" && profile.type === "agent") {
      return renderRefusedHotelForm(true);
    }

    if (category === "refused_event_ticket" && profile.type === "agent") {
      return renderEventTicketForm(true);
    }

    if (category === "refused_flight" && profile.type === "agent") {
      return renderRefusedFlightForm(true);
    }

    if (category === "visa_support" && profile.type === "agent") {
      return renderVisaSupportForm(true);
    }

    return renderUniversalForm(true);
  };

    const renderUniversalForm = (isEdit = false) => (
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
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </>
  );

  const renderAuthorTourForm = (isEdit = false) => (
    <>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      {/* Здесь идут поля: страна, города, даты, отель, размещение, питание, трансфер и т.д. */}
      {/* Они уже были реализованы ранее и повторяются в author_tour и refused_tour */}

      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </>
  );

    const renderRefusedHotelForm = (isEdit = false) => (
    <div className="space-y-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("direction_country")}</label>
      <Select
        options={countryOptions}
        value={selectedCountry}
        onChange={(value) => setSelectedCountry(value)}
        placeholder={t("direction_country")}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("direction_to")}</label>
      <AsyncSelect
        cacheOptions
        loadOptions={loadDepartureCities}
        defaultOptions
        placeholder={t("direction_to")}
        noOptionsMessage={() => t("direction_to_not_chosen")}
        value={details.directionTo ? { label: details.directionTo, value: details.directionTo } : null}
        onChange={(option) => setDetails({ ...details, directionTo: option.value })}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("hotel_name")}</label>
      <AsyncSelect
        cacheOptions
        loadOptions={loadHotelOptions}
        defaultOptions
        placeholder={t("hotel")}
        noOptionsMessage={() => t("hotel_not_found")}
        value={details.hotel ? { label: details.hotel, value: details.hotel } : null}
        onChange={(option) => setDetails({ ...details, hotel: option?.value })}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("check_in")}</label>
      <input
        type="date"
        value={details.checkIn || ""}
        onChange={(e) => setDetails({ ...details, checkIn: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      <label className="block text-sm font-medium">{t("check_out")}</label>
      <input
        type="date"
        value={details.checkOut || ""}
        onChange={(e) => setDetails({ ...details, checkOut: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      <label className="block text-sm font-medium">{t("room_category")}</label>
      <input
        value={details.accommodationCategory || ""}
        onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      <label className="block text-sm font-medium">{t("accommodation")}</label>
      <input
        value={details.accommodation || ""}
        onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      <label className="block text-sm font-medium">{t("food")}</label>
      <select
        value={details.food || ""}
        onChange={(e) => setDetails({ ...details, food: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      >
        <option value="">{t("food_options.select")}</option>
        <option value="BB">BB - {t("food_options.bb")}</option>
        <option value="HB">HB - {t("food_options.hb")}</option>
        <option value="FB">FB - {t("food_options.fb")}</option>
        <option value="AI">AI - {t("food_options.ai")}</option>
        <option value="UAI">UAI - {t("food_options.uai")}</option>
      </select>

      <label className="block text-sm font-medium">{t("transfer")}</label>
      <select
        value={details.transfer || ""}
        onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
        className="w-full border px-3 py-2 rounded mb-2"
      >
        <option value="">{t("transfer_options.select")}</option>
        <option value="individual">{t("transfer_options.individual")}</option>
        <option value="group">{t("transfer_options.group")}</option>
        <option value="none">{t("transfer_options.none")}</option>
      </select>

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

      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </div>
  );
  const renderRefusedFlightForm = (isEdit = false) => (
    <div className="space-y-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("direction_country")}</label>
      <Select
        options={countryOptions}
        value={selectedCountry}
        onChange={(value) => setSelectedCountry(value)}
        placeholder={t("direction_country")}
        className="mb-2"
      />

      <div className="flex gap-4">
        <div className="w-1/2">
          <label className="block text-sm font-medium">{t("direction_from")}</label>
          <AsyncSelect
            cacheOptions
            loadOptions={loadDepartureCities}
            defaultOptions
            placeholder={t("direction_from")}
            noOptionsMessage={() => t("direction_from_not_chosen")}
            value={details.directionFrom ? { label: details.directionFrom, value: details.directionFrom } : null}
            onChange={(option) => setDetails({ ...details, directionFrom: option.value })}
          />
        </div>
        <div className="w-1/2">
          <label className="block text-sm font-medium">{t("direction_to")}</label>
          <Select
            options={cityOptionsTo}
            value={details.directionTo ? { label: details.directionTo, value: details.directionTo } : null}
            onChange={(option) => setDetails({ ...details, directionTo: option.value })}
            placeholder={t("direction_to")}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-1/2">
          <label className="block text-sm font-medium">{t("departure_flight_date")}</label>
          <input
            type="date"
            value={details.departureFlightDate || ""}
            onChange={(e) => setDetails({ ...details, departureFlightDate: e.target.value })}
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div className="w-1/2">
          <label className="block text-sm font-medium">{t("return_flight_date")}</label>
          <input
            type="date"
            value={details.returnFlightDate || ""}
            onChange={(e) => setDetails({ ...details, returnFlightDate: e.target.value })}
            className="w-full border px-3 py-2 rounded"
          />
        </div>
      </div>

      <label className="block text-sm font-medium">{t("flight_details")}</label>
      <textarea
        value={details.flightDetails || ""}
        onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
        placeholder={t("enter_flight_details")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("baggage_allowance")}</label>
      <input
        value={details.baggageAllowance || ""}
        onChange={(e) => setDetails({ ...details, baggageAllowance: e.target.value })}
        placeholder={t("enter_baggage")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("comment")}</label>
      <textarea
        value={details.comment || ""}
        onChange={(e) => setDetails({ ...details, comment: e.target.value })}
        placeholder={t("enter_comment")}
        className="w-full border px-3 py-2 rounded"
      />

      <input
        value={details.netPrice || ""}
        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
        placeholder={t("net_price")}
        className="w-full border px-3 py-2 rounded"
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

      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </div>
  );
  const renderEventTicketForm = (isEdit = false) => (
    <div className="space-y-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("direction_country")}</label>
      <Select
        options={countryOptions}
        value={selectedCountry}
        onChange={(value) => setSelectedCountry(value)}
        placeholder={t("direction_country")}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("direction_city")}</label>
      <AsyncSelect
        cacheOptions
        loadOptions={loadDepartureCities}
        defaultOptions
        placeholder={t("direction_city")}
        noOptionsMessage={() => t("direction_city_not_chosen")}
        value={details.directionTo ? { label: details.directionTo, value: details.directionTo } : null}
        onChange={(option) => setDetails({ ...details, directionTo: option.value })}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("event_name")}</label>
      <input
        value={details.eventName || ""}
        onChange={(e) => setDetails({ ...details, eventName: e.target.value })}
        placeholder={t("event_name")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("event_date")}</label>
      <input
        type="date"
        value={details.eventDate || ""}
        onChange={(e) => setDetails({ ...details, eventDate: e.target.value })}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("ticket_category")}</label>
      <input
        value={details.ticketCategory || ""}
        onChange={(e) => setDetails({ ...details, ticketCategory: e.target.value })}
        placeholder={t("ticket_category")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("seat_info")}</label>
      <input
        value={details.seatInfo || ""}
        onChange={(e) => setDetails({ ...details, seatInfo: e.target.value })}
        placeholder={t("seat_info")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("comment")}</label>
      <textarea
        value={details.comment || ""}
        onChange={(e) => setDetails({ ...details, comment: e.target.value })}
        placeholder={t("enter_comment")}
        className="w-full border px-3 py-2 rounded"
      />

      <input
        value={details.netPrice || ""}
        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
        placeholder={t("net_price")}
        className="w-full border px-3 py-2 rounded"
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

      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </div>
  );
  const renderVisaSupportForm = (isEdit = false) => (
    <div className="space-y-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded"
      />

      <label className="block text-sm font-medium">{t("direction_country")}</label>
      <Select
        options={countryOptions}
        value={selectedCountry}
        onChange={(value) => setSelectedCountry(value)}
        placeholder={t("direction_country")}
        className="mb-2"
      />

      <label className="block text-sm font-medium">{t("comment")}</label>
      <textarea
        value={details.comment || ""}
        onChange={(e) => setDetails({ ...details, comment: e.target.value })}
        placeholder={t("enter_comment")}
        className="w-full border px-3 py-2 rounded"
      />

      <input
        value={details.netPrice || ""}
        onChange={(e) => setDetails({ ...details, netPrice: e.target.value })}
        placeholder={t("net_price")}
        className="w-full border px-3 py-2 rounded"
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

      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save_service")}
        </button>
        {isEdit && (
          <button
            className="w-full bg-red-600 text-white py-2 rounded font-bold"
            onClick={() => handleDeleteService(selectedService.id)}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </div>
  );
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

{/* Правый блок — Услуги */}
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
                  setImages([]);
                  setDetails({});
                }}
                className="text-sm text-orange-500 underline"
              >
                {t("back")}
              </button>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {/* 👉 редактирование */}
            {selectedService ? (
              <>{renderEditForm()}</>
            ) : category && !selectedService ? (
              <>
                {/* 👉 создание */}
                {renderCreateForm()}
              </>
            ) : (
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded mb-4">
                {t("new_service_tip")}
              </div>
            )}
          </div>
        </div>

        {/* Список услуг */}
        <div>
          {services
            .filter((s) => s.status === "approved" || s.status === "draft")
            .map((service) => (
              <div
                key={service.id}
                onClick={() => handleSelectService(service)}
                className={`cursor-pointer p-3 rounded border mb-2 ${
                  selectedService?.id === service.id ? "bg-orange-100 border-orange-400" : "hover:bg-gray-50"
                }`}
              >
                <div className="font-bold">{service.title}</div>
                <div className="text-sm text-gray-600">{t("category")}: {service.category}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
