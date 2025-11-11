// frontend/src/pages/landing/Home.jsx
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function LandingHome() {
  const { t } = useTranslation();

  return (
    <main>
      <section className="rounded-3xl bg-[#FFE4D2] p-8 md:p-12">
        <h1 className="text-3xl md:text-5xl font-bold">{t("landing.home.h1")}</h1>
        <p className="mt-3 text-lg">{t("landing.home.sub")}</p>
        {/* CTA и формы удалены. Ссылки-навигация ниже остаются */}
      </section>

      <section className="grid md:grid-cols-4 gap-4 mt-10">
        <Link to="/india/tours" className="card">{t("landing.menu.tours")}</Link>
        <Link to="/india/ayurveda" className="card">{t("landing.menu.ayurveda")}</Link>
        <Link to="/india/checkup" className="card">Check-up</Link>
        <Link to="/india/treatment" className="card">{t("landing.menu.treatment")}</Link>
      </section>
    </main>
  );
}
