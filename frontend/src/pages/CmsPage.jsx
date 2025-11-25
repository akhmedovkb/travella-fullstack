// frontend/src/pages/CmsPage.jsx

import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

// Декодируем &lt;p&gt; → <p> и т.п., чтобы Quill-HTML рендерился нормально
function decodeHtml(html) {
  if (!html) return "";
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
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
        if (alive) setData({ title: d.title || "", body: d.body || "" });
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

  const bodyHtml = decodeHtml(data.body || "");

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Хлебные крошки / верхняя подпись */}
      <div className="mb-4 text-xs uppercase tracking-[0.25em] text-gray-400 flex items-center gap-2">
        <Link to="/" className="hover:text-gray-600 transition-colors">
          Travella
        </Link>
        <span className="opacity-40">•</span>
        <span className="text-gray-500">Info</span>
      </div>

      {/* Основная карточка контента */}
      <div className="bg-white rounded-3xl shadow-sm ring-1 ring-black/5 p-6 md:p-10">
        {loading && (
          <div className="text-sm text-gray-400 mb-4">Загрузка…</div>
        )}

        {data.title && (
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-4">
            {data.title}
          </h1>
        )}

        {/* Текст из CMS — с форматированием Quill */}
        <div
          className="prose prose-neutral max-w-none leading-relaxed text-[15px] md:text-[16px]"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  );
}
