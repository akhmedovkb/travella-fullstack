// frontend/src/components/Footer.jsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

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
        if (alive) setPages([]);
      }
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
  const lang = i18n.language || "ru";

  return (
    <footer className="mt-14 bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-10 md:grid-cols-2">
          {/* LEFT: community + socials */}
          <div className="flex flex-col gap-5">
            <div className="text-sm text-neutral-300">
              {t("footer.partners_community", "Сообщество для партнёров Travella")}
            </div>

            <div className="flex items-center gap-3">
              <a
                href="https://t.me/travellauzb"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900/70 hover:bg-neutral-800 transition"
                aria-label="Telegram"
                title="Telegram"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 3L2 11l6.5 2.2L11 21l3.2-5.3L20 8.5 8.7 13.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>

              <a
                href="https://instagram.com/travella.uz"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900/70 hover:bg-neutral-800 transition"
                aria-label="Instagram"
                title="Instagram"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8"/>
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8"/>
                  <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/>
                </svg>
              </a>
            </div>
          </div>

          {/* RIGHT: phone + apps */}
          <div className="flex flex-col gap-5 md:items-end">
            <a
              href="tel:+998901234567"
              className="inline-flex items-center gap-2 text-base font-semibold text-white hover:text-[#FF5722] transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4 5c0 8.5 6.5 15 15 15l2-2-4-4-2 2c-4-1-7-4-8-8l2-2-4-4-1 1Z"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              +998 (90) 808-73-39
            </a>

            <div className="text-sm text-neutral-300 md:text-right">
              {t("footer.apps_hint", "Скачайте наше приложение — для удобной работы")}
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              <StoreBtn label="App Store" />
              <StoreBtn label="Google Play" />
              <StoreBtn label="AppGallery" />
            </div>
          </div>
        </div>

        {/* links */}
        <div className="mt-10 grid grid-cols-2 gap-y-3 gap-x-6 sm:grid-cols-3 md:grid-cols-6 text-sm">
          {items.map(it => (
            <a
              key={it.slug}
              href={`/page/${it.slug}`}
              className="text-neutral-200 hover:text-white hover:underline underline-offset-4 transition"
            >
              {map[it.slug] || it.fallback[lang] || it.fallback.ru}
            </a>
          ))}
        </div>

        {/* payments */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 opacity-90">
          <img src="/payments/visa-mastercard.png" alt="Visa / MasterCard" loading="lazy" className="h-9 sm:h-10 object-contain" />
          <img src="/payments/uzcard.jpg" alt="Uzcard" loading="lazy" className="h-9 sm:h-10 object-contain" />
          <img src="/payments/humo.png" alt="HUMO" loading="lazy" className="h-9 sm:h-10 object-contain" />
        </div>

        <div className="mt-8 text-center text-xs text-neutral-500">
          © {new Date().getFullYear()} Travella
        </div>
      </div>
    </footer>
  );
}

function StoreBtn({ label }) {
  return (
    <button
      type="button"
      className="rounded-xl bg-neutral-900/70 px-4 py-2 text-xs font-semibold tracking-wide text-white hover:bg-neutral-800 transition"
      aria-label={label}
    >
      {label}
    </button>
  );
}
