//frontend/src/App.jsx

import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ToastMount } from "./shared/toast";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PrivateRoute from "./pages/PrivateRoute";
import Marketplace from "./pages/Marketplace";
import ProviderFavorites from "./pages/ProviderFavorites";
import ProviderProfile from "./pages/ProviderProfile";
import ClientProfile from "./pages/ClientProfile";
import AdminModeration from "./pages/AdminModeration";
import HotelDetails from "./pages/HotelDetails";
import HotelInspections from "./pages/HotelInspections";


// Клиентские
import ClientRegister from "./pages/ClientRegister";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";

// Провайдерские новые страницы
import ProviderRequests from "./pages/ProviderRequests";
import ProviderBookings from "./pages/ProviderBookings";

import Header from "./components/Header";

// Отели
import Hotels from "./pages/Hotels";
import AdminHotelForm from "./pages/admin/AdminHotelForm";

function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

function AdminRoute({ children }) {
  const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
  if (!tok) return <Navigate to="/login" replace />;
  try {
    const base64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64));
    const roles = []
      .concat(claims.role || [])
      .concat(claims.roles || [])
      .flatMap(r => String(r).split(","))
      .map(s => s.trim().toLowerCase());
    const perms = []
      .concat(claims.permissions || claims.perms || [])
      .map((x) => String(x).toLowerCase());
    const isAdmin =
      claims.is_admin === true || claims.moderator === true ||
      roles.some(r => ["admin","moderator","super","root"].includes(r)) ||
      perms.some(x => ["moderation","admin:moderation"].includes(x));
    return isAdmin ? children : <Navigate to="/marketplace" replace />;
  } catch {
    return <Navigate to="/marketplace" replace />;
  }
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
          <Route path="/profile/provider/:id" element={<ProviderProfile />} />
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
           <Route path="/profile/client/:id" element={<ClientProfile />} />
          <Route path="/admin/moderation" element={<AdminModeration />} />
          <Route path="*" element={<Navigate to="/marketplace" replace />} />


           {/* Отели */}
          <Route path="/hotels" element={<Hotels />} />
          <Route path="/hotels/:hotelId" element={<HotelDetails />} />
          <Route path="/hotels/:hotelId/inspections" element={<HotelInspections />} />
          <Route
            path="/admin/hotels/new"
            element={
              <PrivateRoute>
                <AdminRoute>
                  <AdminHotelForm />
                </AdminRoute>
              </PrivateRoute>
            }
          />

        </Routes>
      </div>
    </Router>
  );
}
