// frontend/src/pages/ProviderSocialPosts.jsx
import React from "react";
import SocialPostCard from "../components/social/SocialPostCard";
import { createSocialPost, getSocialFeed } from "../api/social";

function getProviderIdFromToken() {
  try {
    const tok = localStorage.getItem("providerToken") || localStorage.getItem("token") || "";
    let b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const p = JSON.parse(atob(b64));
    return Number(p.id || p.providerId || p.sub);
  } catch { return null; }
}

export default function ProviderSocialPosts() {
  const [items, setItems] = React.useState([]);
  const [form, setForm] = React.useState({ type: "post", title: "", body: "" });
  const [files, setFiles] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const r = await getSocialFeed({ limit: 40 });
      const myId = getProviderIdFromToken();
      setItems((r.items || []).filter((x) => !myId || Number(x.provider_id) === myId));
    } catch (e) { setError(e?.message || "Не удалось загрузить посты"); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, []);
  async function submit(e) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      await createSocialPost({ ...form, files });
      setForm({ type: "post", title: "", body: "" }); setFiles([]);
      const input = document.getElementById("social-files"); if (input) input.value = "";
      await load();
    } catch (err) { setError(err?.message || "Не удалось опубликовать"); }
    finally { setSaving(false); }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"><div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-orange-600">Новый слой соцсети</div><h1 className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950">Публикации поставщика</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Здесь поставщик публикует новости, фото, видео, обзоры и предложения. Эти посты попадают в публичную ленту Travella Community.</p></section>
      <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"><div className="grid gap-4 md:grid-cols-[180px_1fr]"><label className="block"><span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Тип</span><select value={form.type} onChange={(e)=>setForm({...form,type:e.target.value})} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2"><option value="post">Пост</option><option value="offer">Предложение</option><option value="review">Обзор</option><option value="photo">Фото</option><option value="video">Видео</option><option value="article">Статья</option><option value="news">Новость</option></select></label><label className="block"><span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Заголовок</span><input value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} placeholder="Например: Новые места в авторском туре по Самарканду" className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2" /></label></div><label className="mt-4 block"><span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Текст</span><textarea value={form.body} onChange={(e)=>setForm({...form,body:e.target.value})} rows={5} placeholder="Расскажите клиентам, что нового, почему это интересно, кому подойдёт..." className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3" /></label><label className="mt-4 block"><span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Фото / видео</span><input id="social-files" type="file" multiple accept="image/*,video/*" onChange={(e)=>setFiles(Array.from(e.target.files || []).slice(0,10))} className="mt-1 w-full rounded-2xl border border-dashed border-slate-300 px-4 py-3" /></label>{error ? <div className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}<div className="mt-4 flex justify-end"><button disabled={saving} className="rounded-full bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-60">{saving ? "Публикуем..." : "Опубликовать"}</button></div></form>
      {loading ? <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-500">Загрузка...</div> : null}<div className="space-y-5">{items.map((p) => <SocialPostCard key={p.id} post={p} />)}</div>
    </div>
  );
}
