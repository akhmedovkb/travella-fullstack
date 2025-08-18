// frontend/src/pages/Register.jsx
// frontend/src/pages/Register.jsx
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
import { toast } from "../ui/toast"; // наша обёртка над react-hot-toast

const isValidE164 = (phone) => /^\+\d{7,15}$/.test((phone || "").trim());

const normalizePhone = (raw) => {
  if (!raw) return "";
  // приводим к +цифры
  const s = String(raw).replace(/[^\d+]/g, "");
  // если начинаются просто с цифр и похоже на UZ, подставим +998
  if (/^\d{9,12}$/.test(s) && !s.startsWith("+")) {
    if (s.length === 9) return `+998${s}`;
    if (s.length === 12 && s.startsWith("998")) return `+${s}`;
  }
  return s.startsWith("+") ? s : `+${s}`;
};

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

  // стабильный дебаунс
  const debounceRef = useRef(null);
  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  /** ====== локализация нативных подсказок браузера ====== */
  const handleInvalid = (e) => {
    const el = e.target;
    const v = el.validity;
    let msg = "";

    if (v.valueMissing) msg = t("form.required");
    else if (el.name === "email" && v.typeMismatch) msg = t("form.email_invalid");
    else if (el.name === "password" && v.tooShort) msg = t("form.password_short");

    // показать локализованный текст
    el.setCustomValidity(msg || "");
  };

  const clearValidity = (e) => e.target.setCustomValidity("");

  /** ====== автоподсказки городов через GeoDB ====== */
  const fetchCities = async (query) => {
    const q = (query || "").trim();
    if (!q || q.length < 2) return setLocationSuggestions([]);

    try {
      const resp = await axios.get("https://wft-geo-db.p.rapidapi.com/v1/geo/cities", {
        params: { namePrefix: q, limit: 5, sort: "-population", countryIds: "UZ" },
        headers: {
          "X-RapidAPI-Key": import.meta.env.VITE_GEODB_API_KEY,
          "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
        },
      });
      setLocationSuggestions((resp.data?.data || []).map((c) => c.city));
    } catch {
      // 429 и прочее — молча
      setLocationSuggestions([]);
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((p) => ({ ...p, location: city }));
    setLocationSuggestions([]);
  };

  /** ====== change handlers ====== */
  const handleChange = (e) => {
    const { name, value, files } = e.target;

    if (name === "photo" && files?.length) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData((p) => ({ ...p, photo: String(reader.result || "") }));
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
      setPhoneTouched(true);
      setFormData((p) => ({ ...p, phone: value }));
      return;
    }

    setFormData((p) => ({ ...p, [name]: value }));
  };

  /** ====== submit ====== */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const normalized = normalizePhone(formData.phone);
    if (!isValidE164(normalized)) {
      toast.error(t("register.phone_invalid"));
      setPhoneTouched(true);
      return;
    }

    const payload = {
      ...formData,
      phone: normalized,
      location: [formData.location], // бэк ждёт массив
    };

    try {
      setSubmitting(true);
      await toast.promise(
        axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/register`, payload, {
          headers: { "Content-Type": "application/json" },
        }),
        {
          loading: t("register.loading") || "Sending…",
          success: t("register.success"),
          error: (err) =>
            err?.response?.data?.error ||
            err?.message ||
            t("register.error"),
        }
      );
      navigate("/login");
    } finally {
      setSubmitting(false);
    }
  };

  const phoneNormalized = normalizePhone(formData.phone);
  const phoneInvalid = phoneTouched && !isValidE164(phoneNormalized);

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl"
      >
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
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={clearValidity}
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
              onInvalid={handleInvalid}
              onInput={clearValidity}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-1"
            />
            {locationSuggestions.length > 0 && (
              <ul className="bg-white border -mt-0.5 max-h-40 overflow-y-auto z-10 relative">
                {locationSuggestions.map((city, i) => (
                  <li
                    key={`${city}-${i}`}
                    className="p-2 border-b cursor-pointer hover:bg-gray-100"
                    onClick={() => handleLocationSelect(city)}
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

          {/* right */}
          <div>
            <label className="block mb-1">{t("register.phone")}</label>
            <input
              name="phone"
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={clearValidity}
              className={`w-full border p-2 mb-1 ${
                phoneInvalid ? "border-red-500 ring-1 ring-red-300" : ""
              }`}
            />
            <p
              className={`text-xs mt-1 ${
                phoneInvalid ? "text-red-600" : "text-gray-500"
              }`}
            >
              {t("register.phone_hint")}
            </p>

            <label className="block mb-1 mt-4">{t("register.email")}</label>
            <input
              name="email"
              type="email"
              required
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={clearValidity}
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
              minLength={6}
              lang={i18n.language}
              onChange={handleChange}
              onInvalid={handleInvalid}
              onInput={clearValidity}
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
          {submitting ? t("register.loading") || "Sending…" : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
