// frontend/src/pages/Register.jsx
import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
import { toast } from "../ui/toast"; // единый реэкспорт react-hot-toast

// Простая нормализация и валидация номера телефона (E.164)
const normalizePhone = (raw = "") => {
  const trimmed = String(raw).trim();
  // оставляем только + и цифры
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus + digits;
};
const isValidE164 = (phone) => /^\+[1-9]\d{7,14}$/.test(phone); // от 8 до 15 цифр после +

const Register = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    type: "guide",
    location: "",
    photo: "",
    phone: "",
    email: "",
    social: "",
    password: "",
  });

  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  // стабильный дебаунс для подсказок
  const debounceRef = useRef(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchCities = async (query) => {
    const q = (query || "").trim();
    if (!q || q.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    try {
      const resp = await axios.get("https://wft-geo-db.p.rapidapi.com/v1/geo/cities", {
        params: { namePrefix: q, limit: 5, sort: "-population", countryIds: "UZ" },
        headers: {
          "X-RapidAPI-Key": import.meta.env.VITE_GEODB_API_KEY,
          "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
        },
      });
      const cities = (resp.data?.data || []).map((c) => c.city);
      setLocationSuggestions(cities);
    } catch (err) {
      // Часто 429 — не шумим пользователю, просто убираем список
      console.warn("GeoDB autocomplete:", err?.response?.status || err?.message);
      setLocationSuggestions([]);
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((p) => ({ ...p, location: city }));
    setLocationSuggestions([]);
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;

    if (name === "photo" && files && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((p) => ({ ...p, photo: String(reader.result || "") }));
      };
      reader.readAsDataURL(files[0]);
      return;
    }

    if (name === "location") {
      setFormData((p) => ({ ...p, location: value }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchCities(value), 500);
      return;
    }

    if (name === "phone") {
      // позволяем вводить в свободной форме, но сохраняем нормализованную копию рядом
      setFormData((p) => ({ ...p, phone: value }));
      if (!phoneTouched) setPhoneTouched(true);
      return;
    }

    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // валидация телефона
    const normalized = normalizePhone(formData.phone);
    if (!isValidE164(normalized)) {
      toast.error(t("register.phone_error"));
      setPhoneTouched(true);
      return;
    }

    const payload = {
      ...formData,
      phone: normalized,           // отправляем нормализованный
      location: [formData.location] // бэк ждёт массив
    };

    try {
      setSubmitting(true);
      await toast.promise(
        axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/register`,
          payload,
          { headers: { "Content-Type": "application/json" } }
        ),
        {
          loading: t("register.loading") || "Отправка…",
          success: t("register.success"),
          error: (err) =>
            err?.response?.data?.error ||
            err?.message ||
            t("register.error"),
        }
      );
      navigate("/login");
    } catch (err) {
      console.error("Register error:", err);
      // сообщение уже показано в toast.promise
    } finally {
      setSubmitting(false);
    }
  };

  const phoneNormalized = normalizePhone(formData.phone);
  const phoneInvalid = phoneTouched && !isValidE164(phoneNormalized);

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form onSubmit={handleSubmit} className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-orange-600">{t("register.title")}</h2>
          <LanguageSelector />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Левая колонка */}
          <div className="relative">
            <label className="block mb-1">{t("register.name")}</label>
            <input
              name="name"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.type")}</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            >
              <option value="guide">{t("guide")}</option>
              <option value="transport">{t("transport")}</option>
              <option value="agent">{t("agent")}</option>
              <option value="hotel">{t("hotel")}</option>
            </select>

            <label className="block mb-1">{t("location")}</label>
            <input
              name="location"
              value={formData.location}
              required
              lang={i18n.language}
              onChange={handleChange}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-1"
            />
            {locationSuggestions.length > 0 && (
              <ul className="absolute z-10 w-full bg-white border max-h-40 overflow-y-auto">
                {locationSuggestions.map((city, idx) => (
                  <li
                    key={`${city}-${idx}`}
                    onClick={() => handleLocationSelect(city)}
                    className="p-2 border-b cursor-pointer hover:bg-gray-100"
                  >
                    {city}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <label className="block font-medium mb-1">{t("register.photo")}</label>
              <div className="flex items-center gap-4">
                <label className="bg-orange-500 text-white py-2 px-4 rounded cursor-pointer hover:bg-orange-600">
                  {t("register.select_file")}
                  <input
                    type="file"
                    name="photo"
                    accept="image/*"
                    onChange={handleChange}
                    className="hidden"
                  />
                </label>
                <span className="text-sm text-gray-600">
                  {formData.photo ? t("register.file_chosen") : t("register.no_file")}
                </span>
              </div>
            </div>
          </div>

          {/* Правая колонка */}
          <div>
            <label className="block mb-1">{t("register.phone")}</label>
            <input
              name="phone"
              value={formData.phone}
              required
              lang={i18n.language}
              onChange={handleChange}
              onBlur={() => setPhoneTouched(true)}
              className={`w-full border p-2 ${phoneInvalid ? "border-red-500" : ""}`}
              placeholder="+998 90 123 45 67"
            />
            <p className={`mt-1 text-sm ${phoneInvalid ? "text-red-600" : "text-gray-500"}`}>
              {phoneInvalid ? t("register.phone_error") : t("register.phone_hint")}
            </p>

            <label className="block mb-1 mt-4">{t("register.email")}</label>
            <input
              name="email"
              type="email"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.social")}</label>
            <input
              name="social"
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.password")}</label>
            <input
              name="password"
              type="password"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 font-bold border-2 border-orange-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`mt-6 w-full text-white py-3 rounded font-bold transition ${
            submitting ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700"
          }`}
        >
          {submitting ? t("register.loading") || "Отправка…" : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
