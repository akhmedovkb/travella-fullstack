// frontend/src/pages/landing/Tours.jsx
 import { useTranslation } from "react-i18next";
 import Breadcrumbs from "../../components/Breadcrumbs";

export default function Tours() {
  const samplesRaw = t("landing.tours.samples", { returnObjects: true });
  const samples = Array.isArray(samplesRaw) ? samplesRaw : [];

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: "India", to: "/india" },
          { label: t("landing.tours.h1") },
        ]}
      />
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.tours.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.tours.sub")}</p>

      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {samples.map((x, i) => (
          <div key={i} className="card">
            <div className="text-xl font-semibold">{x.city}</div>
            <div className="text-[#FF5722] font-bold mt-1">{x.price}</div>
            <div className="text-sm mt-2 opacity-80">{x.desc}</div>
          </div>
        ))}
      </div>
   </main>
  );
}
