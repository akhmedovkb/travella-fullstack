// frontend/src/pages/landing/Tours.jsx
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import LeadModal from "../../components/LeadModal";
import { createLead } from "../../api/leads";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function Tours() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [openLead, setOpenLead] = useState(false);

  const lang =
    (typeof navigator !== "undefined" && (navigator.language || "ru"))?.slice(0, 2) ||
    "ru";

  const utm = useMemo(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const sp = new URLSearchParams(search);
    return {
      utm_source: sp.get("utm_source") || "",
      utm_medium: sp.get("utm_medium") || "",
      utm_campaign: sp.get("utm_campaign") || "",
      utm_content: sp.get("utm_content") || "",
      utm_term: sp.get("utm_term") || "",
    };
  }, []);

  async function onLead(e) {
    e.preventDefault();
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());

    const payload = {
      name: raw.name || "",
      phone: raw.phone || "",
      city: raw.destination || "",
      pax: raw.pax ? Number(raw.pax) : null,
      comment: raw.comment || "",
      page: "/tours",
      lang,
      service: "tour",
      ...utm,
    };

    let ok = false;
    try {
      await createLead(payload);
      ok = true;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }

    alert(ok ? t("landing.form.sent") : t("landing.form.error"));
    if (ok) e.currentTarget.reset();
  }

  const samplesRaw = t("landing.tours.samples", { returnObjects: true });
  const samples = Array.isArray(samplesRaw) ? samplesRaw : [];

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: t("landing.menu.home"), to: "/india" },
          { label: t("landing.tours.h1") }
        ]}
      />
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.tours.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.tours.sub")}</p>

      <div className="mt-5">
        <button className="btn" onClick={() => setOpenLead(true)}>
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

      <form
        onSubmit={onLead}
        className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-10"
      >
        <input name="name" placeholder={t("landing.form.name")} required className="input" />
        <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
        <input name="destination" placeholder={t("landing.form.destination")} className="input" />
        <input name="pax" placeholder={t("landing.form.pax")} className="input" />
        <textarea
          name="comment"
          placeholder={t("landing.form.comment")}
          className="input md:col-span-2"
        />
        <button disabled={loading} className="btn md:col-span-2">
          {loading ? "..." : t("landing.tours.request")}
        </button>
      </form>

      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService="tour"
        defaultPage="/tours"
      />
    </main>
  );
}
