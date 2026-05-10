//frontend/src/pages/Login.jsx

import React, { useState, useEffect } from "react";
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

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      try {
        const response = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/telegram-login`,
          user
        );

        if (response.data?.token) {
          localStorage.setItem("token", response.data.token);
          navigate("/dashboard");
        }
      } catch (err) {
        console.error(err);
        setError(
          t("telegram_provider_auth.error", {
            defaultValue: "Telegram login failed",
          })
        );
      }
    };

    return () => {
      delete window.onTelegramAuth;
    };
  }, [navigate, t]);

  useEffect(() => {
    const existing = document.getElementById("telegram-provider-login");

    if (existing) existing.remove();

    const script = document.createElement("script");

    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.id = "telegram-provider-login";

    script.setAttribute(
      "data-telegram-login",
      import.meta.env.VITE_TELEGRAM_BOT_USERNAME
    );

    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    const container = document.getElementById("telegram-login-container");

    if (container) {
      container.innerHTML = "";
      container.appendChild(script);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
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
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm mb-3">
              {error}
            </p>
          )}

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

          <div
            id="telegram-login-container"
            className="flex justify-center"
          />
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
