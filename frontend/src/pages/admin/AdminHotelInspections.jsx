// frontend/src/pages/admin/AdminHotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";
import { moderateInspection } from "../../api/hotels";
import { tSuccess, tError } from "../../shared/toast";

function arr(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeStatus(item) {
  return String(item?.status || item?.moderation_status || "approved").toLowerCase();
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
  if (s === "pending" || s === "draft") return "bg-amber-50 text-amber-800 ring-amber-100";
  if (s === "approved" || s === "published") return "bg-emerald-50 text-emerald-800 ring-emerald-100";
  if (s === "rejected") return "bg-red-50 text-red-800 ring-red-100";
  if (s === "hidden") return "bg-slate-100 text-slate-700 ring-slate-200";
  return "bg-orange-50 text-orange-700 ring-orange-100";
}

function short(text, n = 160) {
  const s = String(text || "").trim();
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mediaTypeOf(item) {
  const explicit = String(item?.media_type || item?.mediaType || "").toLowerCase();
  if (explicit) return explicit;
  const url = String(item?.url || item?.src || item || "").toLowerCase();
  return /\.(mp4|mov|webm|m4v)(\?|$)/.test(url) ? "video" : "photo";
}

function normalizeMediaEntry(m, fallbackSection = "review") {
  if (!m) return null;
  if (typeof m === "string") return { url: m, thumbnail_url: m, media_type: mediaTypeOf(m), section_key: fallbackSection };
  const url = m.url || m.src || m.secure_url || "";
  const thumb = m.thumbnail_url || m.thumbnailUrl || m.thumb || url;
  if (!url && !thumb) return null;
  return {
    ...m,
    url: url || thumb,
    thumbnail_url: thumb || url,
    media_type: mediaTypeOf(m),
    section_key: m.section_key || m.sectionKey || fallbackSection,
    caption: m.caption || m.label || "",
  };
}

function getAllMedia(item) {
  const section = arr(item?.section_media).map((m) => normalizeMediaEntry(m, "review"));
  const legacy = arr(item?.media).map((m) => normalizeMediaEntry(m, "legacy"));
  const proof = arr(item?.proof_media).map((m) => normalizeMediaEntry(m, "proof"));
  return [...section, ...legacy, ...proof].filter(Boolean);
}

function MediaGallery({ item }) {
  const media = getAllMedia(item);
  if (!media.length) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-500">
        Медиа к инспекции не найдено.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Фото и видео для проверки</div>
        <div className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-100">{media.length} файлов</div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        {media.map((m, index) => {
          const isVideo = String(m.media_type || "").toLowerCase() === "video";
          const src = m.thumbnail_url || m.url;
          return (
            <a
              key={`${m.id || m.url || index}-${index}`}
              href={m.url || src}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-2xl border border-white bg-white shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative h-32 bg-slate-900">
                {src ? <img src={src} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03]" /> : null}
                {isVideo ? <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-4xl text-white">▶</div> : null}
                <div className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-slate-700">{m.section_key || "media"}</div>
              </div>
              {(m.caption || arr(m.tags).length > 0) ? (
                <div className="p-2 text-xs font-semibold text-slate-600">
                  {m.caption ? <div className="line-clamp-2">{m.caption}</div> : null}
                  {arr(m.tags).length > 0 ? <div className="mt-1 truncate text-[11px] text-slate-400">#{arr(m.tags).join(" #")}</div> : null}
                </div>
              ) : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminHotelInspections() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState({});

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

  const counts = useMemo(() => {
    const out = { all: items.length, pending: 0, approved: 0, rejected: 0, hidden: 0 };
    for (const item of items) {
      const s = normalizeStatus(item);
      if (s === "pending" || s === "draft") out.pending += 1;
      else if (s === "approved" || s === "published") out.approved += 1;
      else if (s === "rejected") out.rejected += 1;
      else if (s === "hidden") out.hidden += 1;
    }
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      const s = normalizeStatus(item);
      if (status !== "all") {
        if (status === "approved") {
          if (s !== "approved" && s !== "published") return false;
        } else if (status === "pending") {
          if (s !== "pending" && s !== "draft") return false;
        } else if (s !== status) return false;
      }
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
      const next = res?.item || { id: item.id, status: nextStatus, moderation_status: nextStatus, rejection_reason: reason || null };
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, ...next } : x));
      tSuccess(nextStatus === "approved" ? "Инспекция опубликована" : "Статус обновлён");
    } catch (e) {
      tError(e?.message || "Не удалось обновить статус");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#07111f,#7c2d12)] p-5 text-white md:p-7">
          <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/10">
            Travella Hotel Passport
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">Модерация инспекций отелей</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/75">
            Проверка pending-инспекций, доказательств визита, фото/видео и качества контента перед публикацией в Hotel Passport.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{counts.pending}</div><div className="text-[11px] font-black text-white/60">на модерации</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{counts.approved}</div><div className="text-[11px] font-black text-white/60">опубликовано</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{counts.rejected}</div><div className="text-[11px] font-black text-white/60">отклонено</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{counts.hidden}</div><div className="text-[11px] font-black text-white/60">скрыто</div></div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><div className="text-2xl font-black">{counts.all}</div><div className="text-[11px] font-black text-white/60">всего</div></div>
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
            const s = normalizeStatus(item);
            const media = getAllMedia(item);
            const isOpen = Boolean(expanded[item.id]);
            return (
              <article key={item.id} className={`rounded-[28px] border bg-white p-4 shadow-sm md:p-5 ${s === "pending" || s === "draft" ? "border-amber-200 ring-2 ring-amber-100" : "border-slate-200"}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-700">#{item.id}</span>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-black ring-1 ${statusClass(s)}`}>{statusLabel(s)}</span>
                      {item.verified_visit ? <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">🛡 Проверенный визит</span> : null}
                      {Number(item.report_count || 0) > 0 ? <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-100">⚠ Жалоб: {item.report_count}</span> : null}
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200">📎 Медиа: {media.length}</span>
                    </div>

                    <h2 className="mt-3 text-xl font-black tracking-[-0.03em] text-slate-950">{item.title || "Без заголовка"}</h2>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-sm font-bold text-slate-500">
                      {item.hotel_name ? <Link to={`/hotels/${item.hotel_id}`} className="text-orange-600 hover:underline">{item.hotel_name}</Link> : <span>Hotel #{item.hotel_id}</span>}
                      {item.hotel_city ? <span>· {item.hotel_city}</span> : null}
                      <span>· Автор: {item.author_name || "—"}</span>
                      <span>· {formatDate(item.created_at)}</span>
                    </div>

                    {s === "pending" || s === "draft" ? (
                      <div className="mt-4 rounded-3xl bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900 ring-1 ring-amber-100">
                        ⏳ Эта инспекция ещё не публичная. Её видит автор и админ. Проверьте текст, отель, доказательства и медиа перед публикацией.
                      </div>
                    ) : null}

                    {item.review ? <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{short(item.review, isOpen ? 3000 : 420)}</p> : null}
                    {item.rejection_reason ? <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700 ring-1 ring-red-100">Причина отклонения: {item.rejection_reason}</div> : null}

                    {isOpen ? <MediaGallery item={item} /> : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:max-w-[260px] md:justify-end">
                    <button onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))} className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                      {isOpen ? "Свернуть" : "Открыть медиа"}
                    </button>
                    <button onClick={() => setModeration(item, "approved")} className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100">✅ Одобрить</button>
                    <button onClick={() => setModeration(item, "rejected")} className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700 ring-1 ring-red-100 hover:bg-red-100">⛔ Отклонить</button>
                    <button onClick={() => setModeration(item, "hidden")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200">🙈 Скрыть</button>
                  </div>
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
