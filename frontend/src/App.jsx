// frontend/src/App.jsx
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
import AdminHotelsTable from "./pages/admin/AdminHotelsTable"; // ← ОСТАВИЛ один импорт
import AdminHotelSeasons from "./pages/admin/AdminHotelSeasons";

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

// TourBuilder - Тур конструктор
import TourBuilder from "./pages/TourBuilder";

//Entry fees form
import AdminEntryFees from "./pages/AdminEntryFees";

function AdminRoute({ children }) {
  const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
  if (!tok) return <Navigate to="/login" replace />;
  try {
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const base64 = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    const claims = JSON.parse(json);

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

          {/* Отели (публичные) */}
          <Route path="/hotels" element={<Hotels />} />
          <Route path="/hotels/:hotelId" element={<HotelDetails />} />
          <Route path="/hotels/:hotelId/inspections" element={<HotelInspections />} />

          {/* Админ: список/форма отелей */}
          <Route
            path="/admin/hotels"
            element={
              <PrivateRoute>
                <AdminRoute>
                  <AdminHotelsTable />
                </AdminRoute>
              </PrivateRoute>
            }
          />

          {/* Админ: база входных билетов */}
           <Route
             path="/admin/entry-fees"
             element={
               <PrivateRoute>
                 <AdminRoute>
                   <AdminEntryFees />
                 </AdminRoute>
               </PrivateRoute>
             }
           />

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
          <Route
            path="/admin/hotels/:id/edit"
            element={
              <PrivateRoute>
                <AdminRoute>
                  <AdminHotelForm />
                </AdminRoute>
              </PrivateRoute>
            }
          />

          {/* 404 / fallback — держим в самом конце */}
          <Route path="/tour-builder" element={<TourBuilder />} />
          
          <Route path="*" element={<Navigate to="/marketplace" replace />} />

          <Route
            path="/admin/hotels/:id/seasons"
            element={
              <PrivateRoute>
                <AdminRoute>
                  <AdminHotelSeasons />
                </AdminRoute>
              </PrivateRoute>
            }
          />

        </Routes>
      </div>
    </Router>
  );
}
