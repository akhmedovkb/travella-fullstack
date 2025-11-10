//frontend/src/pages/landing/Checkup.jsx

import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";
import { createLead } from "../../api/leads";

export default function Checkup() {
  const { t } = useTranslation();
  const lang = (typeof navigator !== "undefined" && (navigator.language||"ru"))?.slice(0,2) || "ru";
  const [openLead, setOpenLead] = useState(false);
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.checkup.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.checkup.sub")}</p>
      <div className="mt-5">
        <button className="btn" onClick={()=>setOpenLead(true)}>
          {t("landing.checkup.get")}
        </button>
      </div>
      <Form />
      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="checkup"
        defaultPage="/checkup"
      />
    </main>
  );
}

function Form() {
  const { t } = useTranslation();

  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());
    // добавим выбранную программу в комментарий
    const extra = raw.program ? `\nProgram: ${raw.program}` : "";
    try {
      await createLead({
        name: raw.name || "",
        phone: raw.phone || "",
        comment: (raw.comment || "") + extra,
        page: "/checkup",
        lang,
        service: "checkup",
      });
      alert(t("landing.form.sent"));
      e.currentTarget.reset();
    } catch (err) {
      console.error(err);
      alert(t("landing.form.error"));
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8">
      <input name="name" placeholder={t("landing.form.name")} required className="input" />
      <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
      <select name="program" className="input" defaultValue="base">
        <option value="base">{t("landing.form.programs.base")}</option>
        <option value="cardio">{t("landing.form.programs.cardio")}</option>
        <option value="onco">{t("landing.form.programs.onco")}</option>
        <option value="female">{t("landing.form.programs.female")}</option>
        <option value="male">{t("landing.form.programs.male")}</option>
      </select>
      <input name="service" value="checkup" readOnly hidden />
      <button className="btn md:col-span-2">{t("landing.checkup.get")}</button>
    </form>
  );
}
