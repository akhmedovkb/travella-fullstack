//frontend/src/pages/landing/Clinics.jsx

import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";

export default function Clinics() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);
  const items = [
    { name: "Clinic #1 (Delhi)", spec: "Check-up / Cardio" },
    { name: "Clinic #2 (Delhi)", spec: "Oncology" },
    { name: "Clinic #3 (Delhi)", spec: "Orthopedics" },
    { name: "Clinic #4 (Delhi)", spec: "IVF" }
  ];
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.clinics.h1")}</h1>
      <div className="mt-5">
        <button className="btn" onClick={()=>setOpenLead(true)}>
          {t("landing.home.cta")}
        </button>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {items.map((it, i) => (
          <div key={i} className="card">
            <div className="text-xl font-semibold">{it.name}</div>
            <div className="text-sm mt-2 opacity-80">{it.spec}</div>
          </div>
        ))}
      </div>
      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="treatment"
        defaultPage="/clinics"
      />
    </main>
  );
}
