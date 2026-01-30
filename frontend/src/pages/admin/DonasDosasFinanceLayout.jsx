//frontend/src/pages/admin/DonasDosasFinanceLayout.jsx

import { NavLink, Outlet } from "react-router-dom";

function Tab({ to, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "px-3 py-1.5 rounded-full text-sm transition",
          isActive ? "bg-black text-white" : "bg-white text-black/70 hover:text-black hover:bg-black/10",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function DonasDosasFinanceLayout() {
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dona’s Dosas — Finance</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab to="" end label="Overview" />
        <Tab to="opex" label="OPEX" />
        <Tab to="capex" label="CAPEX" />
        <Tab to="cogs" label="COGS" />
        <Tab to="profit" label="Profit" />
      </div>

      <div className="rounded-2xl bg-white p-4 ring-1 ring-black/10">
        <Outlet />
      </div>
    </div>
  );
}
