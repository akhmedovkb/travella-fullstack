// frontend/src/pages/landing/Ayurveda.jsx
import { useTranslation } from "react-i18next";

export default function Ayurveda() {
  const { t } = useTranslation();
  return (
    <main className="py-2">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.ayurveda.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.ayurveda.sub")}</p>
      {/* Информационный контент. Форм нет. */}
    </main>
  );
}
