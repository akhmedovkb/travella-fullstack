//frontend/src/pages/CmsPage.jsx

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

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
        if (alive) setData({ title: d.title || "", body: d.body || "" });
      } catch {
        if (alive) setData({ title: "", body: "" });
      }
    })();
    return () => { alive = false; };
  }, [slug, i18n.language]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 prose prose-neutral">
      <h1>{data.title}</h1>
      {/* если body — markdown, можно подключить лайт-рендерер; пока рендерим как HTML */}
      <div dangerouslySetInnerHTML={{ __html: data.body }} />
    </div>
  );
}
