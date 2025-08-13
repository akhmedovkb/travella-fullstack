// src/pages/PrivateRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";

/**
 * Универсальный PrivateRoute.
 * - Для клиента: передай role="client" (проверяется clientToken).
 * - Для провайдера: по умолчанию (проверяется token / providerToken).
 * Никакого прямого рендера Marketplace внутри! Только Navigate.
 */
export default function PrivateRoute({ children, role }) {
  const providerToken =
    localStorage.getItem("token") || localStorage.getItem("providerToken");
  const clientToken = localStorage.getItem("clientToken");

  if (role === "client") {
    return clientToken ? children : <Navigate to="/client/login" replace />;
  }

  // Провайдер по умолчанию
  return providerToken ? children : <Navigate to="/login" replace />;
}
