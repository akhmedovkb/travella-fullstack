//frontend/src/components/Footer.jsx

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

export default function Footer() {
  const { i18n } = useTranslation();
  const [pages, setPages] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lang = i18n.language || "ru";
        const res = await apiGet(`/api/cms/pages?lang=${lang}`);
        if (alive) setPages(Array.isArray(res) ? res : res?.data || []);
      } catch { setPages([]); }
    })();
    return () => { alive = false; };
  }, [i18n.language]);

  const items = [
    { slug: "about",    fallback: { ru: "О нас",         uz: "Biz haqimizda",      en: "About us" } },
    { slug: "mission",  fallback: { ru: "Наша миссия",   uz: "Bizning missiyamiz", en: "Our mission" } },
    { slug: "project",  fallback: { ru: "О проекте",     uz: "Loyiha haqida",      en: "About the project" } },
    { slug: "partners", fallback: { ru: "Наши партнёры", uz: "Hamkorlarimiz",      en: "Our partners" } },
    { slug: "contacts", fallback: { ru: "Наши контакты", uz: "Kontaktlarimiz",     en: "Contacts" } },
    { slug: "privacy",  fallback: { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati", en: "Privacy Policy" } },
    { slug: "faq",      fallback: { ru: "FAQ",           uz: "FAQ",                 en: "FAQ" } },
  ];


  const map = Object.fromEntries(pages.map(p => [p.slug, p.title]));

  return (
    <footer className="mt-10 border-t bg-white">
      {/* Ссылки CMS-страниц */}
      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {items.map(it => (
          <a
            key={it.slug}
            href={`/page/${it.slug}`}
            className="text-gray-700 hover:text-gray-900 underline-offset-4 hover:underline"
          >
            {map[it.slug] || it.fallback[i18n.language] || it.fallback.ru}
          </a>
        ))}
      </div>     
      {/* Платёжные системы */}
      <div className="border-t">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {/* Visa + MasterCard */}
            <img
              src="/payments/visa-mastercard.png"
              alt="Visa / MasterCard"
              loading="lazy"
              className="h-10 sm:h-[3.125rem] object-contain opacity-80 hover:opacity-100 transition"
            />
            <img src="/payments/uzcard.jpg" alt="Uzcard" loading="lazy" className="h-10 sm:h-[3.125rem] object-contain opacity-80 hover:opacity-100 transition" />
            <img src="/payments/humo.png"   alt="HUMO"   loading="lazy" className="h-10 sm:h-[3.125rem] object-contain opacity-80 hover:opacity-100 transition" />
          </div>
        </div>
      </div>
      <div className="text-center text-xs text-gray-500 pb-6">
        © {new Date().getFullYear()} Travella
      </div>
    </footer>
  );
}
