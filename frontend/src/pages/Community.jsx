// frontend/src/pages/Community.jsx
import React from "react";
import SocialPostCard from "../components/social/SocialPostCard";
import { getSocialFeed } from "../api/social";

export default function Community() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [type, setType] = React.useState("");
  const [following, setFollowing] = React.useState(false);
  const [error, setError] = React.useState("");
  async function load() {
    setLoading(true); setError("");
    try { const r = await getSocialFeed({ type, following: following ? 1 : "" }); setItems(Array.isArray(r.items) ? r.items : []); }
    catch (e) { setError(e?.message || "Не удалось загрузить ленту"); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [type, following]);
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-2 py-4 md:px-4">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-5 text-white shadow-sm md:p-7">
        <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-white/80">Travella Community</div>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] md:text-4xl">Туристическая лента поставщиков</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Посты, новости, обзоры, фото, видео и свежие предложения от участников Travella. Это первый слой соцсети поверх текущего маркетплейса.</p>
      </section>
      <div className="flex flex-wrap items-center gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        {[["", "Все"], ["offer", "🔥 Предложения"], ["review", "⭐ Обзоры"], ["photo", "📸 Фото"], ["video", "🎬 Видео"], ["article", "✍️ Статьи"]].map(([v, label]) => <button key={v || "all"} onClick={() => setType(v)} className={`rounded-full px-4 py-2 text-sm font-bold ${type === v ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>{label}</button>)}
        <button onClick={() => setFollowing((x) => !x)} className={`ml-auto rounded-full px-4 py-2 text-sm font-bold ${following ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700"}`}>Мои подписки</button>
      </div>
      {error ? <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}
      {loading ? <div className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-500">Загрузка ленты...</div> : null}
      {!loading && !items.length ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Пока нет публикаций. После первого поста поставщика лента оживёт.</div> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-5">{items.map((p) => <SocialPostCard key={p.id} post={p} />)}</div><aside className="hidden space-y-3 lg:block"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black text-slate-950">Что это даёт Travella</h3><p className="mt-2 text-sm leading-6 text-slate-600">Поставщики начинают публиковать контент, клиенты подписываются, а маркетплейс получает ежедневную причину для возвращения.</p></div></aside></div>
    </div>
  );
}
