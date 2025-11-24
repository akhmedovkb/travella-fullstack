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
    <footer className="mt-20 bg-neutral-950 text-neutral-300">
      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Top section: left (logo/socials) + right (phone/apps) */}
        <div className="grid md:grid-cols-2 gap-12 md:gap-4 items-center">

          {/* LEFT BLOCK — ЛОГО + СОЦСЕТИ */}
          <div className="space-y-6">
            <img
              src="/logo/travella_white.svg"
              alt="Travella"
              className="h-8 opacity-90"
            />

            <div className="text-sm text-neutral-400">
              {t("footer.partners_text", "Сообщество для партнёров Travella")}
            </div>

            <div className="flex items-center gap-3">
              <a
                href="https://t.me/travella"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 hover:bg-neutral-800 transition"
              >
                <span className="text-lg">✈️</span>
              </a>
              <a
                href="https://instagram.com/travella"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 hover:bg-neutral-800 transition"
              >
                <span className="text-lg">📷</span>
              </a>
            </div>
          </div>

          {/* RIGHT BLOCK — ТЕЛЕФОН + ПРИЛОЖЕНИЕ */}
          <div className="text-left md:text-right space-y-6">

            {/* PHONE */}
            <div className="flex md:justify-end items-center gap-2 text-neutral-300 text-sm">
              <span>📞</span>
              <a href="tel:+998901234567" className="hover:text-white transition">
                +998 (90) 123-45-67
              </a>
            </div>

            {/* TEXT */}
            <div className="text-sm text-neutral-400">
              {t("footer.app_download_text", "Скачайте наше приложение — для удобной работы")}
            </div>

            {/* STORES */}
            <div className="flex md:justify-end flex-wrap gap-2">
              <a
                href="#appstore"
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 hover:bg-neutral-800 transition"
              >
                 <span className="text-xs">App Store</span>
              </a>

              <a
                href="#googleplay"
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 hover:bg-neutral-800 transition"
              >
                ▶ <span className="text-xs">Google Play</span>
              </a>

              <a
                href="#appgallery"
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 hover:bg-neutral-800 transition"
              >
                ◇ <span className="text-xs">AppGallery</span>
              </a>
            </div>
          </div>
        </div>

        {/* CMS LINKS */}
        <div className="mt-12 pt-8 border-t border-neutral-800">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {items.map((it) => (
              <a
                key={it.slug}
                href={`/page/${it.slug}`}
                className="text-neutral-400 hover:text-white text-sm hover:underline underline-offset-4 transition"
              >
                {map[it.slug] || it.fallback[i18n.language] || it.fallback.ru}
              </a>
            ))}
          </div>
        </div>

        {/* PAYMENT LOGOS */}
        <div className="mt-12 flex flex-wrap justify-center items-center gap-8 opacity-70">
          <img src="/payments/visa-mastercard.png" className="h-10" alt="Visa / MasterCard" />
          <img src="/payments/uzcard.jpg" className="h-10" alt="Uzcard" />
          <img src="/payments/humo.png" className="h-10" alt="HUMO" />
        </div>

        {/* COPYRIGHT */}
        <div className="mt-10 text-center text-xs text-neutral-500">
          © {new Date().getFullYear()} Travella
        </div>
      </div>
    </footer>
  );
}
