// frontend/src/pages/admin/AdminHotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";
import { moderateInspection } from "../../api/hotels";
import { tSuccess, tError } from "../../shared/toast";

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function statusLabel(status) {
  const s = String(status || "approved").toLowerCase();
  const map = {
    pending: "⏳ На модерации",
    approved: "✅ Опубликовано",
    published: "✅ Опубликовано",
    rejected: "⛔ Отклонено",
    hidden: "🙈 Скрыто",
    deleted: "🗑 Удалено",
    draft: "📝 Черновик",
  };
  return map[s] || s;
}

function statusClass(status) {
  const s = String(status || "approved").toLowerCase();
  if (s === "pending") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (s === "rejected") return "bg-red-50 text-red-700 ring-red-100";
  if (s === "hidden" || s === "deleted") return "bg-slate-100 text-slate-700 ring-slate-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

function short(text, n = 160) {
  const s = String(text || "").trim();
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function getInspectionMedia(item) {
  const sectionMedia = arr(item?.section_media);
  const proofMedia = arr(item?.proof_media).map((m) => ({
    ...(typeof m === "string" ? { url: m } : m),
    section_key: "proof",
    caption: m?.caption || "Доказательство визита",
  }));
  const legacy = arr(item?.media).map((url) => ({ url, thumbnail_url: url, media_type: "photo", section_key: "legacy" }));
  return [...sectionMedia, ...proofMedia, ...legacy].filter((m) => m?.url || m?.thumbnail_url);
}

function MediaCarousel({ items = [] }) {
  const slides = arr(items).filter((m) => m?.url || m?.thumbnail_url);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= slides.length) setIdx(0);
  }, [idx, slides.length]);

  if (!slides.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-400">
        Фото/видео не прикреплены
      </div>
    );
  }

  const active = slides[idx] || slides[0];
  const src = active.url || active.thumbnail_url;
  const thumb = active.thumbnail_url || active.url;
  const isVideo = String(active.media_type || "photo").toLowerCase() === "video";
  const many = slides.length > 1;

  const prev = () => setIdx((v) => (v - 1 + slides.length) % slides.length);
  const next = () => setIdx((v) => (v + 1) % slides.length);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-slate-100 shadow-sm">
        <div className="h-72 md:h-96">
          {isVideo ? (
            <video
              src={src}
              poster={thumb && thumb !== src ? thumb : undefined}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-slate-950 object-contain"
            />
          ) : (
            <img src={thumb || src} alt={active.caption || ""} className="h-full w-full object-contain bg-slate-50" />
          )}
        </div>

        {many ? (
          <>
            <button type="button" onClick={prev} className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl font-black text-slate-950 shadow-sm ring-1 ring-white/70 hover:bg-white" aria-label="Предыдущее медиа">‹</button>
            <button type="button" onClick={next} className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl font-black text-slate-950 shadow-sm ring-1 ring-white/70 hover:bg-white" aria-label="Следующее медиа">›</button>
            <div className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs font-black text-white">{idx + 1}/{slides.length}</div>
          </>
        ) : null}
      </div>

      {(active.caption || active.section_key) ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs font-bold text-slate-500">
          {active.section_key ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{active.section_key}</span> : null}
          {active.caption ? <span>{active.caption}</span> : null}
        </div>
      ) : null}

      {many ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {slides.map((m, i) => {
            const t = m.thumbnail_url || m.url;
            const video = String(m.media_type || "photo").toLowerCase() === "video";
            return (
              <button
                key={m.id || m.url || i}
                type="button"
                onClick={() => setIdx(i)}
                className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-2xl border bg-white ${i === idx ? "border-orange-400 ring-2 ring-orange-100" : "border-slate-200"}`}
              >
                {t ? <img src={t} alt="" className="h-full w-full object-cover" /> : null}
                {video ? <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white">▶</div> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminHotelInspections({ embedded = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet("/api/hotels/inspections?sort=new", "admin");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      tError(e?.message || "Не удалось загрузить инспекции");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const base = { pending: 0, approved: 0, rejected: 0, hidden: 0, all: items.length };
    for (const item of items) {
      const s = String(item.status || item.moderation_status || "approved").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(base, s)) base[s] += 1;
    }
    return base;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      const s = String(item.status || item.moderation_status || "approved").toLowerCase();
      if (status !== "all" && s !== status) return false;
      if (!needle) return true;
      return [item.title, item.review, item.hotel_name, item.author_name, item.hotel_city]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(needle));
    });
  }, [items, q, status]);

  async function setModeration(item, nextStatus) {
    const reason = nextStatus === "rejected" ? window.prompt("Причина отклонения", item.rejection_reason || "Нужно уточнить информацию") : "";
    if (nextStatus === "rejected" && reason === null) return;
    try {
      const res = await moderateInspection(item.id, {
        status: nextStatus,
        reason,
        verified_visit: nextStatus === "approved",
      });
      const next = res?.item || { id: item.id, status: nextStatus, moderation_status: nextStatus };
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, ...next } : x));
      tSuccess(nextStatus === "approved" ? "Инспекция опубликована" : "Статус обновлён");
    } catch (e) {
      tError(e?.message || "Не удалось обновить статус");
    }
  }

  const shellClass = embedded ? "space-y-5" : "mx-auto max-w-7xl space-y-5 p-4 md:p-6";

  return (
    <div className={shellClass}>
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#07111f,#7c2d12)] p-5 text-white md:p-7">
          <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/10">
            Travella Hotel Passport
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">Модерация инспекций отелей</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/75">
            Проверка pending-инспекций, доказательств визита, фото/видео и качества контента перед публикацией в Hotel Passport.
          </p>
          <div className="mt-5 grid gap-2 md:grid-cols-5">
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{stats.pending}</div><div className="text-[11px] font-black text-white/65">на модерации</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{stats.approved}</div><div className="text-[11px] font-black text-white/65">опубликовано</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{stats.rejected}</div><div className="text-[11px] font-black text-white/65">отклонено</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{stats.hidden}</div><div className="text-[11px] font-black text-white/65">скрыто</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{stats.all}</div><div className="text-[11px] font-black text-white/65">всего</div></div>
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr_auto]">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-300">
            <option value="pending">На модерации</option>
            <option value="approved">Опубликовано</option>
            <option value="rejected">Отклонено</option>
            <option value="hidden">Скрыто</option>
            <option value="all">Все</option>
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по отелю, автору, городу, тексту" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-300" />
          <button onClick={load} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white">Обновить</button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[28px] bg-white p-8 text-center font-bold text-slate-500 shadow-sm">Загрузка…</div>
      ) : filtered.length ? (
        <div className="grid gap-4">
          {filtered.map((item) => {
            const media = getInspectionMedia(item);
            const currentStatus = item.status || item.moderation_status;
            return (
              <article key={item.id} className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-700">#{item.id}</span>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-black ring-1 ${statusClass(currentStatus)}`}>{statusLabel(currentStatus)}</span>
                      {item.verified_visit ? <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">🛡 Проверенный визит</span> : null}
                      {Number(item.report_count || 0) > 0 ? <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-100">⚠ Жалоб: {item.report_count}</span> : null}
                      <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black text-orange-700 ring-1 ring-orange-100">Медиа: {media.length}</span>
                    </div>
                    <h2 className="mt-3 text-xl font-black tracking-[-0.03em] text-slate-950">{item.title || "Без заголовка"}</h2>
                    <div className="mt-1 text-sm font-bold text-slate-500">
                      {item.hotel_name ? <Link to={`/hotels/${item.hotel_id}`} className="text-orange-600 hover:underline">{item.hotel_name}</Link> : `Hotel #${item.hotel_id}`}
                      {item.hotel_city ? ` · ${item.hotel_city}` : ""} · Автор: {item.author_name || "—"}
                    </div>
                    {item.review ? <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{short(item.review, 620)}</p> : null}
                    {item.pros ? <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-950 ring-1 ring-emerald-100"><b className="text-emerald-700">Плюсы:</b> {short(item.pros, 240)}</div> : null}
                    {item.cons ? <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-950 ring-1 ring-amber-100"><b className="text-amber-700">Минусы:</b> {short(item.cons, 240)}</div> : null}
                    {item.rejection_reason ? <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700 ring-1 ring-red-100">Причина: {item.rejection_reason}</div> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => setModeration(item, "approved")} className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100">✅ Одобрить</button>
                      <button onClick={() => setModeration(item, "rejected")} className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700 ring-1 ring-red-100 hover:bg-red-100">⛔ Отклонить</button>
                      <button onClick={() => setModeration(item, "hidden")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200">🙈 Скрыть</button>
                    </div>
                  </div>
                  <MediaCarousel items={media} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">🏨</div>
          <div className="mt-3 text-lg font-black text-slate-950">Инспекций по фильтру нет</div>
          <div className="mt-1 text-sm font-semibold text-slate-500">Смените статус или обновите список.</div>
        </div>
      )}
    </div>
  );
}
