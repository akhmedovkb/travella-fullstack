import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import LeadModal from "../../components/LeadModal";
import { createLead } from "../../api/leads";

export default function Treatment() {
  const { t } = useTranslation();
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

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.treatment.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.treatment.sub")}</p>

      <div className="mt-5">
        <button className="btn" onClick={() => setOpenLead(true)}>
          {t("landing.treatment.get")}
        </button>
      </div>

      <Form lang={lang} utm={utm} />

      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService="treatment"
        defaultPage="/treatment"
      />
    </main>
  );
}

function Form({ lang, utm }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());

    try {
      await createLead({
        name: raw.name || "",
        phone: raw.phone || "",
        // Доп. поля можете добавлять в comment
        comment: raw.comment || "",
        page: "/treatment",
        lang,
        service: "treatment",
        ...utm,
      });
      alert(t("landing.form.sent"));
      e.currentTarget.reset();
    } catch (err) {
      console.error(err);
      alert(t("landing.form.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8"
    >
      <input name="name" placeholder={t("landing.form.name")} required className="input" />
      <input
        name="phone"
        placeholder={t("landing.form.phone")}
        required
        className="input"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
      />
      <textarea
        name="comment"
        placeholder={t("landing.form.comment")}
        className="input md:col-span-2"
      />
      <button disabled={loading} className="btn md:col-span-2">
        {loading ? "..." : t("landing.treatment.get")}
      </button>
    </form>
  );
}
