// frontend/src/components/Header.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites } from "../api/providerFavorites";
import AdminQuickTools from "./admin/AdminQuickTools";

/* --- Inline SVG icons --- */
const IconChecklist = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 8h8M8 12h8M8 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M7 4.5l1 1 2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconModeration = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 5h16v4H4zM7 9v10m10-10v7m-5-7v10" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const IconDashboard = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const IconRequests = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 4h16v12H7l-3 3V4Z" stroke="currentColor" strokeWidth="2" />
    <path d="M8 8h8M8 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconBookings = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M7 3v4M17 3v4M4 8h16v13H4V8Z" stroke="currentColor" strokeWidth="2" />
    <path d="M8 12h8M8 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconHeart = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}>
    <path
      d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a5 5 0 0 1 6.573.33L12 9.08l2.547-1.55a5 5 0 0 1 6.573.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </svg>
);

const IconWallet = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path
      d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v1H6.5a1.5 1.5 0 0 0 0 3H20v6a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="16.5" cy="11.5" r="1" fill="currentColor" />
  </svg>
);

const IconUsers = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" />
    <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
    <path d="M20 21v-2a3 3 0 0 0-3-3h-1" stroke="currentColor" strokeWidth="2" />
    <circle cx="17" cy="7" r="2" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const IconHotel = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 20h18M5 20V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="2" />
    <path d="M7 9h4M7 12h4M7 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M14 11h5a2 2 0 0 1 2 2v7" stroke="currentColor" strokeWidth="2" />
    <path d="M14 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconTicket = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2" />
    <path d="M9 7v10M15 7v10" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
  </svg>
);

const IconDoc = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="2" />
    <path d="M14 3v6h6" stroke="currentColor" strokeWidth="2" />
    <path d="M10 13h7M10 17h7M10 9h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconBurger = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconClose = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconChevron = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconProfile = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
    <path d="M6 19a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const YES = new Set(["1", "true", "yes", "on"]);

function detectAdmin(profile) {
  const p = profile || {};
  const roles = []
    .concat(p.role || [])
    .concat(p.roles || [])
    .flatMap((r) => String(r).split(","))
    .map((s) => s.trim());
  const perms = [].concat(p.permissions || p.perms || []).map(String);
  let is =
    !!(p.is_admin || p.isAdmin || p.admin || p.moderator || p.is_moderator) ||
    roles.some((r) => ["admin", "moderator", "super", "root"].includes(r.toLowerCase())) ||
    perms.some((x) => ["moderation", "admin:moderation"].includes(x.toLowerCase()));
  if (typeof window !== "undefined" && import.meta?.env?.DEV) {
    const v = localStorage.getItem("isAdminUiHint");
    if (v && YES.has(String(v).toLowerCase())) is = true;
  }
  return is;
}

function detectAdminFromJwt() {
  try {
    const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
    if (!tok) return false;
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
      .map((s) => s.trim());
    const perms = [].concat(claims.permissions || claims.perms || []).map(String);
    return (
      claims.role === "admin" ||
      claims.is_admin === true ||
      claims.moderator === true ||
      roles.some((r) => ["admin", "moderator", "super", "root"].includes(r.toLowerCase())) ||
      perms.some((x) => ["moderation", "admin:moderation"].includes(x.toLowerCase()))
    );
  } catch {
    return false;
  }
}

function formatHeaderBalance(value, lang = "ru") {
  const amount = Number(value || 0) / 100;
  const locale = lang === "uz" ? "uz-UZ" : lang === "en" ? "en-US" : "ru-RU";
  const currency = lang === "uz" ? "so'm" : lang === "en" ? "sum" : "сум";
  return `${Math.round(amount).toLocaleString(locale)} ${currency}`;
}

export default function Header() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const { t, i18n } = useTranslation();
  const location = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef(null);

  const [donasOpen, setDonasOpen] = useState(false);
  const [donasMobileOpen, setDonasMobileOpen] = useState(false);

  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);

  const [mobileOpen, setMobileOpen] = useState(false);

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [clientBalance, setClientBalance] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const jwtAdmin = detectAdminFromJwt();
      if (jwtAdmin) {
        if (alive) setIsAdmin(true);
        return;
      }
      if (role !== "provider") {
        if (alive) setIsAdmin(false);
        return;
      }
      try {
        const p = await apiGet("/api/providers/profile", role);
        if (alive) setIsAdmin(detectAdmin(p));
      } catch {
        const v = localStorage.getItem("isAdminUiHint");
        if (alive) setIsAdmin(!!(v && YES.has(String(v).toLowerCase())));
      }
    })();
    return () => {
      alive = false;
    };
  }, [role]);

  useEffect(() => {
    const onDoc = (e) => {
      if (adminRef.current && !adminRef.current.contains(e.target)) setAdminOpen(false);
      if (servicesRef.current && !servicesRef.current.contains(e.target)) setServicesOpen(false);
      if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (role !== "provider") return undefined;
    let alive = true;
    const load = async () => {
      try {
        const list = await apiProviderFavorites();
        if (alive) setFavCount(Array.isArray(list) ? list.length : 0);
      } catch {
        if (alive) setFavCount(0);
      }
    };
    load();
    const onChanged = () => load();
    window.addEventListener("provider:favorites:changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("provider:favorites:changed", onChanged);
    };
  }, [role]);

  useEffect(() => {
    if (role !== "client") {
      setClientBalance(0);
      return undefined;
    }

    let alive = true;
    const loadBalance = async () => {
      try {
        setBalanceLoading(true);
        const res = await apiGet("/api/client/balance", "client");
        if (alive) setClientBalance(Number(res?.balance || 0));
      } catch {
        if (alive) setClientBalance(0);
      } finally {
        if (alive) setBalanceLoading(false);
      }
    };

    loadBalance();
    const onChanged = () => loadBalance();
    window.addEventListener("client:balance:changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("client:balance:changed", onChanged);
    };
  }, [role, refreshTick]);

  useEffect(() => {
    if (role !== "provider") return undefined;
    let cancelled = false;
    const fetchCounts = async () => {
      setLoading(true);
      try {
        const rs = await apiGet("/api/requests/provider/stats", role);
        const requestsNew = Number(rs?.new || 0);

        let bookingsPending = 0;
        let bookingsTotal = 0;
        try {
          const bs = await apiGet("/api/providers/stats", role);
          bookingsTotal = Number(bs?.bookings_total ?? bs?.total ?? 0);
          if (bs && (bs.pending != null || bs.awaiting != null || bs.new != null)) {
            bookingsPending = Number(bs.pending ?? bs.awaiting ?? bs.new ?? 0);
          }
        } catch {
          const bl = await apiGet("/api/providers/bookings", role);
          const list = Array.isArray(bl) ? bl : bl?.items || [];
          bookingsPending = list.filter((x) => String(x.status).toLowerCase() === "pending").length;
          bookingsTotal = list.length;
        }

        if (!cancelled) {
          setCounts({
            requests_open: Number(rs?.open || 0) + requestsNew,
            requests_accepted: Number(rs?.accepted || 0),
            bookings_pending: bookingsPending,
            bookings_total: bookingsTotal,
          });
        }
      } catch {
        if (!cancelled) setCounts(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCounts();
    const id = setInterval(fetchCounts, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [role, refreshTick]);

  useEffect(() => {
    const bump = () => setRefreshTick((x) => x + 1);
    window.addEventListener("provider:counts:refresh", bump);
    window.addEventListener("provider:inbox:changed", bump);
    return () => {
      window.removeEventListener("provider:counts:refresh", bump);
      window.removeEventListener("provider:inbox:changed", bump);
    };
  }, []);

  useEffect(() => {
    if (role !== "client") return undefined;
    const fetchFavs = async () => {
      try {
        const res = await apiGet("/api/wishlist", true);
        const list = Array.isArray(res) ? res : res?.items || [];
        setFavCount(list.length);
      } catch {
        setFavCount(0);
      }
    };
    fetchFavs();
    const onFavChanged = () => fetchFavs();
    window.addEventListener("wishlist:changed", onFavChanged);
    return () => window.removeEventListener("wishlist:changed", onFavChanged);
  }, [role, location.pathname, location.search]);

  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);
  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;

  useEffect(() => {
    setMobileOpen(false);
    setAdminOpen(false);
    setServicesOpen(false);
    setToolsOpen(false);
    setDonasOpen(false);
    setDonasMobileOpen(false);
  }, [location]);

  const servicesActive = location.pathname.startsWith("/dashboard/services/") || location.pathname === "/dashboard/calendar";
  const toolsActive = location.pathname.startsWith("/dashboard/passport-parser");
  const donasActive = location.pathname.startsWith("/admin/donas-dosas/");

  const providerLabel = useMemo(() => t("nav.provider_workspace", "Кабинет поставщика"), [t]);
  const clientLabel = useMemo(() => t("nav.client_workspace", "Кабинет клиента"), [t]);

  return (
    <header className="sticky top-0 z-40 border-b border-black/40 bg-[#111] text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <div className="mx-auto max-w-7xl px-2 sm:px-3">
        <div className="relative z-10 flex min-h-14 items-center justify-between gap-2 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="relative z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/5 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-orange-400 xl:hidden"
              aria-label="Menu"
            >
              {mobileOpen ? <IconClose /> : <IconBurger />}
            </button>

            <Link to="/" className="inline-flex shrink-0 items-center" aria-label="Travella Home">
              <img
                src="/logo1.jpg"
                alt="Travella"
                className="h-10 w-auto object-contain sm:h-11 md:h-12"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.src = "/logo7.jpg";
                }}
              />
            </Link>

            <nav className="hidden min-w-0 items-center gap-1 lg:gap-2 xl:flex">
              <NavItemDark to="/" label="MARKETPLACE" end />
              {role === "provider" && <NavItemDark to="/tour-builder" label={t("nav.tour_builder", "Tour Builder")} />}
              <NavItemDark to="/hotels" label={t("nav.hotels", "Отели")} icon={<IconHotel />} />
            </nav>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-1 xl:flex">
            {role === "provider" && (
              <>
                <DesktopSectionLabel label={providerLabel} />
                <NavItemDark to="/dashboard/profile" label={t("nav.profile", "Профиль")} icon={<IconProfile />} />

                <div className="relative" ref={servicesRef}>
                  <MenuButton
                    active={servicesOpen || servicesActive}
                    open={servicesOpen}
                    icon={<IconChecklist />}
                    label={t("nav.services_tab", "Услуги")}
                    onClick={() => setServicesOpen((v) => !v)}
                  />
                  {servicesOpen && (
                    <DropdownPanel align="right" width="w-80">
                      <DropdownCaption title={t("nav.services_group", "Управление услугами")} />
                      <DropdownItem
                        to="/dashboard/services/marketplace"
                        label={t("nav.services_marketplace_short", "Маркетплейс")}
                        description={t("nav.services_marketplace_desc", "Отказные туры, отели, авиабилеты и другие услуги")}
                        icon={<IconChecklist />}
                      />
                      <DropdownItem
                        to="/dashboard/services/tourbuilder"
                        label={t("nav.services_tourbuilder_short", "Tour Builder")}
                        description={t("nav.services_tourbuilder_desc", "Услуги для конструктора туров")}
                        icon={<IconChecklist />}
                      />
                      <DropdownItem
                        to="/dashboard/calendar"
                        label={t("nav.provider_calendar", "Календарь")}
                        description={t("nav.provider_calendar_desc", "Занятость, блокировки и бронирования")}
                        icon={<IconBookings />}
                      />
                    </DropdownPanel>
                  )}
                </div>

                <NavBadgeDark to="/dashboard/requests" label={t("nav.requests", "Запросы")} icon={<IconRequests />} value={providerRequests} loading={loading} />
                <NavBadgeDark to="/dashboard/favorites" label={t("nav.favorites", "Избранное")} icon={<IconHeart />} value={favCount} />
                <NavBadgeDark to="/dashboard/bookings" label={t("nav.bookings", "Брони")} icon={<IconBookings />} value={bookingsBadge} loading={loading} />

                <div className="relative" ref={toolsRef}>
                  <MenuButton
                    active={toolsOpen || toolsActive}
                    open={toolsOpen}
                    icon={<IconDoc />}
                    label={t("nav.tools", "Инструменты")}
                    onClick={() => setToolsOpen((v) => !v)}
                  />
                  {toolsOpen && (
                    <DropdownPanel align="right" width="w-72">
                      <DropdownItem
                        to="/dashboard/passport-parser"
                        label="Passport Parser"
                        description={t("nav.passport_parser_desc", "Распознавание паспортных данных")}
                        icon={<IconDoc />}
                      />
                    </DropdownPanel>
                  )}
                </div>
              </>
            )}

            {role === "client" && (
              <>
                <DesktopSectionLabel label={clientLabel} />
                <NavItemDark to="/client/dashboard" label={t("client.header.cabinet", { defaultValue: "Кабинет" })} icon={<IconDashboard />} />
                <NavLink
                  to="/client/balance"
                  className={({ isActive }) => navPillClass(isActive)}
                >
                  <IconWallet />
                  <span>{t("client.header.balance", { defaultValue: "Баланс" })}</span>
                  <span className="ml-1 rounded-full bg-orange-500 px-2 py-0.5 text-[11px] leading-none text-white">
                    {balanceLoading ? "…" : formatHeaderBalance(clientBalance, i18n.language)}
                  </span>
                </NavLink>
                <NavBadgeDark
                  to="/client/dashboard?tab=favorites"
                  label={t("client.header.favorites", { defaultValue: "Избранное" })}
                  icon={<IconHeart />}
                  value={favCount}
                />
              </>
            )}

            {isAdmin && (
              <div className="relative" ref={adminRef}>
                <MenuButton
                  active={adminOpen || location.pathname.startsWith("/admin/")}
                  open={adminOpen}
                  icon={<IconModeration />}
                  label={t("nav.admin", "Админ")}
                  onClick={() => setAdminOpen((v) => !v)}
                />
                {adminOpen && (
                  <DropdownPanel align="right" width="w-80">
                    <DropdownCaption title={t("nav.admin_core", "Администрирование")} />
                    <DropdownItem to="/admin/operations" label="Operations" description="Контроль отказных и настроек" icon={<IconModeration />} />
                    <DropdownItem to="/admin/refused-actual" label={t("nav.refused_actual", "Актуальные отказы")} description="Проверка актуальности услуг" icon={<IconChecklist />} />
                    <DropdownItem to="/admin/leads" label={t("nav.leads", "Leads")} description="Лиды и Telegram-привязки" icon={<IconUsers />} />
                    <DropdownItem to="/admin/providers" label={t("nav.providers_admin", "Провайдеры")} description="Поставщики и доступы" icon={<IconUsers />} />
                    <DropdownItem to="/admin/finance" label={t("nav.finance_admin", "Finance")} description="Финансы платформы" icon={<IconDoc />} />
                    <DropdownItem to="/admin/billing" label={t("nav.billing_admin", "Billing")} description="Биллинг и открытия контактов" icon={<IconWallet />} />
                    <DropdownItem to="/admin/broadcast" label={t("nav.broadcast", "Рассылка")} description="Telegram/платформенные рассылки" icon={<IconDoc />} />
                    <DropdownItem to="/admin/inside-requests" label={t("nav.inside_requests", "Inside заявки")} description="Заявки India Inside" icon={<IconChecklist />} />
                    <DropdownItem to="/admin/entry-fees" label={t("nav.entry_fees_admin", "Entry fees")} icon={<IconTicket />} />
                    <DropdownItem to="/admin/hotels" label={t("nav.hotels_admin", "Отели (админ)")} icon={<IconHotel />} />
                    <DropdownItem to="/admin/pages" label={t("nav.cms_pages", "Подвал")} icon={<IconDoc />} />

                    <button
                      type="button"
                      onClick={() => setDonasOpen((v) => !v)}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                        donasActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
                      ].join(" ")}
                    >
                      <span className="flex h-5 w-5 items-center justify-center"><IconBurger /></span>
                      <span className="flex-1 text-left font-semibold">DONA’S DOSAS</span>
                      <IconChevron className={`transition ${donasOpen ? "rotate-180" : ""}`} />
                    </button>

                    {donasOpen && (
                      <div className="bg-black/20">
                        <DropdownItem to="/admin/donas-dosas/finance" label="Finance" icon={<IconDoc />} />
                        <DropdownItem to="/admin/donas-dosas/inventory" label="Inventory" icon={<IconDoc />} />
                        <DropdownItem to="/admin/donas-dosas/menu" label="Menu" icon={<IconDoc />} />
                      </div>
                    )}

                    <div className="border-t border-white/10 p-2">
                      <AdminQuickTools />
                    </div>
                  </DropdownPanel>
                )}
              </div>
            )}

            <div className="ml-1 border-l border-white/10 pl-2">
              <LanguageSelector />
            </div>
          </div>

          <div className="flex items-center gap-2 xl:hidden">
            {role === "client" && (
              <Link to="/client/balance" className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
                {balanceLoading ? "…" : formatHeaderBalance(clientBalance, i18n.language)}
              </Link>
            )}
            <LanguageSelector />
          </div>
        </div>

        <div
          className={`md:hidden overflow-hidden transition-[max-height] duration-300 ${mobileOpen ? "max-h-[82vh]" : "max-h-0"}`}
          aria-hidden={!mobileOpen}
        >
          <nav className="space-y-2 pb-3">
            <RowGroupDark title={t("nav.products", "Продукты")}>
              <NavItemMobileDark to="/" label="MARKETPLACE" end />
              {role === "provider" && <NavItemMobileDark to="/tour-builder" label={t("nav.tour_builder", "Tour Builder")} />}
              <NavItemMobileDark to="/hotels" label={t("nav.hotels", "Отели")} icon={<IconHotel />} />
            </RowGroupDark>

            {role === "provider" && (
              <RowGroupDark title={providerLabel}>
                <NavItemMobileDark to="/dashboard/profile" label={t("nav.profile", "Профиль")} icon={<IconProfile />} />
                <NavItemMobileDark to="/dashboard/services/marketplace" label={t("nav.services_marketplace_short", "Маркетплейс")} icon={<IconChecklist />} />
                <NavItemMobileDark to="/dashboard/services/tourbuilder" label={t("nav.services_tourbuilder_short", "Tour Builder")} icon={<IconChecklist />} />
                <NavItemMobileDark to="/dashboard/calendar" label={t("nav.provider_calendar", "Календарь")} icon={<IconBookings />} />
                <NavItemMobileDark to="/dashboard/requests" label={t("nav.requests", "Запросы")} icon={<IconRequests />} badge={providerRequests} loading={loading} />
                <NavItemMobileDark to="/dashboard/favorites" label={t("nav.favorites", "Избранное")} icon={<IconHeart />} badge={favCount} />
                <NavItemMobileDark to="/dashboard/bookings" label={t("nav.bookings", "Брони")} icon={<IconBookings />} badge={bookingsBadge} loading={loading} />
                <NavItemMobileDark to="/dashboard/passport-parser" label="Passport Parser" icon={<IconDoc />} />
              </RowGroupDark>
            )}

            {role === "client" && (
              <RowGroupDark title={clientLabel}>
                <NavItemMobileDark to="/client/dashboard" label={t("client.header.cabinet", { defaultValue: "Кабинет" })} icon={<IconDashboard />} />
                <NavItemMobileDark
                  to="/client/balance"
                  label={`${t("client.header.balance", { defaultValue: "Баланс" })} · ${balanceLoading ? "…" : formatHeaderBalance(clientBalance, i18n.language)}`}
                  icon={<IconWallet />}
                />
                <NavItemMobileDark to="/client/dashboard?tab=favorites" label={t("client.header.favorites", { defaultValue: "Избранное" })} icon={<IconHeart />} badge={favCount} />
              </RowGroupDark>
            )}

            {isAdmin && (
              <RowGroupDark title={t("nav.admin", "Админ")}>
                <NavItemMobileDark to="/admin/operations" label="Operations" icon={<IconModeration />} />
                <NavItemMobileDark to="/admin/refused-actual" label={t("nav.refused_actual", "Актуальные отказы")} icon={<IconChecklist />} />
                <NavItemMobileDark to="/admin/leads" label={t("nav.leads", "Leads")} icon={<IconUsers />} />
                <NavItemMobileDark to="/admin/providers" label={t("nav.providers_admin", "Провайдеры")} icon={<IconUsers />} />
                <NavItemMobileDark to="/admin/finance" label={t("nav.finance_admin", "Finance")} icon={<IconDoc />} />
                <NavItemMobileDark to="/admin/billing" label={t("nav.billing_admin", "Billing")} icon={<IconWallet />} />
                <NavItemMobileDark to="/admin/broadcast" label={t("nav.broadcast", "Рассылка")} icon={<IconDoc />} />
                <NavItemMobileDark to="/admin/inside-requests" label={t("nav.inside_requests", "Inside заявки")} icon={<IconChecklist />} />
                <NavItemMobileDark to="/admin/entry-fees" label={t("nav.entry_fees_admin", "Entry fees")} icon={<IconTicket />} />
                <NavItemMobileDark to="/admin/hotels" label={t("nav.hotels_admin", "Отели (админ)")} icon={<IconHotel />} />
                <NavItemMobileDark to="/admin/pages" label={t("nav.cms_pages", "Подвал")} icon={<IconDoc />} />

                <button
                  type="button"
                  onClick={() => setDonasMobileOpen((v) => !v)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                    donasActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  <span className="flex h-5 w-5 items-center justify-center"><IconBurger /></span>
                  <span className="flex-1 text-left font-semibold">DONA’S DOSAS</span>
                  <IconChevron className={`transition ${donasMobileOpen ? "rotate-180" : ""}`} />
                </button>

                {donasMobileOpen && (
                  <div className="bg-black/20">
                    <NavItemMobileDark to="/admin/donas-dosas/finance" label="Finance" icon={<IconDoc />} />
                    <NavItemMobileDark to="/admin/donas-dosas/inventory" label="Inventory" icon={<IconDoc />} />
                    <NavItemMobileDark to="/admin/donas-dosas/menu" label="Menu" icon={<IconDoc />} />
                  </div>
                )}
              </RowGroupDark>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/* ---------- Subcomponents ---------- */

function navPillClass(isActive) {
  return [
    "relative inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
    isActive
      ? "bg-white/10 text-white font-semibold after:absolute after:-bottom-1 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:bg-orange-400 after:content-['']"
      : "text-white/80 hover:bg-white/10 hover:text-white",
  ].join(" ");
}

function RowGroupDark({ title, children }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#171717] text-white ring-1 ring-white/10">
      <div className="bg-black/20 px-3 py-2 text-[13px] font-semibold text-white/70">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function DesktopSectionLabel({ label }) {
  return (
    <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45 xl:inline-flex">
      {label}
    </span>
  );
}

function MenuButton({ active, open, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
        active ? "bg-white/10 text-white font-semibold" : "text-white/80 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
      <IconChevron className={`transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function NavItemDark({ to, label, icon, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => navPillClass(isActive)}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function NavBadgeDark({ to, label, value, loading, icon }) {
  const show = Number.isFinite(value) && value > 0;
  return (
    <NavLink to={to} className={({ isActive }) => navPillClass(isActive)}>
      {icon}
      <span>{label}</span>
      <span
        className={[
          "ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none transition-colors",
          show ? "bg-orange-500 text-white" : "bg-white/10 text-white/70",
        ].join(" ")}
      >
        {loading ? "…" : show ? value : 0}
      </span>
    </NavLink>
  );
}

function DropdownPanel({ align = "left", width = "w-72", children }) {
  return (
    <div
      className={[
        "absolute z-30 mt-2 overflow-hidden rounded-2xl bg-[#171717] shadow-xl ring-1 ring-white/10",
        align === "right" ? "right-0" : "left-0",
        width,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function DropdownCaption({ title }) {
  return <div className="border-b border-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/45">{title}</div>;
}

function DropdownItem({ to, label, description, icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-start gap-2 px-3 py-2.5 text-sm transition-colors",
          isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
        ].join(" ")
      }
    >
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-5">{label}</div>
        {description && <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-white/45">{description}</div>}
      </div>
    </NavLink>
  );
}

function NavItemMobileDark({ to, label, icon, end, badge, loading }) {
  const show = Number.isFinite(badge) && badge > 0;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
        ].join(" ")
      }
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1 truncate">{label}</div>
      {badge != null && (
        <span
          className={[
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none",
            show ? "bg-orange-500 text-white" : "bg-white/10 text-white/70",
          ].join(" ")}
        >
          {loading ? "…" : show ? badge : 0}
        </span>
      )}
    </NavLink>
  );
}
