// frontend/src/App.jsx
import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ToastMount } from "./shared/toast";
import { BrowserRouter, Routes, Route } from "react-router-dom";

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
import AdminProviders from "./pages/admin/AdminProviders";
import AdminHotelSeasons from "./pages/admin/AdminHotelSeasons";
import AdminLeads from "./pages/admin/Leads";

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

function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

// TourBuilder - Тур конструктор
import TourBuilder from "./pages/TourBuilder";

//Entry fees form
import AdminEntryFees from "./pages/AdminEntryFees";

// Landing
import IndiaLayout from "./pages/landing/IndiaLayout";
import LandingHome from "./pages/landing/Home";
import Tours from "./pages/landing/Tours";
import Ayurveda from "./pages/landing/Ayurveda";
import Checkup from "./pages/landing/Checkup";
import Treatment from "./pages/landing/Treatment";
import B2B from "./pages/landing/B2B";
import Clinics from "./pages/landing/Clinics";
import Contacts from "./pages/landing/Contacts";

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
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <Header />
        <main className="flex-1 p-4">
          <Routes>
          {/* --- Публичный лендинг --- */}
          <Route path="/" element={<LandingHome />} />

          {/* --- INDIA namespace --- */}
        <Route path="/india" element={<IndiaLayout />}>
          <Route index element={<LandingHome />} />
          <Route path="tours" element={<Tours />} />
          <Route path="ayurveda" element={<Ayurveda />} />
          <Route path="checkup" element={<Checkup />} />
          <Route path="treatment" element={<Treatment />} />
          {/* информативные страницы без кнопок/форм */}
          <Route path="b2b" element={<B2B />} />
          <Route path="clinics" element={<Clinics />} />
          <Route path="contacts" element={<Contacts />} />
        </Route>

          {/* --- Редиректы со старых путей на /india/* --- */}
          <Route path="/tours" element={<Navigate to="/india/tours" replace />} />
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
          <Route path="/admin/moderation" element={<AdminModeration />} />
           {/* Публичные CMS-страницы (подвал) */}
          <Route path="/page/:slug" element={<CmsPage />} />


          {/* Отели (публичные) */}
          <Route path="/hotels" element={<Hotels />} />
          <Route path="/hotels/:hotelId" element={<HotelDetails />} />
          <Route path="/hotels/:hotelId/inspections" element={<HotelInspections />} />

          {/* Админ: список/форма отелей */}
                      
          {/* Админ: список провайдеров */}
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
          {/* Админ: лиды с лендингов Индии */}
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
          {/* Админ: редактор CMS страниц подвала */}
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

          {/* Страница конструктора шаблонов:
              - доступна всем авторизованным
              - внутри самой страницы действия ограничены ролями */}

          <Route path="/templates" element={<TemplateCreator />} />

          {/* Fallback */}
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
        </main>
        <Footer />
      </div>
    </Router>
  );
}
