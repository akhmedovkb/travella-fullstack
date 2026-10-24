// frontend/src/pages/Login.jsx

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";

const Login = () => {
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [showTelegramLogin, setShowTelegramLogin] = useState(false);

  const navigate = useNavigate();

  const providerBotUsername = useMemo(() => {
    return String(import.meta.env.VITE_TELEGRAM_PROVIDER_BOT_USERNAME || "")
      .replace(/^@/, "")
      .trim();
  }, []);

  useEffect(() => {
    window.onTelegramProviderLogin = async (user) => {
      try {
        setError("");

        const response = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/telegram-login`,
          user
        );

        if (response.data?.token) {
          localStorage.setItem("token", response.data.token);
          navigate("/dashboard");
          return;
        }

        setError(
          t("telegram_provider_auth.error", {
            defaultValue: "Telegram authorization failed",
          })
        );
      } catch (err) {
        console.error("[provider telegram login] error:", err);
        setError(
          err?.response?.data?.message ||
            t("telegram_provider_auth.error", {
              defaultValue: "Telegram authorization failed",
            })
        );
      }
    };

    return () => {
      delete window.onTelegramProviderLogin;
    };
  }, [navigate, t]);

  useEffect(() => {
    if (!showTelegramLogin) return;
  
    const container = document.getElementById("telegram-login-container");
    if (!container) return;
  
    container.innerHTML = "";
  
    if (!providerBotUsername) {
      container.innerHTML = `<div style="font-size:13px;color:#dc2626;text-align:center;">${t(
        "telegram_provider_auth.bot_not_configured",
        { defaultValue: "Provider Telegram bot is not configured" }
      )}</div>`;
      return;
    }
  
    const existing = document.getElementById("telegram-provider-login");
    if (existing) existing.remove();
  
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.id = "telegram-provider-login";
    script.setAttribute("data-telegram-login", providerBotUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramProviderLogin(user)");
    script.setAttribute("data-request-access", "write");
  
    container.appendChild(script);
}, [showTelegramLogin, providerBotUsername, t]);

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      setError("");

      const payload = {
        email: String(email).trim().toLowerCase(),
        password,
      };

      const response = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/login`,
        payload
      );

      localStorage.setItem("token", response.data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(t("login.error"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <div className="grid overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="order-2 bg-slate-950 p-7 text-white md:p-10 lg:order-1">
          <Link to="/" className="text-sm font-bold text-orange-400 hover:text-orange-300">{t("provider_auth.back_marketplace")}</Link>
          <h2 className="mt-8 text-2xl font-black leading-tight md:text-3xl">{t("provider_auth.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{t("provider_auth.subtitle")}</p>
          <ul className="mt-8 space-y-5">
            {["sales", "calendar", "tools"].map((benefit) => (
              <li key={benefit} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-black" aria-hidden="true">✓</span>
                <div>
                  <div className="text-sm font-bold">{t(`provider_auth.benefit_${benefit}`)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{t(`provider_auth.benefit_${benefit}_hint`)}</div>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="order-1 p-6 md:p-10 lg:order-2">
          <div className="border-b border-slate-200 pb-6">
            <p className="text-xs font-black uppercase text-orange-600">{t("provider_auth.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{t("login.title")}</h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("provider_auth.login_subtitle")}</p>
          </div>

          {error && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

          <form onSubmit={handleLogin} className="mt-6 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">{t("login.email")}</span>
              <input type="email" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder={t("provider_auth.email_placeholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">{t("login.password")}</span>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} className="h-12 w-full rounded-lg border border-slate-300 px-4 pr-14 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-slate-500 hover:text-slate-950" aria-label={t(showPassword ? "login.hide_password" : "login.show_password")} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
                </button>
              </div>
            </label>

            <button type="submit" className="h-12 w-full rounded-lg bg-orange-600 text-sm font-black text-white transition hover:bg-orange-700">{t("login.button")}</button>
          </form>

          <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs font-bold uppercase text-slate-400">{t("common.or", { defaultValue: "OR" })}</span><div className="h-px flex-1 bg-slate-200" /></div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-bold text-slate-800">{t("telegram_provider_auth.login", { defaultValue: "Login via Telegram" })}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("provider_auth.telegram_hint")}</p>
            {!showTelegramLogin ? (
              <button type="button" onClick={() => setShowTelegramLogin(true)} className="mt-3 h-11 w-full rounded-lg bg-sky-500 px-4 text-sm font-bold text-white transition hover:bg-sky-600">{t("telegram_provider_auth.login", { defaultValue: "Войти через Telegram" })}</button>
            ) : (
              <div id="telegram-login-container" className="mt-3 flex justify-center" />
            )}
          </div>

          <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
            {t("login.no_account")}{" "}<Link to="/register" className="font-bold text-orange-600 hover:underline">{t("register.button")}</Link>
          </p>
        </section>
      </div>
    </div>
  );
};

export default Login;
