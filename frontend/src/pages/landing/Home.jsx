// frontend/src/pages/landing/Home.jsx

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";

export default function LandingHome() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <section className="rounded-3xl bg-[#FFEAD2] p-8 md:p-12">
        <h1 className="text-3xl md:text-5xl font-bold">{t("landing.home.h1")}</h1>
        <p className="mt-3 text-lg">{t("landing.home.sub")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#lead" className="px-5 py-3 bg-[#FF5722] text-white rounded-xl">
            {t("landing.home.cta")}
          </a>
          <button onClick={()=>setOpenLead(true)} className="px-5 py-3 bg-[#FF5722] text-white rounded-xl">
            {t("landing.home.cta")}
          </button>
          <a href="https://wa.me/XXXXXXXXXXX" className="px-5 py-3 border rounded-xl">
            {t("landing.home.whatsapp")}
          </a>
        </div>
      </section>

      <section className="grid md:grid-cols-4 gap-4 mt-10">
        <Link to="/tours" className="card">{t("landing.menu.tours")}</Link>
        <Link to="/ayurveda" className="card">{t("landing.menu.ayurveda")}</Link>
        <Link to="/checkup" className="card">{t("landing.menu.checkup")}</Link>
        <Link to="/treatment" className="card">{t("landing.menu.treatment")}</Link>
      </section>

      <section id="lead" className="mt-12">
        <LeadForm />
      </section>
      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="consult"
        defaultPage="/"
      />
    </main>
  );
}

function LeadForm() {
  const { t } = useTranslation();
  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd.entries())),
    });
    alert(r.ok ? t("landing.form.sent") : t("landing.form.error"));
    if (r.ok) e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl">
      <input name="name" placeholder={t("landing.form.name")} required className="input" />
      <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
      <select name="service" className="input" defaultValue="tour">
        <option value="tour">{t("landing.form.tour")}</option>
        <option value="checkup">{t("landing.form.checkup")}</option>
        <option value="ayurveda">{t("landing.form.ayurveda")}</option>
        <option value="treatment">{t("landing.form.treatment")}</option>
      </select>
      <textarea name="comment" placeholder={t("landing.form.comment")} className="input md:col-span-2" />
      <button className="btn md:col-span-2">{t("landing.form.send")}</button>
    </form>
  );
}

