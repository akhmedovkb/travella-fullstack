// frontend/src/pages/Register.jsx
import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
import toast from "../ui/toast"; // дефолтный экспорт-объект: { success, error, promise, ... }

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

  // стабильный дебаунс для автоподсказок
  const debounceRef = useRef(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ---------- helpers ----------
  const getErrorMessage = (err) => {
    const d = err?.response?.data;
    if (!d) return err?.message || "Ошибка";
    if (typeof d === "string") return d;
    if (Array.isArray(d?.errors)) {
      // например, express-validator
      return d.errors.map((e) => e.msg || e.message).join("\n");
    }
    return d.error || d.message || JSON.stringify(d);
  };

  const normalizePhone = (raw) => {
    const digits = String(raw || "").replace(/\D/g, "");
    // 9 цифр — локальный формат (например, 901234567) → +998901234567
    if (/^\d{9}$/.test(digits)) return `+998${digits}`;
    // 998XXXXXXXXX (12 цифр) → +998XXXXXXXXX
    if (/^998\d{9}$/.test(digits)) return `+${digits}`;
    // уже корректный формат, начинающийся с +
    if (/^\+\d{9,15}$/.test(raw)) return raw;
    // просто цифры 9–15 → добавим +
    if (/^\d{9,15}$/.test(raw)) return `+${raw}`;
    return null; // невалидный
  };

  const fetchCities = async (query) => {
    const q = (query || "").trim();
    if (!q || q.length < 2) {
      setLocationSuggestions([]);
      return;
    }

    try {
      const response = await axios.get(
        "https://wft-geo-db.p.rapidapi.com/v1/geo/cities",
        {
          params: {
            namePrefix: q,
            limit: 5,
            sort: "-population",
            countryIds: "UZ",
          },
          headers: {
            "X-RapidAPI-Key": import.meta.env.VITE_GEODB_API_KEY,
            "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
          },
        }
      );
      const cities = (response.data?.data || []).map((city) => city.city);
      setLocationSuggestions(cities);
    } catch (err) {
      // Лимиты RapidAPI (429) или сеть — не шумим тостами
      console.warn(
        "GeoDB autocomplete error:",
        err?.response?.status || err?.message
      );
      setLocationSuggestions([]);
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((prev) => ({ ...prev, location: city }));
    setLocationSuggestions([]);
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;

    if (name === "photo" && files && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, photo: String(reader.result || "") }));
      };
      reader.readAsDataURL(files[0]);
      return;
    }

    if (name === "location") {
      setFormData((prev) => ({ ...prev, location: value }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchCities(value), 500); // мягче, чтобы не ловить 429
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // Мягкая клиентская валидация
    const phoneNorm = normalizePhone(formData.phone);
    if (!phoneNorm) {
      toast.error(
        t("register.phone_invalid") ||
          "Неверный телефон. Укажите, например: +998901234567"
      );
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      toast.error(t("register.email_invalid") || "Неверный email.");
      return;
    }

    if ((formData.password || "").length < 6) {
      toast.error(
        t("register.password_short") || "Пароль должен быть не менее 6 символов."
      );
      return;
    }

    const payload = {
      ...formData,
      phone: phoneNorm,
      location: [formData.location], // бэк ждёт массив
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
          error: (err) => getErrorMessage(err) || t("register.error"),
        }
      );
      navigate("/login");
    } catch (error) {
      console.error("Ошибка регистрации:", error);
      // Сообщение уже показано в toast.promise
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-orange-600">
            {t("register.title")}
          </h2>
          <LanguageSelector />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
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
              <ul className="bg-white border mt-0 -mt-0.5 max-h-40 overflow-y-auto z-10 relative">
                {locationSuggestions.map((city, index) => (
                  <li
                    key={`${city}-${index}`}
                    onClick={() => handleLocationSelect(city)}
                    className="p-2 border-b cursor-pointer hover:bg-gray-100"
                  >
                    {city}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <label className="block font-medium mb-1">
                {t("register.photo")}
              </label>
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
                  {formData.photo
                    ? t("register.file_chosen")
                    : t("register.no_file")}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block mb-1">{t("register.phone")}</label>
            <input
              name="phone"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.email")}</label>
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
            submitting
              ? "bg-orange-400 cursor-not-allowed"
              : "bg-orange-600 hover:bg-orange-700"
          }`}
        >
          {submitting
            ? t("register.loading") || "Отправка…"
            : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
