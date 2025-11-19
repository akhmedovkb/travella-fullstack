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
      {/* внешняя «капсула» */}
      <div
        className="
          inline-flex max-w-full items-center
          rounded-[32px] bg-amber-50/70 px-3 py-2
          shadow-sm ring-1 ring-amber-100
        "
      >
        {/* внутренняя дорожка с табами */}
        <div
          className="
            flex max-w-full items-center gap-1
            rounded-[28px] bg-white/95 px-4 py-2
            shadow-sm
            overflow-x-auto scrollbar-hide
          "
        >
          {tabs.map((t, idx) => (
            <div key={t.id} className="flex items-center">
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `
                    relative px-5 py-2 rounded-2xl
                    text-sm font-medium whitespace-nowrap tracking-wide
                    transition-all duration-200
                    ${
                      isActive
                        ? `
                          bg-gradient-to-r from-orange-500 to-amber-500
                          text-white shadow-md
                          ring-1 ring-amber-300/70
                          scale-[1.02]
                        `
                        : `
                          text-gray-700
                          hover:text-amber-700 hover:bg-amber-50
                        `
                    }
                  `
                }
              >
                {({ isActive }) => (
                  <>
                    <span>{t.label}</span>
                    {isActive && (
                      <span
                        className="
                          pointer-events-none absolute inset-x-4 -bottom-1
                          h-[2px] rounded-full
                          bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-200
                        "
                      />
                    )}
                  </>
                )}
              </NavLink>

              {/* разделитель между табами */}
              {idx !== tabs.length - 1 && (
                <span className="mx-3 text-[7px] text-amber-300 select-none">
                  •
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
