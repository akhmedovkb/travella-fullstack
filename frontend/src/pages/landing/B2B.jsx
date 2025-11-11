// frontend/src/pages/landing/B2B.jsx
import { useTranslation } from "react-i18next";

export default function B2B() {
  const { t } = useTranslation();
  return (
    <main className="py-2">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.b2b.h1")}</h1>
      <p className="mt-3 text-lg">{t("landing.b2b.sub")}</p>
    </main>
  );
}
