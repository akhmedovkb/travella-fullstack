// frontend/src/pages/admin/DonasDosasFinanceLayout.jsx
import React from "react";
import { NavLink, Outlet } from "react-router-dom";

function Tab({ to, label }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          "inline-flex items-center justify-center px-3 py-1.5 rounded-full text-sm transition",
          isActive ? "bg-black text-white" : "bg-white ring-1 ring-black/10 hover:bg-black/5",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function DonasDosasFinanceLayout() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Dona’s Dosas — Finance</h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tab to="/admin/donas-dosas/finance" label="Overview" />
          <Tab to="/admin/donas-dosas/finance/opex" label="OPEX" />
          <Tab to="/admin/donas-dosas/finance/capex" label="CAPEX" />
          <Tab to="/admin/donas-dosas/finance/cogs" label="COGS" />
          <Tab to="/admin/donas-dosas/finance/profit" label="Profit" />
          <Tab to="/admin/donas-dosas/finance/investor" label="Investor" />
        </div>
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-black/10 p-4">
        <Outlet />
      </div>
    </div>
  );
}
