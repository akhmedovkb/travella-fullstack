// frontend/src/components/Footer.jsx
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
      } catch {
        setPages([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [i18n.language]);

  const items = [
    { slug: "about", fallback: { ru: "О нас", uz: "Biz haqimizda", en: "About us" } },
    { slug: "mission", fallback: { ru: "Наша миссия", uz: "Bizning missiyamiz", en: "Our mission" } },
    { slug: "project", fallback: { ru: "О проекте", uz: "Loyiha haqida", en: "About the project" } },
    { slug: "partners", fallback: { ru: "Наши партнёры", uz: "Hamkorlarimiz", en: "Our partners" } },
    { slug: "contacts", fallback: { ru: "Наши контакты", uz: "Kontaktlarimiz", en: "Contacts" } },
    { slug: "privacy", fallback: { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati", en: "Privacy Policy" } },
    { slug: "faq", fallback: { ru: "FAQ", uz: "FAQ", en: "FAQ" } },
  ];

  const map = Object.fromEntries(pages.map((p) => [p.slug, p.title]));

  return (
    <footer className="bg-[#111] text-gray-300 pt-12 pb-8 mt-16">
      {/* TOP SECTION: LOGO + SOCIALS + PHONE + APPS */}
      <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-10">

        {/* LEFT SIDE */}
        <div>
          <img
            src="/logo1.jpg"
            alt="Travella"
            className="h-14 w-auto mb-4 object-contain"
          />

          <div className="text-sm mb-4 opacity-90">
            Сообщество для партнёров Travella
          </div>

          {/* SOCIAL BUTTONS */}
          <div className="flex items-center gap-3 mt-3">
            <a
              href="https://t.me/travellauzb"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-xl bg-[#1e1e1e] flex items-center justify-center hover:bg-[#2a2a2a]"
            >
              <img src="/icons/telegram.svg" className="w-5 h-5" />
            </a>

            <a
              href="https://instagram.com/travella.uz"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-xl bg-[#1e1e1e] flex items-center justify-center hover:bg-[#2a2a2a]"
            >
              <img src="/icons/instagram.svg" className="w-5 h-5" />
            </a>
          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="flex flex-col items-start md:items-end text-sm">

          {/* PHONE */}
          <div className="flex items-center gap-2 text-lg font-semibold mb-4">
            <span className="text-orange-400">📞</span> +998 (90) 123-45-67
          </div>

          <div className="text-sm mb-4 opacity-80 text-right md:text-right">
            Скачайте наше приложение — для удобной работы
          </div>

          {/* APP BUTTONS */}
          <div className="flex gap-3 flex-wrap justify-end">

            <a href="#" className="bg-[#1b1b1b] px-4 py-2 rounded-xl hover:bg-[#2a2a2a]">
              <img src="/apps/appstore.png" className="h-8" />
            </a>

            <a href="#" className="bg-[#1b1b1b] px-4 py-2 rounded-xl hover:bg-[#2a2a2a]">
              <img src="/apps/googleplay.png" className="h-8" />
            </a>

            <a href="#" className="bg-[#1b1b1b] px-4 py-2 rounded-xl hover:bg-[#2a2a2a]">
              <img src="/apps/appgallery.png" className="h-8" />
            </a>
          </div>
        </div>
      </div>

      {/* LINKS BLOCK */}
      <div className="max-w-7xl mx-auto px-4 mt-14 mb-12 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-y-4 gap-x-8 text-sm">
        {items.map((it) => (
          <a
            key={it.slug}
            href={`/page/${it.slug}`}
            className="hover:text-white transition"
          >
            {map[it.slug] || it.fallback[i18n.language] || it.fallback.ru}
          </a>
        ))}
      </div>

      {/* PAYMENTS */}
      <div className="flex items-center justify-center gap-8 mb-6 opacity-80">
        <img src="/payments/visa-mastercard.png" className="h-8 object-contain" />
        <img src="/payments/uzcard.jpg" className="h-8 object-contain" />
        <img src="/payments/humo.png" className="h-8 object-contain" />
      </div>

      {/* COPYRIGHT */}
      <div className="text-center text-xs opacity-70">
        © {new Date().getFullYear()} Travella
      </div>
    </footer>
  );
}
