//frontend/src/pages/landing/Contacts.jsx
import { useTranslation } from "react-i18next";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function Contacts() {
  const { t } = useTranslation();

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: t("landing.menu.home"), to: "/india" },
          { label: t("landing.Contacts.h1") }
        ]}
      />
      <h1 className="text-3xl md:text-5xl font-bold">
        {t("landing.contacts.h1", { defaultValue: "Contacts" })}
      </h1>
      <p className="mt-3 text-lg">
        {t("landing.contacts.sub", { defaultValue: "Reach us via phone or email." })}
      </p>

      <div className="mt-8 grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="font-semibold">{t("landing.contacts.phone", { defaultValue: "Phone" })}</div>
          <div className="opacity-80">+998 (XX) XXX-XX-XX</div>
        </div>
        <div className="card">
          <div className="font-semibold">Email</div>
          <div className="opacity-80">hello@example.com</div>
        </div>
      </div>
    </main>
  );
}
