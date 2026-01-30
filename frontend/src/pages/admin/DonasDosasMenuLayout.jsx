// frontend/src/pages/admin/DonasDosasMenuLayout.jsx
import { NavLink, Outlet } from "react-router-dom";

export default function DonasDosasMenuLayout() {
  const tabs = [
    { to: "/admin/donas-dosas/menu/ingredients", label: "Ingredients" },
    { to: "/admin/donas-dosas/menu/items", label: "Items" },
    { to: "/admin/donas-dosas/menu/builder", label: "Builder" },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              [
                "px-3 py-1.5 rounded-lg text-sm border transition",
                isActive ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
