// frontend/src/components/social/SocialPostCard.jsx
import React from "react";
import { Link } from "react-router-dom";
import { toggleSocialLike } from "../../api/social";

function formatDate(v) {
  if (!v) return "";
  try { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)); } catch { return ""; }
}
function badge(type) {
  const map = { offer: "🔥 Предложение", news: "📰 Новость", review: "⭐ Обзор", photo: "📸 Фото", video: "🎬 Видео", article: "✍️ Статья" };
  return map[type] || "Пост";
}

export default function SocialPostCard({ post, onChanged }) {
  const [liked, setLiked] = React.useState(!!post?.liked_by_me);
  const [likes, setLikes] = React.useState(Number(post?.likes_count || 0));
  const provider = post?.provider || {};
  const media = Array.isArray(post?.media) ? post.media : [];

  async function like() {
    try {
      const r = await toggleSocialLike(post.id);
      setLiked(!!r.liked);
      setLikes(Number(r.likes_count || 0));
      onChanged?.();
    } catch (e) {
      alert(e?.message || "Нужно войти в аккаунт");
    }
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-lg font-black text-slate-700">
            {provider.photo ? <img src={provider.photo} alt="" className="h-full w-full object-cover" /> : String(provider.name || "T").slice(0,1)}
          </div>
          <div className="min-w-0 flex-1">
            <Link to={`/profile/provider/${provider.id}`} className="font-black text-slate-950 hover:underline">
              {provider.name || `Поставщик #${post.provider_id}`}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{badge(post.type)}</span><span>•</span><span>{formatDate(post.created_at)}</span>
              {provider.location ? <><span>•</span><span>{provider.location}</span></> : null}
            </div>
          </div>
        </div>
        {post.title ? <h2 className="mt-4 text-xl font-black tracking-[-0.03em] text-slate-950">{post.title}</h2> : null}
        {post.body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p> : null}
      </div>
      {media.length ? (
        <div className={`grid gap-1 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {media.slice(0, 4).map((m, i) => (
            <div key={`${m.url}-${i}`} className="relative aspect-[4/3] bg-slate-100">
              {m.media_type === "video" ? <video src={m.url} controls className="h-full w-full object-cover" /> : <img src={m.url} alt="" className="h-full w-full object-cover" loading="lazy" />}
              {i === 3 && media.length > 4 ? <div className="absolute inset-0 grid place-items-center bg-black/50 text-2xl font-black text-white">+{media.length - 4}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
        <button type="button" onClick={like} className={`rounded-full px-4 py-2 font-bold ${liked ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>{liked ? "♥" : "♡"} {likes}</button>
        <div className="text-xs font-semibold text-slate-500">💬 {Number(post.comments_count || 0)} комментариев</div>
      </div>
    </article>
  );
}
