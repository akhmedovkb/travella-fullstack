//frontend/src/pages/landing/Tours.jsx

import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";

export default function Tours() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [openLead, setOpenLead] = useState(false);

  async function onLead(e) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const r = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    alert(r.ok ? t("landing.form.sent") : t("landing.form.error"));
    if (r.ok) e.currentTarget.reset();
  }

  const samples = t("landing.tours.samples", { returnObjects: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.tours.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.tours.sub")}</p>
      <div className="mt-5">
        <button className="btn" onClick={()=>setOpenLead(true)}>
          {t("landing.tours.request")}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {samples.map((x, i) => (
          <div key={i} className="card">
            <div className="text-xl font-semibold">{x.city}</div>
            <div className="text-[#FF5722] font-bold mt-1">{x.price}</div>
            <div className="text-sm mt-2 opacity-80">{x.desc}</div>
          </div>
        ))}
      </div>

      <form onSubmit={onLead} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-10">
        <input name="name" placeholder={t("landing.form.name")} required className="input" />
        <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
        <input name="destination" placeholder={t("landing.form.destination")} className="input" />
        <input name="pax" placeholder={t("landing.form.pax")} className="input" />
        <input name="service" value="tour" readOnly hidden />
        <textarea name="comment" placeholder={t("landing.form.comment")} className="input md:col-span-2" />
        <button disabled={loading} className="btn md:col-span-2">
          {loading ? "..." : t("landing.tours.request")}
        </button>
      </form>

      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="tour"
        defaultPage="/tours"
      />
    </main>
  );
}
