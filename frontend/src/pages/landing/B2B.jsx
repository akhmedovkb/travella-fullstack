// frontend/src/pages/landing/B2B.jsx
import { useTranslation } from "react-i18next";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function B2B() {
  const { t } = useTranslation();

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: t("landing.menu.home"), to: "/india" },
          { label: t("landing.B2B.h1") }
        ]}
      />
      <h1 className="text-3xl md:text-5xl font-bold">B2B</h1>
      <p className="mt-3 text-lg">
        {t("landing.b2b.sub", { defaultValue: "Information for travel partners and agencies." })}
      </p>

      <section className="grid md:grid-cols-2 gap-4 mt-8">
        <div className="card">
          <h3 className="font-semibold text-lg mb-1">{t("landing.b2b.block1.title", { defaultValue: "Programs" })}</h3>
          <p className="text-sm opacity-80">{t("landing.b2b.block1.text", { defaultValue: "Curated itineraries and wholesale rates." })}</p>
        </div>
        <div className="card">
          <h3 className="font-semibold text-lg mb-1">{t("landing.b2b.block2.title", { defaultValue: "Support" })}</h3>
          <p className="text-sm opacity-80">{t("landing.b2b.block2.text", { defaultValue: "Dedicated manager and SLA." })}</p>
        </div>
      </section>
    </main>
  );
}
