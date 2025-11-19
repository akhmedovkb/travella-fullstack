// frontend/src/components/IndiaNav.jsx
import { NavLink } from "react-router-dom";

export default function IndiaNav() {
  const tabs = [
    { id: "inside",   label: "India Inside", icon: "🌺", to: "/india/inside" },
    { id: "ayurveda", label: "Ayurveda",     icon: "🪷", to: "/india/ayurveda" },
    { id: "checkup",  label: "Check-up",     icon: "✨", to: "/india/checkup" },
    { id: "treatment",label: "Treatment",    icon: "🌿", to: "/india/treatment" },
    { id: "clinics",  label: "Clinics",      icon: "🏥", to: "/india/clinics" },
    { id: "b2b",      label: "B2B",          icon: "🤝", to: "/india/b2b" },
  ];

  return (
    <div className="mx-auto mb-6 w-full flex justify-center">
      {/* Внешний премиальный контейнер */}
      <div
        className="
          inline-flex max-w-full gap-1
          rounded-[32px] bg-white/70 px-4 py-3
          backdrop-blur-md shadow-lg
          ring-1 ring-amber-200/40
          relative
          overflow-x-auto scrollbar-hide
        "
      >
        {/* Декоративная рамка */}
        <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-amber-100/50" />
        <div className="pointer-events-none absolute inset-[3px] rounded-[28px] border border-amber-50/60" />

        {tabs.map((t, idx) => (
          <div key={t.id} className="flex items-center">
            <NavLink
              to={t.to}
              className={({ isActive }) =>
                `
                  px-5 py-2 rounded-2xl text-sm font-medium whitespace-nowrap
                  flex items-center gap-2 transition-all duration-200
                  ${
                    isActive
                      ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-300/40"
                      : "text-gray-700 hover:bg-amber-50 hover:text-amber-700"
                  }
                `
              }
            >
              <span className="text-lg opacity-80">${t.icon}</span>
              {t.label}
            </NavLink>

            {/* Золотая точка между вкладками (кроме последней) */}
            {idx !== tabs.length - 1 && (
              <span className="mx-1 text-[10px] text-amber-400 select-none">•</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
