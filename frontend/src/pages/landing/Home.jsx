// frontend/src/pages/landing/Home.jsx
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function LandingHome() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs items={[{ label: "India" }]} />

      <section className="rounded-3xl bg-[#FFE4D2] p-8 md:p-12">
        <h1 className="text-3xl md:text-5xl font-bold">{t("landing.home.h1")}</h1>
        <p className="mt-3 text-lg">{t("landing.home.sub")}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="#lead"
            className="px-5 py-3 bg-[#FF5722] text-white rounded-xl"
            onClick={(e) => {
              e.preventDefault();
              setOpenLead(true);
            }}
          >
            {t("landing.home.cta")}
          </a>
          <a
            href="https://wa.me/XXXXXXXXXXXX"
            className="px-5 py-3 border rounded-xl"
          >
            {t("landing.home.whatsapp")}
          </a>
        </div>
      </section>

      <section className="grid md:grid-cols-4 gap-4 mt-10">
        <Link to="/india/tours" className="card">{t("landing.menu.tours")}</Link>
        <Link to="/india/ayurveda" className="card">{t("landing.menu.ayurveda")}</Link>
        <Link to="/india/checkup" className="card">{t("landing.menu.checkup")}</Link>
        <Link to="/india/treatment" className="card">{t("landing.menu.treatment")}</Link>
      </section>

      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService="consult"
        defaultPage="/india"
      />
    </main>
  );
}
