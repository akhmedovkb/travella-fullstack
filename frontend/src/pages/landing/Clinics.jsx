//frontend/src/pages/landing/Clinics.jsx
import { useTranslation } from "react-i18next";

export default function Clinics() {
  const { t } = useTranslation();
  return (
    <main className="py-2">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.clinics.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.clinics.sub")}</p>
      {/* только инфо */}
    </main>
  );
}
