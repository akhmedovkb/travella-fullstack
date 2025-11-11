//frontend/src/components/IndiaNav.jsx

import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function IndiaNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const tabs = [
    { to: "/india/tours",     label: t("landing.menu.tours") },
    { name: "India Inside", to: "/india/inside" },
    { to: "/india/ayurveda",  label: t("landing.menu.ayurveda") },
    { to: "/india/checkup",   label: "Check-up" }, // обычно в ключах без дефиса; текст оставляем как бренд
    { to: "/india/treatment", label: t("landing.menu.treatment") },
    { to: "/india/clinics",   label: t("landing.menu.clinics") },
    { to: "/india/b2b",       label: "B2B" },
  ];

  return (
    <div className="w-full mt-4 mb-6">
      <div className="grid md:grid-cols-6 gap-2 border rounded-2xl bg-white">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={
                "text-center py-3 rounded-2xl transition " +
                (active
                  ? "bg-[#FF5722] text-white font-medium"
                  : "hover:bg-gray-50")
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
