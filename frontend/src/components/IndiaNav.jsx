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
    <div className="mx-auto mb-6 flex justify-center">
      <div className="flex gap-2 rounded-3xl bg-white/60 backdrop-blur-md p-3 shadow-lg ring-1 ring-amber-100/40">
        {tabs.map(t => (
          <NavLink
            key={t.id}
            to={t.to}
            className={({ isActive }) =>
              `px-5 py-2 rounded-xl text-sm font-medium transition-all duration-300
              ${isActive
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                : "text-gray-700 hover:bg-amber-50 hover:text-amber-700"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
