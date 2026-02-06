// frontend/src/pages/admin/DonasDosasFinanceLayout.jsx

import { NavLink, Outlet } from "react-router-dom";

function Tab({ to, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "px-3 py-2 rounded-xl text-sm border transition",
          isActive
            ? "bg-black text-white border-black"
            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function DonasDosasFinanceLayout() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500">Admin</div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Finance</h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab to="" end label="Overview" />
        <Tab to="months" label="Months" />
        <Tab to="sales" label="Sales" />
        <Tab to="sales-margin" label="Monthly Sales Margin" />
        <Tab to="opex" label="OPEX" />
        <Tab to="capex" label="CAPEX" />
        <Tab to="cogs" label="COGS" />
        <Tab to="profit" label="Profit / Margin by menu item" />
        <Tab to="investor" label="Investor" />
      </div>

      <Outlet />
    </div>
  );
}
