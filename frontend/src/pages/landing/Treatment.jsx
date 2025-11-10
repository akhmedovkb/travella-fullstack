//frontend/src/pages/landing/Treatment.jsx
import { useTranslation } from "react-i18next";

export default function Treatment() {
  const { t } = useTranslation();
  return (
    <main className="py-2">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.treatment.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.treatment.sub")}</p>
    </main>
  );
}
