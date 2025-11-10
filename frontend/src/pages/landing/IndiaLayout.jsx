// frontend/src/pages/landing/IndiaLayout.jsx
import { Outlet, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Breadcrumbs from "../../components/Breadcrumbs";

export default function IndiaLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation(); // e.g. /india/tours

  // сегменты после /india
  const seg = pathname.replace(/^\/+/, "").split("/");
  // seg[0] === "india", seg[1] - страница (tours|ayurveda|checkup|treatment|b2b|clinics|contacts)

  const page = seg[1] || ""; // '' на /india

  // Человеческие названия страниц (через i18n)
  const pageTitleMap = {
    tours: t("landing.tours.h1"),
    ayurveda: t("landing.ayurveda.h1"),
    checkup: t("landing.checkup.h1"),
    treatment: t("landing.treatment.h1"),
    b2b: t("landing.b2b.h1"),
    clinics: t("landing.clinics.h1"),
    contacts: t("landing.contacts.h1"),
  };

  const items = [
    { label: t("landing.menu.home"), to: "/" },
    { label: "India", to: "/india" },
  ];

  if (page && pageTitleMap[page]) {
    items.push({ label: pageTitleMap[page] });
  } else if (!page) {
    // на корне /india последняя крошка без ссылки
    items[1] = { label: "India" };
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs items={items} />
      <Outlet />
    </main>
  );
}
