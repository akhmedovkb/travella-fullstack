// frontend/src/pages/Register.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { toast } from "../ui/toast";

// --- утилиты ---------------------------------------------------------
const normalizePhone = (raw = "") =>
  raw.toString().replace(/[^\d+]/g, "").replace(/^\+?/, "+");

const isValidE164 = (p) => /^\+\d{7,15}$/.test(p);

const parseErrorMessage = (err, t) => {
  const raw =
    err?.response?.data?.error ??
    err?.response?.data?.message ??
    err?.message ??
    "";

  if (typeof raw === "string" && raw.startsWith("register.")) {
    return t(raw);
  }

  const s = String(raw).toLowerCase();

  if (/email/.test(s) && /(exist|used|taken|занят|использ|mavjud|ishlatilgan)/.test(s)) {
    return t("register.errors.email_taken");
  }

  if (/(phone|телефон|raqam)/.test(s) && /(invalid|format|неверн|noto‘g‘ri|noto'g'ri)/.test(s)) {
    return t("register.errors.phone_invalid");
  }

  if (/(required|must|обязат|требует|пуст|kerak|bo‘sh|bo'sh|empty)/.test(s)) {
    return t("register.errors.required");
  }

  return t("register.error");
};

// ---------------------------------------------------------------------

const Register = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const providerBotUsername = useMemo(() => {
    return String(import.meta.env.VITE_TELEGRAM_PROVIDER_BOT_USERNAME || "")
      .replace(/^@/, "")
      .trim();
  }, []);

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
  const [telegramError, setTelegramError] = useState("");

  useEffect(() => {
    window.onTelegramProviderRegister = async (user) => {
      try {
        setTelegramError("");

        const response = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/telegram-login`,
          user
        );

        if (response.data?.token) {
          localStorage.setItem("token", response.data.token);
          navigate("/dashboard");
          return;
        }

        setTelegramError(
          t("telegram_provider_auth.error", {
            defaultValue: "Telegram authorization failed",
          })
        );
      } catch (err) {
        console.error("[provider telegram register/login] error:", err);
        setTelegramError(
          err?.response?.data?.message ||
            t("telegram_provider_auth.error", {
              defaultValue: "Telegram authorization failed",
            })
        );
      }
    };

    return () => {
      delete window.onTelegramProviderRegister;
    };
  }, [navigate, t]);

  useEffect(() => {
    const container = document.getElementById("telegram-register-container");
    if (!container) return;

    container.innerHTML = "";

    if (!providerBotUsername) {
      container.innerHTML = `<div style="font-size:13px;color:#dc2626;">${t(
        "telegram_provider_auth.bot_not_configured",
        { defaultValue: "Provider Telegram bot is not configured" }
      )}</div>`;
      return;
    }

    const existing = document.getElementById("telegram-provider-register");
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.id = "telegram-provider-register";
    script.setAttribute("data-telegram-login", providerBotUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramProviderRegister(user)");
    script.setAttribute("data-request-access", "write");

    container.appendChild(script);
  }, [providerBotUsername, t]);

  // debounce для автоподсказки городов
  const debounceRef = useRef(null);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

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
    } catch {
      setLocationSuggestions([]);
    }
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;

    if (name === "photo" && files && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setFormData((p) => ({ ...p, photo: String(reader.result || "") }));
      reader.readAsDataURL(files[0]);
      return;
    }

    if (name === "location") {
      setFormData((p) => ({ ...p, location: value }));
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchCities(value), 500);
      return;
    }

    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleLocationSelect = (city) => {
    setFormData((p) => ({ ...p, location: city }));
    setLocationSuggestions([]);
  };

  const requiredTitle = t("register.errors.required");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    if (!formData.name || !formData.location || !formData.social) {
      toast.error(t("register.errors.required"));
      return;
    }

    const phoneNormalized = normalizePhone(formData.phone);
    if (!isValidE164(phoneNormalized)) {
      toast.error(t("register.errors.phone_invalid"));
      return;
    }

    const payload = {
      ...formData,
      phone: phoneNormalized,
      location: [formData.location],
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
          error: (err) => parseErrorMessage(err, t),
        }
      );

      navigate("/login");
    } catch {
      // текст уже показан через toast.promise
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
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-orange-600">
            {t("register.title")}
          </h2>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-600 mb-3">
              {t("telegram_provider_auth.register", {
                defaultValue: "Register / login via Telegram",
              })}
            </div>

            <div id="telegram-register-container" />

            {telegramError && (
              <div className="mt-2 text-sm text-red-600">
                {telegramError}
              </div>
            )}

            <div className="mt-2 text-xs text-gray-500">
              {t("telegram_provider_auth.register_hint", {
                defaultValue:
                  "If you are already approved as a provider in the bot, Telegram login will open the same dashboard.",
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Левая колонка */}
          <div>
            <label className="block mb-1">{t("register.name")}</label>
            <input
              name="name"
              required
              title={requiredTitle}
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
              title={requiredTitle}
              lang={i18n.language}
              onChange={handleChange}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-1"
            />

            {locationSuggestions.length > 0 && (
              <ul className="bg-white border -mt-0.5 max-h-40 overflow-y-auto z-10 relative">
                {locationSuggestions.map((city, i) => (
                  <li
                    key={`${city}-${i}`}
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
              required
              title={t("register.phone_hint")}
              lang={i18n.language}
              onChange={handleChange}
              placeholder="+998 90 123 45 67"
              className="w-full border p-2 mb-1"
            />

            <label className="block mb-1">{t("register.email")}</label>
            <input
              name="email"
              type="email"
              required
              title={requiredTitle}
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.social")}</label>
            <input
              name="social"
              required
              title={requiredTitle}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label className="block mb-1">{t("register.password")}</label>
            <input
              name="password"
              type="password"
              required
              title={requiredTitle}
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
          {submitting ? t("register.loading") : t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
