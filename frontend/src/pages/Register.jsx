// frontend/src/pages/Register.jsx
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
import { toast } from "../ui/toast"; // наша единая обёртка над react-hot-toast

// ===== Помощники для телефона (E.164) =====
const normalizePhone = (raw) => {
  if (!raw) return "";
  let v = String(raw).trim();
  // заменить в начале 00... на +
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  // убрать всё, кроме цифр и +
  v = v.replace(/(?!^\+)[^\d]/g, "");
  // добавить +, если его нет, но цифры есть
  if (!v.startsWith("+") && /\d/.test(v)) v = `+${v.replace(/[^\d]/g, "")}`;
  return v;
};
const isValidE164 = (v) => /^\+[1-9]\d{7,14}$/.test(v || "");

const Register = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    type: "guide", // можно оставить дефолт, чтобы не заставлять выбирать
    location: "",
    photo: "",
    phone: "",
    email: "",
    social: "",
    password: "",
  });

  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // стабильный дебаунс между рендерами
  const debounceRef = useRef(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ===== Автоподсказки городов =====
  const fetchCities = async (query) => {
    const q = (query || "").trim();
    if (!q || q.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    try {
      const res = await axios.get(
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
      const cities = (res.data?.data || []).map((c) => c.city);
      setLocationSuggestions(cities);
    } catch (err) {
      // лимиты / сеть — молчим для UX, логируем
      console.warn("GeoDB autocomplete error:", err?.response?.status || err?.message);
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
      debounceRef.current = setTimeout(() => fetchCities(value), 500);
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // ===== Нативные подсказки (кастомные тексты) =====
  const getRequiredMessage = (name) => {
    // единый текст для name / location / social
    if (name === "name" || name === "location" || name === "social") {
      return t("register.errors.required_generic");
    }
    if (name === "type") return t("register.errors.required_type");
    return t("register.errors.required_generic");
  };

  const handleInvalid = (e) => {
    const el = e.target;

    // Если пусто — показываем единый/специальный текст
    if (el.validity.valueMissing) {
      el.setCustomValidity(getRequiredMessage(el.name));
      return;
    }

    if (el.name === "email" && el.validity.typeMismatch) {
      el.setCustomValidity(t("register.errors.email_invalid"));
      return;
    }

    if (el.name === "phone") {
      const normalized = normalizePhone(el.value);
      if (!isValidE164(normalized)) {
        el.setCustomValidity(t("register.errors.phone_invalid"));
        return;
      }
    }

    if (el.name === "password" && el.value && el.value.length < 6) {
      el.setCustomValidity(t("register.errors.password_short"));
      return;
    }

    el.setCustomValidity("");
  };

  const handleInputValidityClear = (e) => {
    e.target.setCustomValidity("");
  };

  // ===== submit =====
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // Нормализуем телефон сразу
    const normalizedPhone = normalizePhone(formData.phone);

    const payload = {
      ...formData,
      phone: normalizedPhone,
      location: [formData.location], // бэку нужен массив
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
            t("register.errors.generic"),
        }
      );
      navigate("/login");
    } catch (err) {
      // сообщение уже показано в toast.promise
      console.error("Register error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl"
        noValidate
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-orange-600">
            {t("register.title")}
          </h2>
          <LanguageSelector />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT */}
          <div>
            <label className="block mb-1">{t("register.name")}</label>
            <input
              name="name"
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.type")}</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              required
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              className="w-full border p-2 mb-4"
            >
              {/* Если хотите заставлять выбирать: установите value="" и оставьте placeholder */}
              {/* <option value="" disabled hidden>{t("register.type_placeholder")}</option> */}
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
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-1"
            />
            {locationSuggestions.length > 0 && (
              <ul className="bg-white border -mt-0.5 max-h-40 overflow-y-auto z-10 relative">
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
                  {formData.photo ? t("register.file_chosen") : t("register.no_file")}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div>
            <label className="block mb-1">{t("register.phone")}</label>
            <input
              name="phone"
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              className="w-full border p-2 mb-4"
            />
            <p className="text-xs text-gray-500 -mt-3 mb-3">
              {t("register.phone_hint")}
            </p>

            <label className="block mb-1">{t("register.email")}</label>
            <input
              name="email"
              type="email"
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.social")}</label>
            <input
              name="social"
              required
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.password")}</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={handleInputValidityClear}
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
          {submitting ? (t("register.loading") || "Отправка…") : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
