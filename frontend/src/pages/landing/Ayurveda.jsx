//frontend/src/pages/landing/Ayurveda.jsx

import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";

export default function Ayurveda() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.ayurveda.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.ayurveda.sub")}</p>
      <div className="mt-5">
        <button className="btn" onClick={()=>setOpenLead(true)}>
          {t("landing.ayurveda.get")}
        </button>
      </div>
      <Form />
      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="ayurveda"
        defaultPage="/ayurveda"
      />
    </main>
  );
}

function Form() {
  const { t } = useTranslation();
  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd.entries())),
    });
    alert(t("landing.form.sent"));
    e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8">
      <input name="name" placeholder={t("landing.form.name")} required className="input" />
      <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
      <input name="dates" placeholder={t("landing.form.dates")} className="input" />
      <input name="service" value="ayurveda" readOnly hidden />
      <textarea name="comment" placeholder={t("landing.form.comment")} className="input md:col-span-2" />
      <button className="btn md:col-span-2">{t("landing.ayurveda.get")}</button>
    </form>
  );
}
