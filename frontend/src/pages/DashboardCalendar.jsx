frontend/src/pages/DashboardCalendar.jsx

import React from "react";
import { useTranslation } from "react-i18next";
import ProviderCalendar from "../components/ProviderCalendar";

export default function DashboardCalendar() {
  const { t } = useTranslation();
  const token =
    (typeof localStorage !== "undefined" && localStorage.getItem("token")) || "";

  return (
    <div className="bg-white rounded-xl shadow-md p-4 md:p-6">
      <h2 className="text-2xl font-bold mb-4">
        {t("calendar") || "Календарь"}
      </h2>

      {/* обёртки, чтобы календарь не «ломал» верстку на узких экранах */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        <div className="min-w-[360px] w-fit max-w-full">
          <ProviderCalendar token={token} />
        </div>
      </div>
    </div>
  );
}

