//frontend/src/pages/admin/CmsEditor.jsx
import React, { useEffect, useState } from "react";
import ReactQuill from "react-quill";
import { apiGet, apiPut } from "../../api";

const SLUGS = ["about","mission","project","partners","contacts","privacy","faq"];

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["link"],
    ["clean"],
  ],
};

const quillFormats = [
  "header",
  "bold", "italic", "underline", "strike",
  "list", "bullet",
  "align",
  "link",
];

export default function CmsEditor() {
  const [slug, setSlug] = useState(SLUGS[0]);
  const [form, setForm] = useState({
    title_ru:"", title_uz:"", title_en:"",
    body_ru:"",  body_uz:"",  body_en:"",
    published:true
  });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Загружаем сразу все языки (RU/UZ/EN), чтобы править существующий текст
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg("");
      try {
        const [ru, uz, en] = await Promise.all([
          apiGet(`/api/cms/pages/${slug}?lang=ru`),
          apiGet(`/api/cms/pages/${slug}?lang=uz`),
          apiGet(`/api/cms/pages/${slug}?lang=en`),
        ]);

        const r = ru?.data || {};
        const u = uz?.data || {};
        const e = en?.data || {};

        if (!alive) return;

        setForm({
          title_ru: r.title || "",
          body_ru: r.body || "",
          title_uz: u.title || "",
          body_uz: u.body || "",
          title_en: e.title || "",
          body_en: e.body || "",
          published: r.published ?? u.published ?? e.published ?? true,
        });
      } catch (err) {
        if (alive) {
          setMsg("Ошибка загрузки");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [slug]);

  const save = async () => {
    try {
      await apiPut(`/api/cms/pages/${slug}`, form);
      setMsg("Сохранено");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {
      setMsg("Ошибка сохранения");
    }
  };

  const inp = (name, p={}) => (
    <input
      className="border rounded px-3 py-2 w-full"
      value={form[name] || ""}
      onChange={e=>setForm({...form, [name]: e.target.value})}
      {...p}
    />
  );

  const quill = (name) => (
    <div className="border rounded overflow-hidden bg-white">
      <ReactQuill
        theme="snow"
        value={form[name] || ""}
        onChange={(val) => setForm((f) => ({ ...f, [name]: val }))}
        modules={quillModules}
        formats={quillFormats}
      />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">CMS страницы (подвал)</h1>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label>Страница:</label>
        <select
          className="border rounded px-3 py-2"
          value={slug}
          onChange={e=>setSlug(e.target.value)}
        >
          {SLUGS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="ml-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!form.published}
            onChange={e=>setForm({...form, published: e.target.checked})}
          />
          Опубликована
        </label>

        {loading ? (
          <span className="text-sm text-neutral-400 ml-2">Загрузка…</span>
        ) : (
          <span className="text-sm text-green-600 ml-2">{msg}</span>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <h2 className="font-semibold mb-2">RU</h2>
          {inp("title_ru", { placeholder: "Заголовок (RU)" })}
          <div className="mt-2">{quill("body_ru")}</div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">UZ</h2>
          {inp("title_uz", { placeholder: "Sarlavha (UZ)" })}
          <div className="mt-2">{quill("body_uz")}</div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">EN</h2>
          {inp("title_en", { placeholder: "Title (EN)" })}
          <div className="mt-2">{quill("body_en")}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
        >
          Сохранить
        </button>

        <a
          className="underline"
          href={`/page/${slug}`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть публичную
        </a>
      </div>
    </div>
  );
}
