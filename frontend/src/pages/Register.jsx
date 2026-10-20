// frontend/src/pages/Register.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { toast } from "../ui/toast";
import { Eye, EyeOff } from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);

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
    if (formData.password.length < 8) {
      toast.error(t("register.errors.password_length"));
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
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="grid overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="order-2 bg-slate-950 p-7 text-white md:p-10 lg:order-1">
          <Link to="/" className="text-sm font-bold text-orange-400 hover:text-orange-300">{t("provider_auth.back_marketplace")}</Link>
          <h2 className="mt-8 text-2xl font-black leading-tight md:text-3xl">{t("provider_auth.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{t("provider_auth.subtitle")}</p>
          <ul className="mt-8 space-y-5">
            {["sales", "calendar", "tools"].map((benefit) => (
              <li key={benefit} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-black" aria-hidden="true">✓</span>
                <div><div className="text-sm font-bold">{t(`provider_auth.benefit_${benefit}`)}</div><div className="mt-1 text-xs leading-5 text-slate-400">{t(`provider_auth.benefit_${benefit}_hint`)}</div></div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="order-1 p-6 md:p-10 lg:order-2">
          <div className="border-b border-slate-200 pb-6">
            <p className="text-xs font-black uppercase text-orange-600">{t("provider_auth.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{t("register.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t("provider_auth.register_subtitle")}</p>
          </div>

          <div className="mt-6 rounded-lg border border-sky-200 bg-sky-50 p-4">
            <div className="text-sm font-bold text-slate-800">{t("telegram_provider_auth.register", { defaultValue: "Register / login via Telegram" })}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("telegram_provider_auth.register_hint")}</p>
            <div id="telegram-register-container" className="mt-3" />
            {telegramError && <div className="mt-2 text-sm font-semibold text-red-600">{telegramError}</div>}
          </div>

          <form onSubmit={handleSubmit} className="mt-6">
            <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
              <Field label={t("register.name")}><input name="name" required title={requiredTitle} lang={i18n.language} onChange={handleChange} placeholder={t("provider_auth.name_placeholder")} className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></Field>
              <Field label={t("register.type")}><select name="type" value={formData.type} onChange={handleChange} className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"><option value="guide">{t("guide")}</option><option value="transport">{t("transport")}</option><option value="agent">{t("agent")}</option><option value="hotel">{t("hotel")}</option></select></Field>

              <div className="relative">
                <Field label={t("location")} hint={t("provider_auth.location_hint")}><input name="location" value={formData.location} required title={requiredTitle} lang={i18n.language} onChange={handleChange} placeholder={t("register.location_placeholder")} className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></Field>
                {locationSuggestions.length > 0 && <ul className="absolute left-0 right-0 top-[78px] z-20 max-h-40 overflow-y-auto rounded-lg border bg-white shadow-lg">{locationSuggestions.map((city, i) => <li key={`${city}-${i}`} onClick={() => handleLocationSelect(city)} className="cursor-pointer border-b px-3 py-2 text-sm hover:bg-slate-50">{city}</li>)}</ul>}
              </div>
              <Field label={t("register.phone")} hint={t("register.phone_hint")}><input name="phone" type="tel" required title={t("register.phone_hint")} lang={i18n.language} onChange={handleChange} placeholder="+998 90 123 45 67" autoComplete="tel" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></Field>

              <Field label={t("register.email")}><input name="email" type="email" required title={requiredTitle} lang={i18n.language} onChange={handleChange} placeholder="name@example.com" autoComplete="email" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></Field>
              <Field label={t("register.social")} hint={t("provider_auth.telegram_username_hint")}><input name="social" required title={requiredTitle} onChange={handleChange} placeholder="@username" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></Field>

              <Field label={t("register.password")} hint={t("provider_auth.password_hint")}>
                <div className="relative"><input name="password" type={showPassword ? "text" : "password"} minLength={8} required title={requiredTitle} lang={i18n.language} onChange={handleChange} autoComplete="new-password" className="h-12 w-full rounded-lg border border-slate-300 px-4 pr-14 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-slate-500 hover:text-slate-950" aria-label={t(showPassword ? "login.hide_password" : "login.show_password")}>{showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}</button></div>
              </Field>
              <Field label={t("register.photo")} hint={t("provider_auth.photo_hint")}>
                <label className="flex h-12 cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 px-4 text-sm transition hover:border-orange-400 hover:bg-orange-50"><span className="font-bold text-slate-700">{t("register.select_file")}</span><span className="truncate pl-3 text-xs text-slate-500">{formData.photo ? t("register.file_chosen") : t("register.no_file")}</span><input type="file" name="photo" accept="image/*" onChange={handleChange} className="hidden" /></label>
              </Field>
            </div>

            <button type="submit" disabled={submitting} className={`mt-6 h-12 w-full rounded-lg text-sm font-black text-white transition ${submitting ? "cursor-not-allowed bg-orange-300" : "bg-orange-600 hover:bg-orange-700"}`}>{submitting ? t("register.loading") : t("register.button")}</button>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t("provider_auth.terms")}</p>
          </form>

          <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">{t("provider_auth.have_account")}{" "}<Link to="/login" className="font-bold text-orange-600 hover:underline">{t("login.button")}</Link></p>
        </section>
      </div>
    </div>
  );
};

function Field({ label, hint, children }) {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-slate-800">{label}</span>{children}{hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}</label>;
}

export default Register;
