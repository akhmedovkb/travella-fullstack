// frontend/src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Header from "./components/Header";

// Публичные страницы
import Marketplace from "./pages/Marketplace";
import TourBuilder from "./pages/TourBuilder";
import Hotels from "./pages/Hotels";

// Провайдер
import Dashboard from "./pages/Dashboard";
import ProviderProfile from "./pages/ProviderProfile";
import ProviderCalendar from "./pages/ProviderCalendar";
import ProviderServicesTourBuilder from "./pages/ProviderServicesTourBuilder";
import ProviderServicesMarketplace from "./pages/ProviderServicesMarketplace";

// Клиент
import ClientDashboard from "./pages/ClientDashboard";

// Авторизация
import Login from "./pages/Login";
import Register from "./pages/Register";
import ClientLogin from "./pages/ClientLogin";
import ClientRegister from "./pages/ClientRegister";

function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />

      <main className="pt-2 pb-8">
        <Routes>
          {/* MARKETPLACE (главная) */}
          <Route path="/" element={<Marketplace />} />
          {/* алиас, чтобы старые ссылки /marketplace тоже работали */}
          <Route path="/marketplace" element={<Marketplace />} />

          {/* Tour Builder (для провайдера) */}
          <Route path="/tour-builder" element={<TourBuilder />} />

          {/* Отели */}
          <Route path="/hotels" element={<Hotels />} />

          {/* ------- ПРОВАЙДЕР ------- */}
          {/* Главный кабинет провайдера с табами (заявки/избранное/брони) */}
          <Route path="/dashboard/*" element={<Dashboard />} />

          {/* Профиль провайдера — отдельный компонент ProviderProfile */}
          <Route path="/dashboard/profile" element={<ProviderProfile />} />

          {/* Календарь провайдера */}
          <Route path="/dashboard/calendar" element={<ProviderCalendar />} />

          {/* Услуги для Tour Builder */}
          <Route
            path="/dashboard/services/tourbuilder"
            element={<ProviderServicesTourBuilder />}
          />

          {/* Услуги для MARKETPLACE */}
          <Route
            path="/dashboard/services/marketplace"
            element={<ProviderServicesMarketplace />}
          />

          {/* ------- КЛИЕНТ ------- */}
          <Route path="/client/dashboard/*" element={<ClientDashboard />} />

          {/* ------- АВТОРИЗАЦИЯ ------- */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route path="/client/login" element={<ClientLogin />} />
          <Route path="/client/register" element={<ClientRegister />} />

          {/* 404 → на главную */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default AppLayout;
