//frontend/src/pages/admin/DonasDosasMenuLayout.jsx

import { NavLink, Outlet } from "react-router-dom";

export default function DonasDosasMenuLayout() {
  return (
    <div className="max-w-7xl mx-auto">
      {/* compact menu tabs */}
      <div className="flex items-center gap-2 mb-3 border-b border-gray-200 pb-2">
        <MenuTab to="/admin/donas-dosas/menu/ingredients" label="Ingredients" />
        <MenuTab to="/admin/donas-dosas/menu/items" label="Items" />
        <MenuTab to="/admin/donas-dosas/menu/builder" label="Builder" />
      </div>

      <Outlet />
    </div>
  );
}

function MenuTab({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "px-3 py-1.5 rounded-md text-sm font-medium transition",
          isActive
            ? "bg-orange-500 text-white"
            : "text-gray-600 hover:bg-gray-100",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}
