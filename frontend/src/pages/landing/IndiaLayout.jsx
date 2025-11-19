// frontend/src/pages/landing/IndiaLayout.jsx
import React from "react";
import { Outlet, Link } from "react-router-dom";
import IndiaNav from "../../components/IndiaNav";

export default function IndiaLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      {/* Верхний блок: табы India + кнопки входа */}
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Табы India Inside / Ayurveda / ... */}
        <IndiaNav />

        {/* Кнопки «Войти как клиент / поставщик» */}
        <div className="flex gap-3 justify-start lg:justify-end">
          <Link
            to="/client/login"
            className="
              inline-flex items-center justify-center
              rounded-xl border border-gray-300 bg-white
              px-4 py-2 text-sm font-medium text-gray-700
              hover:bg-gray-50
            "
          >
            Войти как клиент
          </Link>

          <Link
            to="/login"
            className="
              inline-flex items-center justify-center
              rounded-xl border border-gray-300 bg-white
              px-4 py-2 text-sm font-medium text-gray-700
              hover:bg-gray-50
            "
          >
            Войти как поставщик
          </Link>
        </div>
      </div>

      {/* Контент конкретной страницы India (Inside / Ayurveda / ...) */}
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
