//frontend/src/pages/admin/CmsEditor.jsx

import React, { useEffect, useState } from "react";
import { apiGet, apiPut } from "../../api";

const SLUGS = ["about","mission","project","partners","contacts"];

export default function CmsEditor() {
  const [slug, setSlug] = useState(SLUGS[0]);
  const [form, setForm] = useState({
    title_ru:"", title_uz:"", title_en:"",
    body_ru:"",  body_uz:"",  body_en:"",
    published:true
  });
  const [msg, setMsg] = useState("");

  useEffect(() => { (async () => {
    const res = await apiGet(`/api/cms/pages/${slug}?lang=ru`);
    const base = res?.data || {};
    // вытянуть все языки, если нужно — отдельными запросами;
    // для простоты оставим RU как старт и редактируем сразу все поля
    setForm(f => ({ ...f, title_ru: base.title || "", body_ru: base.body || "" }));
  })(); }, [slug]);

  const save = async () => {
    try {
      await apiPut(`/api/cms/pages/${slug}`, form);
      setMsg("Сохранено");
      setTimeout(()=>setMsg(""), 2000);
    } catch(e) { setMsg("Ошибка сохранения"); }
  };

  const inp = (name, p={}) => (
    <input
      className="border rounded px-3 py-2 w-full"
      value={form[name] || ""}
      onChange={e=>setForm({...form, [name]: e.target.value})}
      {...p}
    />
  );
  const ta = (name) => (
    <textarea
      className="border rounded px-3 py-2 w-full min-h-[160px]"
      value={form[name] || ""}
      onChange={e=>setForm({...form, [name]: e.target.value})}
    />
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">CMS страницы (подвал)</h1>

      <div className="flex items-center gap-2 mb-4">
        <label>Страница:</label>
        <select className="border rounded px-3 py-2" value={slug} onChange={e=>setSlug(e.target.value)}>
          {SLUGS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="ml-4 flex items-center gap-2">
          <input type="checkbox" checked={!!form.published} onChange={e=>setForm({...form, published: e.target.checked})} />
          Опубликована
        </label>
        <span className="text-sm text-green-600">{msg}</span>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <h2 className="font-semibold mb-2">RU</h2>
          {inp("title_ru", { placeholder: "Заголовок (RU)" })}
          <div className="mt-2">{ta("body_ru")}</div>
        </div>
        <div>
          <h2 className="font-semibold mb-2">UZ</h2>
          {inp("title_uz", { placeholder: "Sarlavha (UZ)" })}
          <div className="mt-2">{ta("body_uz")}</div>
        </div>
        <div>
          <h2 className="font-semibold mb-2">EN</h2>
          {inp("title_en", { placeholder: "Title (EN)" })}
          <div className="mt-2">{ta("body_en")}</div>
        </div>
      </div>

      <div className="mt-4">
        <button onClick={save} className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600">
          Сохранить
        </button>
        <a className="ml-3 underline" href={`/page/${slug}`} target="_blank" rel="noreferrer">Открыть публичную</a>
      </div>
    </div>
  );
}
