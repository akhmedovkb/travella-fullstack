//frontend/src/pages/landing/B2B.jsx

import { useTranslation } from "react-i18next";

export default function B2B() {
  const { t } = useTranslation();
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.b2b.h1")}</h1>
      <ul className="list-disc pl-6 mt-4 space-y-2">
        <li>Агентские тарифы на Индию (авиабилеты + отели)</li>
        <li>Комиссия по клиникам (check-up / лечение / аюрведа)</li>
        <li>Доступ к отказным турам и спецпредложениям</li>
      </ul>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          await fetch("/api/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(fd.entries())),
          });
          alert(t("landing.form.sent"));
          e.currentTarget.reset();
        }}
        className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8"
      >
        <input name="name" placeholder={t("landing.form.name")} required className="input" />
        <input name="phone" placeholder={t("landing.form.phone")} required className="input" />
        <input name="company" placeholder={t("landing.b2b.company")} className="input" />
        <input name="service" value="b2b" readOnly hidden />
        <button className="btn md:col-span-2">{t("landing.b2b.connect")}</button>
      </form>
    </main>
  );
}

