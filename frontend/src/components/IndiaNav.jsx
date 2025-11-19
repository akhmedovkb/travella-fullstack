// frontend/src/components/IndiaNav.jsx
import { NavLink } from "react-router-dom";

export default function IndiaNav() {
  const tabs = [
    { id: "inside",   label: "India Inside", to: "/india/inside" },
    { id: "ayurveda", label: "Ayurveda",     to: "/india/ayurveda" },
    { id: "checkup",  label: "Check-up",     to: "/india/checkup" },
    { id: "treatment",label: "Treatment",    to: "/india/treatment" },
    { id: "clinics",  label: "Clinics",      to: "/india/clinics" },
    { id: "b2b",      label: "B2B",          to: "/india/b2b" },
  ];

  return (
    <div className="mx-auto mb-6 w-full flex justify-center">
      <div
        className="
          inline-flex max-w-full gap-1
          rounded-[28px] bg-white px-5 py-3
          shadow-sm ring-1 ring-amber-100
          overflow-x-auto scrollbar-hide
        "
      >
        {tabs.map((t, idx) => (
          <div key={t.id} className="flex items-center">
            <NavLink
              to={t.to}
              className={({ isActive }) =>
                `
                  px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap
                  tracking-wide transition-all
                  ${
                    isActive
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm"
                      : "text-gray-700 hover:text-amber-600 hover:bg-amber-50"
                  }
                `
              }
            >
              {t.label}
            </NavLink>

            {/* золотая точка между пунктами */}
            {idx !== tabs.length - 1 && (
              <span className="mx-3 text-[8px] text-amber-400 select-none">•</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
