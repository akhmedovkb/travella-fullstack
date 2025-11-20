// frontend/src/pages/landing/IndiaLayout.jsx
import React from "react";
import { Outlet, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import IndiaNav from "../../components/IndiaNav";

export default function IndiaLayout() {
  const { t } = useTranslation();

  return (
    <div className="bg-gray-50">
      {/* Верхняя плашка India-навигации + кнопки входа */}
      <div className="border-b border-orange-100/70 bg-orange-50/40">
        <div className="mx-auto max-w-7xl px-4 pt-6 pb-4">
          {/* 1-я строка: кнопки входа справа */}
          <div className="mb-4 flex justify-end gap-3">
            <Link
              to="/client/login"
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
            >
              {t("landing.india.login_client", "Войти как клиент")}
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
            >
              {t("landing.india.login_provider", "Войти как поставщик")}
            </Link>
          </div>

          {/* 2-я строка: India-табы по центру */}
          <IndiaNav />
        </div>
      </div>

      {/* Контент конкретного раздела (India Inside, Ayurveda и т.д.) */}
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
