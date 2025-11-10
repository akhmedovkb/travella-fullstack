// frontend/src/pages/landing/B2B.jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import LeadModal from "../../components/LeadModal";

export default function B2B() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.b2b.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.b2b.sub")}</p>

      {/* Информативный контент */}
      <section className="prose max-w-none mt-6">
        <p>{t("landing.b2b.text1")}</p>
        <p>{t("landing.b2b.text2")}</p>
      </section>

      {/* По желанию: одна кнопка, которая открывает общий поп-ап */}
      <div className="mt-6">
        <button className="btn" onClick={() => setOpenLead(true)}>
          {t("landing.b2b.cta")}
        </button>
      </div>

      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService="b2b"
        defaultPage="/b2b"
      />
    </main>
  );
}
