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
    <div className="mx-auto mb-6 flex gap-2 rounded-2xl bg-white p-2 shadow">
      {tabs.map(t => (
        <NavLink
          key={t.id}
          to={t.to}
          className={({ isActive }) =>
            `px-4 py-2 rounded-xl text-sm font-medium ${
              isActive ? "bg-orange-500 text-white" : "text-gray-700 hover:bg-gray-100"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
