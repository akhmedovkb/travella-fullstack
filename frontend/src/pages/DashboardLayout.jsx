// frontend/src/pages/DashboardLayout.jsx
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function DashboardLayout() {
  const { t } = useTranslation();
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 inline-flex gap-2 rounded-full border bg-white p-1 shadow-sm">
        <NavLink to="/dashboard" end
          className={({isActive}) => `px-3 py-1.5 rounded-full ${isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
          {t("profile") || "Профиль"}
        </NavLink>
        <NavLink to="/dashboard/services"
          className={({isActive}) => `px-3 py-1.5 rounded-full ${isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
          {t("services") || "Услуги"}
        </NavLink>
        <NavLink to="/dashboard/calendar"
          className={({isActive}) => `px-3 py-1.5 rounded-full ${isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
          {t("calendar") || "Календарь"}
        </NavLink>
      </div>

      {/* сюда рендерятся вкладки */}
      <Outlet />
    </div>
  );
}
