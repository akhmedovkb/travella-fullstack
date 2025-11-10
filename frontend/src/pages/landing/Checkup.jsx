//frontend/src/pages/landing/Checkup.jsx
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import LeadModal from "../../components/LeadModal";
import { createLead } from "../../api/leads";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function Checkup() {
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
      <Breadcrumbs
        items={[
          { label: t("landing.menu.home"), to: "/" },
          { label: "India", to: "/india" },
          { label: t("landing.menu.checkup") },
        ]}
      />
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.checkup.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.checkup.sub")}</p>

      <div className="mt-5">
        <button className="btn" onClick={() => setOpenLead(true)}>
          {t("landing.checkup.get")}
        </button>
      </div>

      <Form lang={lang} utm={utm} />

      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService="checkup"
        defaultPage="/checkup"
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

    // Программу добавим в комментарий, т.к. отдельного поля в leads нет
    const program = raw.program ? `\nProgram: ${raw.program}` : "";

    try {
      await createLead({
        name: raw.name || "",
        phone: raw.phone || "",
        comment: (raw.comment || "") + program,
        page: "/checkup",
        lang,
        service: "checkup",
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
      <select name="program" className="input" defaultValue="base">
        <option value="base">{t("landing.form.programs.base")}</option>
        <option value="cardio">{t("landing.form.programs.cardio")}</option>
        <option value="onco">{t("landing.form.programs.onco")}</option>
        <option value="female">{t("landing.form.programs.female")}</option>
        <option value="male">{t("landing.form.programs.male")}</option>
      </select>
      <textarea
        name="comment"
        placeholder={t("landing.form.comment")}
        className="input md:col-span-2"
      />
      <button disabled={loading} className="btn md:col-span-2">
        {loading ? "..." : t("landing.checkup.get")}
      </button>
    </form>
  );
}
