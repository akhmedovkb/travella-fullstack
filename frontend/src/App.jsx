import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ToastMount } from "./shared/toast";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PrivateRoute from "./pages/PrivateRoute";
import Marketplace from "./pages/Marketplace";
import ProviderFavorites from "./pages/ProviderFavorites";

// Клиентские
import ClientRegister from "./pages/ClientRegister";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";

// Провайдерские новые страницы
import ProviderRequests from "./pages/ProviderRequests";
import ProviderBookings from "./pages/ProviderBookings";

import Header from "./components/Header";

function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

export default function App() {
  return (
    <Router>
      <ToastMount />
      <div className="min-h-screen bg-gray-100 p-4">
        <Header />

        <Routes>
          {/* Поставщик */}
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          {/* Новые провайдерские страницы */}
          <Route
            path="/dashboard/requests"
            element={
              <PrivateRoute>
                <ProviderRequests />
              </PrivateRoute>
            }
          />
          <Route
            path="/dashboard/bookings"
            element={
              <PrivateRoute>
                <ProviderBookings />
              </PrivateRoute>
            }
          />
          <Route
            path="/dashboard/favorites"
            element={
              <PrivateRoute>
                <ProviderFavorites />
              </PrivateRoute>
            }
          />
          <Route path="/marketplace" element={<Marketplace />} />

          {/* Клиент */}
          <Route path="/client/register" element={<ClientRegister />} />
          <Route path="/client/login" element={<ClientLogin />} />
          <Route
            path="/client/dashboard"
            element={
              <ClientPrivateRoute>
                <ClientDashboard />
              </ClientPrivateRoute>
            }
          />

          <Route path="*" element={<Navigate to="/marketplace" replace />} />
        </Routes>
      </div>
    </Router>
  );
}
