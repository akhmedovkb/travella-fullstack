// frontend/src/pages/CmsPage.jsx

import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

function getPrettyTitle(slug, lang) {
  const map = {
    about: {
      ru: "О Travella",
      uz: "Travella haqida",
      en: "About Travella",
    },
    mission: {
      ru: "Наша миссия",
      uz: "Bizning missiyamiz",
      en: "Our mission",
    },
    project: {
      ru: "О проекте",
      uz: "Loyiha haqida",
      en: "About the project",
    },
    partners: {
      ru: "Наши партнёры",
      uz: "Hamkorlarimiz",
      en: "Our partners",
    },
    contacts: {
      ru: "Контакты",
      uz: "Kontaktlar",
      en: "Contacts",
    },
    privacy: {
      ru: "Политика конфиденциальности",
      uz: "Maxfiylik siyosati",
      en: "Privacy policy",
    },
    faq: {
      ru: "Частые вопросы",
      uz: "Ko‘p so‘raladigan savollar",
      en: "FAQ",
    },
  };

  const lng = (lang || "ru").slice(0, 2);
  return map[slug]?.[lng] || slug;
}

export default function CmsPage() {
  const { slug } = useParams();
  const { i18n } = useTranslation();
  const [data, setData] = useState({ title: "", body: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const lang = i18n.language || "ru";
        const res = await apiGet(`/api/cms/pages/${slug}?lang=${lang}`);
        const d = res?.data || res || {};
        if (alive) {
          setData({
            title: d.title || "",
            body: d.body || "",
          });
        }
      } catch {
        if (alive) setData({ title: "", body: "" });
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug, i18n.language]);

  const fallbackTitle = getPrettyTitle(slug, i18n.language);
  const pageTitle = data.title || fallbackTitle;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-8 sm:py-10">
      <div className="max-w-5xl mx-auto">
        {/* Хлебные крошки */}
        <nav className="mb-4 sm:mb-6 text-xs sm:text-[13px] text-slate-400 flex items-center gap-1 sm:gap-2">
          <Link
            to="/"
            className="font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            Travella
          </Link>
          <span>/</span>
          <span className="truncate max-w-[60%] text-slate-500">
            {pageTitle}
          </span>
        </nav>

        {/* Карточка контента */}
        <section className="bg-white/90 backdrop-blur rounded-3xl shadow-sm ring-1 ring-slate-200/70 px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <header className="border-b border-slate-100 pb-5 mb-6">
            <p className="text-[11px] uppercase tracking-[0.18em] text-orange-500 mb-2">
              Travella • info
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-semibold tracking-tight text-slate-900">
              {pageTitle}
            </h1>
            {loading && (
              <p className="mt-2 text-xs text-slate-400">Загрузка…</p>
            )}
          </header>

          {/* Основной текст, отрендеренный как HTML из Quill */}
          <article className="prose max-w-none prose-slate prose-sm sm:prose-base lg:prose-lg prose-a:text-orange-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900">
            <div dangerouslySetInnerHTML={{ __html: data.body }} />
          </article>
        </section>
      </div>
    </div>
  );
}
