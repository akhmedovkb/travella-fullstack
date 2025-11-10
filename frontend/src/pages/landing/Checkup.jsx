//frontend/src/pages/landing/Checkup.jsx
import { useTranslation } from "react-i18next";

export default function Checkup() {
  const { t } = useTranslation();
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.checkup.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.checkup.sub")}</p>
    </main>
  );
}
