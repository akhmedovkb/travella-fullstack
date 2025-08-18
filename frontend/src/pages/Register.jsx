// frontend/src/pages/Register.jsx
import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
import { toast } from "../ui/toast";

/* ---------- helpers ---------- */

// простая E.164 (начинается с "+", только цифры, длина 10..15)
const E164 = /^\+\d{10,15}$/;
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizePhone(raw) {
  if (!raw) return "";
  const only = String(raw).replace(/[^\d+]/g, "");
  // если без + и длина подходит — добавим + (частый ввод 99890...)
  if (!only.startsWith("+") && /^\d{10,15}$/.test(only)) return `+${only}`;
  return only;
}

/** Парсим любые ответы сервера в дружелюбное сообщение */
function parseApiError(err, t) {
  // Axios error?
  const data = err?.response?.data;

  // Частые форматы:
  if (typeof data === "string" && data.trim()) return data;
  if (typeof data?.error === "string" && data.error.trim()) return data.error;
  if (typeof data?.message === "string" && data.message.trim()) {
    // мапинг типичных сообщений в переводные ключи
    const m = data.message.toLowerCase();
    if (m.includes("email") && m.includes("exist"))
      return t("register.errors.email_taken");
    if (m.includes("phone") && (m.includes("invalid") || m.includes("format")))
      return t("register.errors.phone_invalid");
    if (m.includes("password") && m.includes("weak"))
      return t("register.errors.password_weak");
    return data.message; // уже человеко-читаемое
  }

  // Array ошибок (например, express-validator)
  if (Array.isArray(data?.errors) && data.errors.length) {
    const first = data.errors[0];
    const msg = first?.msg || first?.message || first;
    if (typeof msg === "string" && msg.trim()) return msg;
  }

  // error.code/constraint для уникальности
  const code = (data?.code || err?.code || "").toString().toLowerCase();
  const constraint = (data?.constraint || "").toLowerCase();
  if (code.includes("unique") || constraint.includes("unique")) {
    if (constraint.includes("email")) return t("register.errors.email_taken");
    if (constraint.includes("phone")) return t("register.errors.phone_taken");
    return t("register.errors.duplicate");
  }

  // fallback на локаль
  return t("register.errors.generic");
}

/* ---------- компонент ---------- */

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
  const [touched, setTouched] = useState({});

  const debounceRef = useRef(null);
  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  const fetchCities = async (query) => {
    const q = (query || "").trim();
    if (!q || q.length < 2) return setLocationSuggestions([]);
    try {
      const res = await axios.get("https://wft-geo-db.p.rapidapi.com/v1/geo/cities", {
        params: { namePrefix: q, limit: 5, sort: "-population", countryIds: "UZ" },
        headers: {
          "X-RapidAPI-Key": import.meta.env.VITE_GEODB_API_KEY,
          "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
        },
      });
      setLocationSuggestions((res.data?.data || []).map((c) => c.city));
    } catch {
      setLocationSuggestions([]); // не шумим при 429
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((p) => ({ ...p, location: city }));
    setLocationSuggestions([]);
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    setTouched((p) => ({ ...p, [name]: true }));

    if (name === "photo" && files && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData((p) => ({ ...p, photo: String(reader.result || "") }));
      reader.readAsDataURL(files[0]);
      return;
    }

    if (name === "location") {
      setFormData((p) => ({ ...p, location: value }));
      debounceRef.current && clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchCities(value), 400);
      return;
    }

    setFormData((p) => ({ ...p, [name]: value }));
  };

  // валидация на клиенте
  function validate() {
    const errs = [];

    if (!formData.name.trim()) errs.push(t("register.errors.required_name"));
    if (!formData.location.trim()) errs.push(t("register.errors.required_location"));

    const phone = normalizePhone(formData.phone);
    if (!phone) errs.push(t("register.errors.required_phone"));
    else if (!E164.test(phone)) errs.push(t("register.errors.phone_invalid"));

    if (!formData.email.trim()) errs.push(t("register.errors.required_email"));
    else if (!emailRx.test(formData.email.trim())) errs.push(t("register.errors.email_invalid"));

    if (!formData.password) errs.push(t("register.errors.required_password"));
    else if (formData.password.length < 6) errs.push(t("register.errors.password_weak"));

    return { ok: errs.length === 0, errors: errs, phoneNormalized: phone };
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    // клиентская валидация
    setTouched({
      name: true,
      type: true,
      location: true,
      phone: true,
      email: true,
      password: true,
    });

    const { ok, errors, phoneNormalized } = validate();
    if (!ok) {
      toast.error(errors[0]); // показываем первую проблему
      return;
    }

    const payload = {
      ...formData,
      phone: phoneNormalized,
      location: [formData.location], // бэк ожидает массив
    };

    try {
      setSubmitting(true);
      await toast.promise(
        axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/register`, payload, {
          headers: { "Content-Type": "application/json" },
        }),
        {
          loading: t("register.loading"),
          success: t("register.success"),
          error: (err) => parseApiError(err, t),
        }
      );
      navigate("/login");
    } finally {
      setSubmitting(false);
    }
  };

  const phoneNormalized = normalizePhone(formData.phone);
  const phoneInvalid = touched.phone && phoneNormalized && !E164.test(phoneNormalized);

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form onSubmit={handleSubmit} className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-orange-600">{t("register.title")}</h2>
          <LanguageSelector />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* left */}
          <div>
            <label className="block mb-1">{t("register.name")}</label>
            <input
              name="name"
              value={formData.name}
              onChange={handleChange}
              lang={i18n.language}
              className="w-full border p-2 mb-4"
              required
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
              onChange={handleChange}
              placeholder={t("register.location_placeholder")}
              lang={i18n.language}
              className="w-full border p-2 mb-1"
              required
            />
            {locationSuggestions.length > 0 && (
              <ul className="bg-white border mt-0 -mt-0.5 max-h-40 overflow-y-auto z-10 relative">
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
                  <input type="file" name="photo" accept="image/*" onChange={handleChange} className="hidden" />
                </label>
                <span className="text-sm text-gray-600">
                  {formData.photo ? t("register.file_chosen") : t("register.no_file")}
                </span>
              </div>
            </div>
          </div>

          {/* right */}
          <div>
            <label className="block mb-1">{t("register.phone")}</label>
            <input
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              lang={i18n.language}
              className={`w-full border p-2 ${phoneInvalid ? "border-red-500" : "mb-1"}`}
              required
              placeholder="+998 90 123 45 67"
              onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
            />
            <p className={`text-xs ${phoneInvalid ? "text-red-600" : "text-gray-500"}`}>
              {phoneInvalid ? t("register.errors.phone_invalid") : t("register.phone_hint")}
            </p>

            <label className="block mt-4 mb-1">{t("register.email")}</label>
            <input
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              lang={i18n.language}
              className="w-full border p-2 mb-4"
              required
            />

            <label className="block mb-1">{t("register.social")}</label>
            <input name="social" value={formData.social} onChange={handleChange} className="w-full border p-2 mb-4" />

            <label className="block mb-1">{t("register.password")}</label>
            <input
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              lang={i18n.language}
              className="w-full border p-2 font-bold border-2 border-orange-500"
              required
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
          {submitting ? t("register.loading") : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
