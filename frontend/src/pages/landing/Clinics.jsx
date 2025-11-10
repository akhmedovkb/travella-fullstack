//frontend/src/pages/landing/Clinics.jsx
import { useTranslation } from "react-i18next";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function Clinics() {
  const { t } = useTranslation();

  const clinics = t("landing.clinics.items", { returnObjects: true }) || [];

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: t("landing.menu.home"), to: "/india" },
          { label: t("landing.clinics.h1") }
        ]}
      />


      <h1 className="text-3xl md:text-5xl font-bold">
        {t("landing.clinics.h1", { defaultValue: "Clinics" })}
      </h1>
      <p className="mt-3 text-lg">
        {t("landing.clinics.sub", { defaultValue: "Accredited partners and medical providers." })}
      </p>

      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {Array.isArray(clinics) && clinics.map((c, i) => (
          <div key={i} className="card">
            <div className="text-xl font-semibold">{c.name || t("landing.clinics.item", { defaultValue: "Clinic" })}</div>
            <div className="text-sm mt-2 opacity-80">{c.desc || ""}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
