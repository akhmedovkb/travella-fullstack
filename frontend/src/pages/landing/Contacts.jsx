//frontend/src/pages/landing/Contacts.jsx
import { useTranslation } from "react-i18next";

export default function Contacts() {
  const { t } = useTranslation();
  return (
    <main className="py-2">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.contacts.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.contacts.sub")}</p>
    </main>
  );
}
