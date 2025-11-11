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
import AdminHotelsTable from "./pages/admin/AdminHotelsTable";
import AdminProviders from "./pages/admin/AdminProviders";
import AdminHotelSeasons from "./pages/admin/AdminHotelSeasons";
import AdminLeads from "./pages/admin/Leads";
import IndiaInside from "./pages/landing/IndiaInside";
import LeadModal from "./components/LeadModal";

// Клиентские
import ClientRegister from "./pages/ClientRegister";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";

// Провайдерские новые страницы
import ProviderRequests from "./pages/ProviderRequests";
import ProviderBookings from "./pages/ProviderBookings";

import Header from "./components/Header";
// CMS (подвал)
import Footer from "./components/Footer";
import CmsPage from "./pages/CmsPage";
import CmsEditor from "./pages/admin/CmsEditor";

// Отели
import Hotels from "./pages/Hotels";
import AdminHotelForm from "./pages/admin/AdminHotelForm";

// Конструктор шаблонов
import TemplateCreator from "./pages/TemplateCreator";

// TourBuilder - Тур конструктор
import TourBuilder from "./pages/TourBuilder";

// Entry fees form
import AdminEntryFees from "./pages/AdminEntryFees";

// Landing
import IndiaLayout from "./pages/landing/IndiaLayout";
import LandingHome from "./pages/landing/Home";
//import Tours from "./pages/landing/Tours";
import Ayurveda from "./pages/landing/Ayurveda";
import Checkup from "./pages/landing/Checkup";
import Treatment from "./pages/landing/Treatment";
import B2B from "./pages/landing/B2B";
import Clinics from "./pages/landing/Clinics";
import Contacts from "./pages/landing/Contacts";

function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

function AdminRoute({ children }) {
  const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
  if (!tok) return <Navigate to="/login" replace />;
  try {
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const base64 = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const claims = JSON.parse(json);

    const roles = []
      .concat(claims.role || [])
      .concat(claims.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase());
    const perms = []
      .concat(claims.permissions || claims.perms || [])
      .map((x) => String(x).toLowerCase());

    const isAdmin =
      claims.is_admin === true ||
      claims.moderator === true ||
      roles.some((r) => ["admin", "moderator", "super", "root"].includes(r)) ||
      perms.some((x) => ["moderation", "admin:moderation"].includes(x));

    return isAdmin ? children : <Navigate to="/marketplace" replace />;
  } catch {
    return <Navigate to="/marketplace" replace />;
  }
}

export default function App() {
  const [leadOpen, setLeadOpen] = React.useState(false);
  return (
    <Router>
      <ToastMount />
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <Header />
        <main className="flex-1 p-4">
          <Routes>
            {/* --- Публичный лендинг --- */}
            <Route path="/" element={<LandingHome />} />

            {/* --- INDIA namespace --- */}
            <Route path="/india" element={<IndiaLayout />}>
              {/* по адресу /india сразу отправляем в /india/inside */}
              <Route index element={<Navigate to="inside" replace />} />
            
              {/* /india/inside — единственная главная страница Индии */}
              <Route path="inside" element={<IndiaInside onOpenLead={() => setLeadOpen(true)} />} />
            
              {/* легаси: /india/tours → /india/inside */}
              <Route path="tours" element={<Navigate to="/india/inside" replace />} />
            
              {/* остальные разделы Индии без изменений */}
              <Route path="ayurveda" element={<Ayurveda />} />
              <Route path="checkup" element={<Checkup />} />
              <Route path="treatment" element={<Treatment />} />
              <Route path="b2b" element={<B2B />} />
              <Route path="clinics" element={<Clinics />} />
              <Route path="contacts" element={<Contacts />} />
            </Route>


            {/* --- Редиректы со старых путей на /india/* --- */}
            <Route path="/tours" element={<Navigate to="/india/inside" replace />} />
            <Route path="/ayurveda" element={<Navigate to="/india/ayurveda" replace />} />
            <Route path="/checkup" element={<Navigate to="/india/checkup" replace />} />
            <Route path="/treatment" element={<Navigate to="/india/treatment" replace />} />
            <Route path="/clinics" element={<Navigate to="/india/clinics" replace />} />
            <Route path="/b2b" element={<Navigate to="/india/b2b" replace />} />
            <Route path="/contacts" element={<Navigate to="/india/contacts" replace />} />

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

            {/* Админ и CMS */}
            <Route path="/admin/moderation" element={<AdminModeration />} />
            <Route path="/page/:slug" element={<CmsPage />} />
            <Route
              path="/admin/providers"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminProviders />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/leads"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminLeads />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
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
            <Route
              path="/admin/pages"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <CmsEditor />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
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

            {/* Отели (публичные) */}
            <Route path="/hotels" element={<Hotels />} />
            <Route path="/hotels/:hotelId" element={<HotelDetails />} />
            <Route path="/hotels/:hotelId/inspections" element={<HotelInspections />} />

            {/* Инструменты */}
            <Route path="/tour-builder" element={<TourBuilder />} />
            <Route path="/templates" element={<TemplateCreator />} />

            {/* Fallback — всегда последним */}
            <Route path="*" element={<Navigate to="/marketplace" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
      <LeadModal
        open={leadOpen}
        onClose={() => setLeadOpen(false)}
        defaultService="india_inside"
      />
    </Router>
  );
}
