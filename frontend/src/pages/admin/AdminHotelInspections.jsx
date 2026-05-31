// frontend/src/pages/admin/AdminHotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";
import { moderateInspection } from "../../api/hotels";
import { tSuccess, tError } from "../../shared/toast";

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

function short(text, n = 160) {
  const s = String(text || "").trim();
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

export default function AdminHotelInspections() {
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      const s = String(item.status || item.moderation_status || "approved").toLowerCase();
      if (status !== "all" && s !== status) return false;
      if (!needle) return true;
      return [item.title, item.review, item.hotel_name, item.author_name]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(needle));
    });
  }, [items, q, status]);

  async function setModeration(item, nextStatus) {
    const reason = nextStatus === "rejected" ? window.prompt("Причина отклонения", "Нужно уточнить информацию") : "";
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

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#07111f,#7c2d12)] p-5 text-white md:p-7">
          <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/10">
            Travella Hotel Passport
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">Модерация инспекций отелей</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/75">
            Здесь админ проверяет новые инспекции, жалобы, доказательства визита и качество контента перед публикацией в Hotel Passport.
          </p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr_auto]">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-300">
            <option value="pending">На модерации</option>
            <option value="approved">Опубликовано</option>
            <option value="rejected">Отклонено</option>
            <option value="hidden">Скрыто</option>
            <option value="all">Все</option>
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по отелю, автору, тексту" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-300" />
          <button onClick={load} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white">Обновить</button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[28px] bg-white p-8 text-center font-bold text-slate-500 shadow-sm">Загрузка…</div>
      ) : filtered.length ? (
        <div className="grid gap-4">
          {filtered.map((item) => (
            <article key={item.id} className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-700">#{item.id}</span>
                    <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black text-orange-700 ring-1 ring-orange-100">{statusLabel(item.status || item.moderation_status)}</span>
                    {item.verified_visit ? <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">🛡 Проверенный визит</span> : null}
                    {Number(item.report_count || 0) > 0 ? <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-100">⚠ Жалоб: {item.report_count}</span> : null}
                  </div>
                  <h2 className="mt-3 text-xl font-black tracking-[-0.03em] text-slate-950">{item.title || "Без заголовка"}</h2>
                  <div className="mt-1 text-sm font-bold text-slate-500">
                    {item.hotel_name ? <Link to={`/hotels/${item.hotel_id}`} className="text-orange-600 hover:underline">{item.hotel_name}</Link> : `Hotel #${item.hotel_id}`} · Автор: {item.author_name || "—"}
                  </div>
                  {item.review ? <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{short(item.review, 420)}</p> : null}
                  {item.rejection_reason ? <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700 ring-1 ring-red-100">Причина: {item.rejection_reason}</div> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  <button onClick={() => setModeration(item, "approved")} className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100">✅ Одобрить</button>
                  <button onClick={() => setModeration(item, "rejected")} className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700 ring-1 ring-red-100 hover:bg-red-100">⛔ Отклонить</button>
                  <button onClick={() => setModeration(item, "hidden")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200">🙈 Скрыть</button>
                </div>
              </div>
            </article>
          ))}
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
