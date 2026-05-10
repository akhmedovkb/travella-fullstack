// frontend/src/pages/Login.jsx

import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector";

const Login = () => {
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
  }, [providerBotUsername, t]);

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
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <div className="flex justify-end mb-4">
          <LanguageSelector />
        </div>

        <h2 className="text-3xl font-black text-center mb-6 text-orange-500">
          {t("login.title")}
        </h2>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-gray-700 mb-1">
              {t("login.email")}
            </label>

            <input
              type="email"
              className="w-full border border-gray-300 px-4 py-3 rounded-xl focus:outline-none focus:ring-4 focus:ring-orange-100 focus:border-orange-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 mb-1">
              {t("login.password")}
            </label>

            <input
              type="password"
              className="w-full border border-gray-300 px-4 py-3 rounded-xl focus:outline-none focus:ring-4 focus:ring-orange-100 focus:border-orange-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

          <button
            type="submit"
            className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition"
          >
            {t("login.button")}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-sm text-gray-400">
            {t("common.or", { defaultValue: "OR" })}
          </span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <div className="mb-4">
          <div className="text-center text-sm font-semibold text-gray-600 mb-3">
            {t("telegram_provider_auth.login", {
              defaultValue: "Login via Telegram",
            })}
          </div>

          <div id="telegram-login-container" className="flex justify-center" />

          <div className="mt-3 text-center text-xs text-gray-400">
            {t("telegram_provider_auth.domain_hint", {
              defaultValue:
                "If the button does not load, check BotFather domain and provider bot env.",
            })}
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-red-600">
          {t("login.no_account")}{" "}
          <Link to="/register" className="underline">
            {t("register.button")}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
