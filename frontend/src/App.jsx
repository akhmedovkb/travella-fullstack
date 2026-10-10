//frontend/src/App.jsx

import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ToastMount } from "./shared/toast";

import PrivateRoute from "./pages/PrivateRoute";
import LeadModal from "./components/LeadModal";
import { installActivityTracker } from "./utils/activityTracker";
import Header from "./components/Header";
import Footer from "./components/Footer";

const lazy = (loader) => React.lazy(loader);
const Register = lazy(() => import("./pages/Register"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const Community = lazy(() => import("./pages/Community"));
const ProviderFavorites = lazy(() => import("./pages/ProviderFavorites"));
const ProviderProfile = lazy(() => import("./pages/ProviderProfile"));
const ProviderProfileCabinet = lazy(() => import("./components/ProviderProfile"));
const ClientProfile = lazy(() => import("./pages/ClientProfile"));
const AdminModeration = lazy(() => import("./pages/AdminModeration"));
const HotelDetails = lazy(() => import("./pages/HotelDetails"));
const HotelInspections = lazy(() => import("./pages/HotelInspections"));
const AdminHotelsTable = lazy(() => import("./pages/admin/AdminHotelsTable"));
const AdminProviders = lazy(() => import("./pages/admin/AdminProviders"));
const AdminHotelOffers = lazy(() => import("./pages/admin/AdminHotelOffers"));
const AdminHotelInspections = lazy(() => import("./pages/admin/AdminHotelInspections"));
const AdminLeads = lazy(() => import("./pages/admin/Leads"));
const AdminRefusedActual = lazy(() => import("./pages/admin/AdminRefusedActual"));
const IndiaInside = lazy(() => import("./pages/landing/IndiaInside"));
const AdminBroadcast = lazy(() => import("./pages/admin/AdminBroadcast"));
const DonasInvestor = lazy(() => import("./pages/admin/DonasInvestor"));
const DonasMenuItems = lazy(() => import("./pages/admin/DonasMenuItems"));
const DonasIngredients = lazy(() => import("./pages/admin/DonasIngredients"));
const DonasMenuBuilder = lazy(() => import("./pages/admin/DonasMenuBuilder"));
const DonasDosasFinanceLayout = lazy(() => import("./pages/admin/DonasDosasFinanceLayout"));
const DonasDosasFinanceOverview = lazy(() => import("./pages/admin/DonasDosasFinanceOverview"));
const DonasDosasFinanceMonths = lazy(() => import("./pages/admin/DonasDosasFinanceMonths"));
const DonasOpex = lazy(() => import("./pages/admin/DonasOpex"));
const DonasCapex = lazy(() => import("./pages/admin/DonasCapex"));
const DonasDosasCogsTab = lazy(() => import("./pages/admin/DonasDosasCogsTab"));
const DonasDosasProfitTab = lazy(() => import("./pages/admin/DonasDosasProfitTab"));
const DonasDosasMenuLayout = lazy(() => import("./pages/admin/DonasDosasMenuLayout"));
const DonasDosasFinanceSales = lazy(() => import("./pages/admin/DonasDosasFinanceSales"));
const DonasDosasMonthlySalesMargin = lazy(() => import("./pages/admin/DonasDosasMonthlySalesMargin"));
const DonasDosasInventory = lazy(() => import("./pages/admin/DonasDosasInventory"));
const AdminPaymeHealth = lazy(() => import("./pages/admin/AdminPaymeHealth"));
const PaymeLab = lazy(() => import("./pages/admin/PaymeLab"));
const AdminBilling = lazy(() => import("./pages/admin/AdminBilling"));
const AdminFinance = lazy(() => import("./pages/admin/AdminFinance"));
const AdminOperations = lazy(() => import("./pages/admin/AdminOperations"));
const AdminAiPlatform = lazy(() => import("./pages/admin/AdminAiPlatform"));
const AdminProviderSupport = lazy(() => import("./pages/admin/AdminProviderSupport"));
const AdminServiceAudit = lazy(() => import("./pages/admin/AdminServiceAudit"));
const AdminProviderFunnel = lazy(() => import("./pages/admin/AdminProviderFunnel"));
const PassportParser = lazy(() => import("./pages/PassportParser"));
const SupportSuccess = lazy(() => import("./pages/SupportSuccess"));
const SupportProject = lazy(() => import("./pages/SupportProject"));
const PaymeGuide = lazy(() => import("./pages/PaymeGuide"));
const ClientRegister = lazy(() => import("./pages/ClientRegister"));
const ClientLogin = lazy(() => import("./pages/ClientLogin"));
const ClientDashboard = lazy(() => import("./pages/ClientDashboard"));
const ClientBalance = lazy(() => import("./pages/ClientBalance"));
const ProviderRequests = lazy(() => import("./pages/ProviderRequests"));
const ProviderBookings = lazy(() => import("./pages/ProviderBookings"));
const ProviderFinance = lazy(() => import("./pages/ProviderFinance"));
const ProviderSocialPosts = lazy(() => import("./pages/ProviderSocialPosts"));
const ProviderServicesTourBuilder = lazy(() => import("./pages/ProviderServicesTourBuilder"));
const DashboardServices = lazy(() => import("./pages/DashboardServices"));
const ProviderCalendar = lazy(() => import("./components/ProviderCalendar"));
const CmsPage = lazy(() => import("./pages/CmsPage"));
const CmsEditor = lazy(() => import("./pages/admin/CmsEditor"));
const Hotels = lazy(() => import("./pages/Hotels"));
const AdminHotelForm = lazy(() => import("./pages/admin/AdminHotelForm"));
const TemplateCreator = lazy(() => import("./pages/TemplateCreator"));
const TourBuilder = lazy(() => import("./pages/TourBuilder"));
const AdminEntryFees = lazy(() => import("./pages/AdminEntryFees"));
const IndiaLayout = lazy(() => import("./pages/landing/IndiaLayout"));
const LandingHome = lazy(() => import("./pages/landing/Home"));
const Ayurveda = lazy(() => import("./pages/landing/Ayurveda"));
const Checkup = lazy(() => import("./pages/landing/Checkup"));
const Treatment = lazy(() => import("./pages/landing/Treatment"));
const B2B = lazy(() => import("./pages/landing/B2B"));
const Clinics = lazy(() => import("./pages/landing/Clinics"));
const Contacts = lazy(() => import("./pages/landing/Contacts"));
const AdminInsideRequests = lazy(() => import("./pages/admin/AdminInsideRequests"));
const AdminContactBalance = lazy(() => import("./pages/admin/AdminContactBalance"));

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

    return isAdmin ? children : <Navigate to="/" replace />;
  } catch {
    return <Navigate to="/" replace />;
  }
}

export default function App() {
  const [leadOpen, setLeadOpen] = React.useState(false);

  React.useEffect(() => {
    installActivityTracker();
  }, []);

  return (
    <Router>
      <ToastMount />
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <Header />
        <main className="flex-1 p-4">
          <React.Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Загрузка...</div>}>
          <Routes>
            {/* --- Главная: сразу MARKETPLACE --- */}
            <Route path="/" element={<Marketplace />} />
            <Route path="/community" element={<Community />} />


            <Route path="/support/success" element={<SupportSuccess />} />
            <Route path="/payme/guide" element={<PaymeGuide />} />
            <Route
              path="/support/project"
              element={
                <PrivateRoute>
                  <SupportProject />
                </PrivateRoute>
              }
            />

            {/* Старый лендинг, если понадобится отдельно */}
            <Route path="/landing" element={<LandingHome />} />

            {/* --- INDIA namespace --- */}
            <Route path="/india" element={<IndiaLayout />}>
              {/* /india → /india/inside */}
              <Route index element={<Navigate to="inside" replace />} />

              {/* /india/inside — главная India Inside */}
              <Route
                path="inside"
                element={<IndiaInside onOpenLead={() => setLeadOpen(true)} />}
              />

              {/* легаси: /india/tours → /india/inside */}
              <Route path="tours" element={<Navigate to="/india/inside" replace />} />

              {/* остальные разделы Индии */}
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
              path="/dashboard/hotels"
              element={
                <PrivateRoute>
                  <AdminHotelsTable scope="provider" />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/hotels/new"
              element={
                <PrivateRoute>
                  <AdminHotelForm />
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

            {/* 🔹 НОВОЕ: УСЛУГИ ДЛЯ TOUR BUILDER */}
            <Route
              path="/dashboard/services/tourbuilder"
              element={
                <PrivateRoute>
                  <ProviderServicesTourBuilder />
                </PrivateRoute>
              }
            />

            {/* 🔹 НОВОЕ: УСЛУГИ ДЛЯ MARKETPLACE */}
            <Route
              path="/dashboard/services/marketplace"
              element={
                <PrivateRoute>
                  <DashboardServices />
                </PrivateRoute>
              }
            />

            {/* 🔹 НОВОЕ: КАЛЕНДАРЬ ПРОВАЙДЕРА */}
            <Route
              path="/dashboard/calendar"
              element={
                <PrivateRoute>
                  <ProviderCalendar />
                </PrivateRoute>
              }
            />

            {/* новый кабинет провайдера в дашборде */}
            <Route
              path="/dashboard/profile"
              element={
                <PrivateRoute>
                  <ProviderProfileCabinet />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/finance"
              element={
                <PrivateRoute>
                  <ProviderFinance />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/social"
              element={
                <PrivateRoute>
                  <ProviderSocialPosts />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/passport-parser"
              element={
                <PrivateRoute>
                  <PassportParser />
                </PrivateRoute>
              }
            />
            {/* публичный профиль провайдера (как на витрине) */}
            <Route path="/profile/provider/:id" element={<ProviderProfile />} />
            <Route path="/provider/:id" element={<ProviderProfile />} />

            {/* Алиас старого пути MARKETPLACE */}
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
            <Route
              path="/client/balance"
              element={
                <ClientPrivateRoute>
                  <ClientBalance />
                </ClientPrivateRoute>
              }
            />

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
              path="/admin/operations"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminOperations />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/ai-platform"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminAiPlatform />
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
              path="/admin/contact-balance"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminContactBalance />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/payme-health"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminPaymeHealth />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/payme-lab"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <PaymeLab />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/billing"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminBilling />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/finance"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminFinance />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/provider-support"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminProviderSupport />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/provider-funnel"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminProviderFunnel />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/refused-actual"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminRefusedActual />
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
              path="/admin/hotels/inspections"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminHotelInspections />
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
              path="/admin/hotels/:id/offers"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminHotelOffers />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/provider/hotels/:id/offer"
              element={
                <PrivateRoute>
                  <AdminHotelOffers scope="provider" />
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/inside-requests"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminInsideRequests />
                  </AdminRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/admin/broadcast"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <AdminBroadcast />
                  </AdminRoute>
                </PrivateRoute>
              }
            />            
            <Route
                path="/admin/donas-dosas/inventory"
                element={
                  <PrivateRoute>
                    <AdminRoute>
                      <DonasDosasInventory />
                    </AdminRoute>
                  </PrivateRoute>
                }
              />
            <Route
              path="/admin/donas-dosas/finance"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <DonasDosasFinanceLayout />
                  </AdminRoute>
                </PrivateRoute>
              }
            >
              <Route index element={<DonasDosasFinanceOverview />} />
              <Route path="months" element={<DonasDosasFinanceMonths />} />
              <Route path="sales" element={<DonasDosasFinanceSales />} />
              <Route path="sales-margin" element={<DonasDosasMonthlySalesMargin />} />
              <Route path="opex" element={<DonasOpex />} />
              <Route path="capex" element={<DonasCapex />} />
              <Route path="cogs" element={<DonasDosasCogsTab />} />
              <Route path="profit" element={<DonasDosasProfitTab />} />
              <Route path="investor" element={<DonasInvestor />} />
            </Route>
            <Route
              path="/admin/donas-dosas/menu"
              element={
                <PrivateRoute>
                  <AdminRoute>
                    <DonasDosasMenuLayout />
                  </AdminRoute>
                </PrivateRoute>
              }
            >
              <Route index element={<Navigate to="ingredients" replace />} />
              <Route path="ingredients" element={<DonasIngredients />} />
              <Route path="items" element={<DonasMenuItems />} />
              <Route path="builder" element={<DonasMenuBuilder />} />
            </Route>

            <Route
              path="/admin/donas-dosas/investor"
              element={<Navigate to="/admin/donas-dosas/finance/investor" replace />}
            />

            <Route
              path="/admin/donas-dosas/menu-items"
              element={<Navigate to="/admin/donas-dosas/menu/items" replace />}
            />
            <Route
              path="/admin/donas-dosas/ingredients"
              element={<Navigate to="/admin/donas-dosas/menu/ingredients" replace />}
            />
            <Route
              path="/admin/donas-dosas/menu-builder"
              element={<Navigate to="/admin/donas-dosas/menu/builder" replace />}
            />
            <Route
              path="/admin/donas-dosas/cogs"
              element={<Navigate to="/admin/donas-dosas/finance/cogs" replace />}
            />
            <Route
              path="/admin/donas-dosas/profit"
              element={<Navigate to="/admin/donas-dosas/finance/profit" replace />}
            />

            {/* fallback alias (на случай старых ссылок) */}
            <Route
              path="/donas-dosas/investor"
              element={<DonasInvestor />}
            />

            {/* Отели (публичные) */}
            <Route path="/hotels" element={<Hotels />} />
            <Route path="/hotels/inspections" element={<HotelInspections />} />
            <Route path="/hotels/:hotelId" element={<HotelDetails />} />
            <Route path="/hotels/:hotelId/inspections" element={<HotelInspections />} />

            {/* Инструменты */}
            <Route path="/tour-builder" element={<TourBuilder />} />
            <Route path="/templates" element={<TemplateCreator />} />
            
            {/* Donas Dosas */}
            <Route
              path="/donas-dosas/finance"
              element={<Navigate to="/admin/donas-dosas/finance" replace />}
            />
            <Route path="/public/donas/investor" element={<DonasInvestor />} />

            {/* Fallback — всегда последним */}
            <Route path="*" element={<Navigate to="/" replace />} />

          </Routes>
          </React.Suspense>
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
