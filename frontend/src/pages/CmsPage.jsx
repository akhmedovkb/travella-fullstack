// frontend/src/pages/CmsPage.jsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

// аккуратно раскодируем HTML-сущности, чтобы <p>, <ul> и т.п. стали настоящими тегами
function decodeHtmlEntities(str = "") {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  // при необходимости сюда можно добавить &quot; и &#39;
}

export default function CmsPage() {
  const { slug } = useParams();
  const { i18n } = useTranslation();
  const [data, setData] = useState({ title: "", body: "" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lang = i18n.language || "ru";
        const res = await apiGet(`/api/cms/pages/${slug}?lang=${lang}`);
        const d = res?.data || res || {};

        const title = d.title || "";
        const bodyRaw = d.body || "";
        const body = decodeHtmlEntities(bodyRaw);

        if (alive) setData({ title, body });
      } catch {
        if (alive) setData({ title: "", body: "" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, i18n.language]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 prose prose-neutral">
      {data.title && <h1>{data.title}</h1>}
      {/* теперь сюда попадает уже раскодированный HTML */}
      <div dangerouslySetInnerHTML={{ __html: data.body }} />
    </div>
  );
}
