import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { copy, metadata, headTags, structuredData, languagePath, servicePath, serviceFacts, priceText, staticPages } from '../../../shared/seo';

function applyHead(meta, lang, path, item = null) {
  document.title = meta.title;
  document.documentElement.lang = lang;
  document.head.querySelectorAll('[data-travella-seo], meta[name="description"], meta[name="robots"], link[rel="canonical"], link[rel="alternate"][hreflang], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]').forEach(node => node.remove());
  const holder = document.createElement('template');
  holder.innerHTML = headTags(meta, lang, path);
  [...holder.content.children].filter(node => node.tagName !== 'TITLE').forEach(node => { node.dataset.travellaSeo = 'true'; document.head.appendChild(node); });
  const schema = document.createElement('script');
  schema.type = 'application/ld+json'; schema.dataset.travellaSeo = 'true';
  schema.textContent = JSON.stringify(structuredData(meta, lang, item));
  document.head.appendChild(schema);
}
export function SeoHead() {
  const location = useLocation(); const { i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || 'ru').split('-')[0];
  useEffect(() => {
    if (/^\/services\/\d+/.test(location.pathname)) return;
    const meta = metadata(location.pathname, lang);
    meta.indexable = meta.indexable && staticPages.includes(location.pathname) && ![...new URLSearchParams(location.search).keys()].some(key => !/^utm_|^(gclid|fbclid)$/.test(key));
    if (!meta.indexable) meta.languages = [];
    applyHead(meta, lang, location.pathname);
  }, [location.pathname, location.search, lang]);
  return null;
}
export function SeoNotFound() {
  const { i18n } = useTranslation(); const c = copy[i18n.resolvedLanguage] || copy.ru;
  return <main className="max-w-3xl mx-auto p-8"><h1 className="text-2xl font-bold">{c.notFound}</h1><p className="my-4">{c.notFoundHint}</p><Link to="/" className="text-orange-600 underline">{c.back}</Link></main>;
}
export default function ServiceDetails() {
  const { idSlug } = useParams(); const id = Number(idSlug.split('-')[0]);
  const { i18n } = useTranslation(); const lang = String(i18n.resolvedLanguage || 'ru').split('-')[0]; const c = copy[lang];
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController(); setState({ loading: true });
    fetch('/api/seo/services/' + id, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Object.assign(new Error('unavailable'), { status: response.status });
      return response.json();
    }).then(data => setState({ item: data.item })).catch(error => { if (error.name !== 'AbortError') setState({ error: error.status === 404 ? 'notFound' : 'unavailable' }); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (state.item) applyHead(metadata(servicePath(state.item), lang, state.item), lang, servicePath(state.item), state.item);
    else if (state.error) { const meta = metadata('/services/' + id, lang); meta.title = c[state.error] + ' | Travella'; meta.indexable = false; meta.languages = []; applyHead(meta, lang, '/services/' + id); }
  }, [state, lang, id, c]);
  if (state.loading) return <main className="max-w-3xl mx-auto p-8" aria-busy="true">Travella…</main>;
  if (state.error) return <main className="max-w-3xl mx-auto p-8"><h1 className="text-2xl font-bold">{c[state.error]}</h1><p className="my-4">{c[state.error === 'notFound' ? 'notFoundHint' : 'retry']}</p><Link to="/">{c.back}</Link></main>;
  const item = state.item;
  return <main className="max-w-4xl mx-auto px-4 py-8 break-words"><Link to="/" className="text-orange-600">← {c.back}</Link><article className="mt-5 rounded-2xl border bg-white overflow-hidden shadow-sm">
    {item.image && <img src={item.image} alt={item.title} className="w-full max-h-96 object-contain bg-slate-50" />}
    <div className="p-5 sm:p-8"><h1 className="text-2xl sm:text-3xl font-bold">{item.title}</h1><dl className="grid sm:grid-cols-[180px_1fr] gap-x-5 gap-y-2 my-6">{serviceFacts(item, lang).map(([label, value]) => <React.Fragment key={label}><dt className="font-semibold text-slate-600">{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    <section className="rounded-xl bg-orange-50 p-5"><h2 className="font-semibold">{c.price}</h2><p className="text-xl font-bold mt-2">{priceText(item, lang)}</p></section>
    <h2 className="text-xl font-semibold mt-7">{c.contact}</h2><p className="text-slate-600 mt-2 mb-5">{c.contactHint}</p><Link to={'/?opened=' + item.id + '&view=details'} className="inline-flex rounded-xl bg-orange-500 text-white font-semibold px-6 py-3">{c.open}</Link></div>
  </article></main>;
}
