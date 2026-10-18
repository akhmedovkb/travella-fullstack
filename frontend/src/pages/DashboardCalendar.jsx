frontend/src/pages/DashboardCalendar.jsx

import React from "react";
import ProviderCalendar from "../components/ProviderCalendar";

export default function DashboardCalendar() {
  const token =
    (typeof localStorage !== "undefined" && localStorage.getItem("token")) || "";

  return (
    <div className="min-h-full bg-slate-50">
      <div className="overflow-x-auto">
        <div className="min-w-[360px]">
          <ProviderCalendar token={token} />
        </div>
      </div>
    </div>
  );
}

