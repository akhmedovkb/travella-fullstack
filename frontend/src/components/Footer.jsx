//frontend/src/components/Footer.jsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import { Link } from "react-router-dom";

export default function Footer() {
  const { i18n, t } = useTranslation();
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
    { slug: "about",    fallback: { ru: "О нас",         uz: "Biz haqimizda",      en: "About us" } },
    { slug: "mission",  fallback: { ru: "Наша миссия",   uz: "Bizning missiyamiz", en: "Our mission" } },
    { slug: "project",  fallback: { ru: "О проекте",     uz: "Loyiha haqida",      en: "About the project" } },
    { slug: "partners", fallback: { ru: "Наши партнёры", uz: "Hamkorlarimiz",      en: "Our partners" } },
    { slug: "contacts", fallback: { ru: "Наши контакты", uz: "Kontaktlarimiz",     en: "Contacts" } },
    { slug: "privacy",  fallback: { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati", en: "Privacy Policy" } },
    { slug: "faq",      fallback: { ru: "FAQ",           uz: "FAQ",                 en: "FAQ" } },
  ];

  const map = Object.fromEntries(pages.map((p) => [p.slug, p.title]));

  const lang = i18n.language || "ru";

  return (
    <footer className="mt-12 bg-[#0b0b0c] text-white">
      {/* ===== Top dark band like sutocno ===== */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="grid gap-8 md:grid-cols-2 md:items-start">
            {/* Left: logo + socials */}
            <div className="space-y-4">
              <Link to="/" className="inline-flex items-center gap-3">
                <img
                  src="/logo1.jpg"
                  alt="Travella"
                  className="h-10 w-auto sm:h-12 md:h-14 object-contain"
                  loading="lazy"
                />
              </Link>

              <div className="text-sm text-white/70">
                {t("footer.partners_community", "Сообщество для партнёров Travella")}
              </div>

              <div className="flex items-center gap-3">
                <a
                  href="https://t.me/travella"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition"
                  aria-label="Telegram"
                  title="Telegram"
                >
                  {/* Telegram icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M21.5 3.2 2.9 10.7c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.2c.2.6.1.9.7.9.4 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.6Z" fill="currentColor"/>
                  </svg>
                </a>

                <a
                  href="https://instagram.com/travella.uz"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition"
                  aria-label="Instagram"
                  title="Instagram"
                >
                  {/* Instagram icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* Right: phone + apps */}
            <div className="space-y-4 md:text-right">
              <div className="inline-flex items-center gap-2 justify-start md:justify-end text-sm font-semibold">
                {/* phone icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1l-1.3 1.3a16 16 0 0 0 6.9 6.9l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7A2 2 0 0 1 22 16.9Z"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>+998 (90) 123-45-67</span>
              </div>

              <div className="text-sm text-white/70">
                {t("footer.download_app", "Скачайте наше приложение — для удобной работы")}
              </div>

              <div className="flex flex-wrap gap-3 md:justify-end">
                {/* Пока просто кнопки-заглушки под будущие badges */}
                <a
                  href="#"
                  className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10 transition"
                >
                  App Store
                </a>
                <a
                  href="#"
                  className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10 transition"
                >
                  Google Play
                </a>
                <a
                  href="#"
                  className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10 transition"
                >
                  AppGallery
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Links (CMS) ===== */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-y-3 gap-x-6 text-sm">
          {items.map((it) => (
            <a
              key={it.slug}
              href={`/page/${it.slug}`}
              className="text-white/80 hover:text-white transition"
            >
              {map[it.slug] || it.fallback[lang] || it.fallback.ru}
            </a>
          ))}
        </div>
      </div>

      {/* ===== Payments ===== */}
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            <img
              src="/payments/visa-mastercard.png"
              alt="Visa / MasterCard"
              loading="lazy"
              className="h-8 sm:h-10 object-contain opacity-80 hover:opacity-100 transition"
            />
            <img
              src="/payments/uzcard.jpg"
              alt="Uzcard"
              loading="lazy"
              className="h-8 sm:h-10 object-contain opacity-80 hover:opacity-100 transition"
            />
            <img
              src="/payments/humo.png"
              alt="HUMO"
              loading="lazy"
              className="h-8 sm:h-10 object-contain opacity-80 hover:opacity-100 transition"
            />
          </div>
        </div>
      </div>

      {/* ===== Bottom line ===== */}
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">
        © {new Date().getFullYear()} Travella
      </div>
    </footer>
  );
}
