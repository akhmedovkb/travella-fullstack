// frontend/src/pages/admin/AdminHotelSeasons.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";

/* -------------------- HTTP -------------------- */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});
api.interceptors.request.use((cfg) => {
  const t =
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("clientToken");
  if (t && !cfg.headers.Authorization) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

/* -------------------- dictionaries -------------------- */
const SEASON_OPTIONS = [
  { value: "low", label: "Низкий", hint: "базовая цена", badge: "bg-sky-50 text-sky-700 ring-sky-100" },
  { value: "shoulder", label: "Средний", hint: "межсезонье", badge: "bg-violet-50 text-violet-700 ring-violet-100" },
  { value: "high", label: "Высокий", hint: "высокий спрос", badge: "bg-orange-50 text-orange-700 ring-orange-100" },
  { value: "peak", label: "Пиковый", hint: "праздники / sold out", badge: "bg-rose-50 text-rose-700 ring-rose-100" },
  { value: "other", label: "Другой", hint: "особое правило", badge: "bg-slate-100 text-slate-700 ring-slate-200" },
];

const SEASON_BY_VALUE = SEASON_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item;
  return acc;
}, {});

/* -------------------- utils -------------------- */
const iso = (d) => {
  if (!d) return "";

  const formatLocalDate = (x) => {
    if (!(x instanceof Date) || Number.isNaN(x.getTime())) return "";
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  if (d instanceof Date) return formatLocalDate(d);

  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

  const first10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(first10)) return first10;

  const x = new Date(s);
  return formatLocalDate(x);
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const overlaps = (a, b) => !(a.end < b.start || b.end < a.start);

function parseIsoDate(value) {
  const v = iso(value);
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatRuDate(value) {
  const v = iso(value);
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return `${d}.${m}.${y}`;
}

function daysCount(start, end) {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a || !b || a > b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function validateSeasons(rows) {
  const errors = [];
  const items = rows
    .map((r) => ({
      id: r.id,
      label: (r.label || "low").trim() || "low",
      start: iso(r.start_date),
      end: iso(r.end_date),
    }))
    .filter((r) => r.start && r.end);

  rows.forEach((r) => {
    const s = iso(r.start_date);
    const e = iso(r.end_date);
    if (!s) errors.push({ id: r.id, field: "start_date", msg: "Укажите дату начала" });
    if (!e) errors.push({ id: r.id, field: "end_date", msg: "Укажите дату окончания" });
    if (s && e && s > e) {
      errors.push({ id: r.id, field: "start_date", msg: "Начало позже конца" });
      errors.push({ id: r.id, field: "end_date", msg: "Конец раньше начала" });
    }
  });

  const sorted = [...items].sort((a, b) => cmp(a.start, b.start) || cmp(a.end, b.end));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (overlaps(prev, cur)) {
      errors.push({ id: prev.id, field: "start_date", msg: "Пересечение с другим сезоном" });
      errors.push({ id: cur.id, field: "start_date", msg: "Пересечение с другим сезоном" });
    }
  }
  return errors;
}

function makeTmpId() {
  return `new-${Math.random().toString(36).slice(2, 9)}`;
}

function seasonMeta(label) {
  return SEASON_BY_VALUE[label || "low"] || SEASON_BY_VALUE.low;
}

function buildTemplateRows(kind) {
  const year = new Date().getFullYear();
  const y = year;
  if (kind === "uzbekistan") {
    return [
      { id: makeTmpId(), label: "low", start_date: `${y}-01-10`, end_date: `${y}-03-14` },
      { id: makeTmpId(), label: "high", start_date: `${y}-03-15`, end_date: `${y}-05-31` },
      { id: makeTmpId(), label: "shoulder", start_date: `${y}-06-01`, end_date: `${y}-08-31` },
      { id: makeTmpId(), label: "high", start_date: `${y}-09-01`, end_date: `${y}-11-15` },
      { id: makeTmpId(), label: "low", start_date: `${y}-11-16`, end_date: `${y + 1}-01-09` },
    ];
  }
  if (kind === "summer") {
    return [
      { id: makeTmpId(), label: "low", start_date: `${y}-01-10`, end_date: `${y}-04-30` },
      { id: makeTmpId(), label: "shoulder", start_date: `${y}-05-01`, end_date: `${y}-05-31` },
      { id: makeTmpId(), label: "peak", start_date: `${y}-06-01`, end_date: `${y}-08-31` },
      { id: makeTmpId(), label: "shoulder", start_date: `${y}-09-01`, end_date: `${y}-09-30` },
      { id: makeTmpId(), label: "low", start_date: `${y}-10-01`, end_date: `${y + 1}-01-09` },
    ];
  }
  return [
    { id: makeTmpId(), label: "low", start_date: `${y}-01-01`, end_date: `${y}-12-31` },
  ];
}

/* -------------------- page -------------------- */
export default function AdminHotelSeasons() {
  const { id: hotelId } = useParams();
  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [serverMsg, setServerMsg] = useState("");
  const [filter, setFilter] = useState("all");

  async function loadAll() {
    setLoading(true);
    setServerMsg("");
    try {
      const [h, s] = await Promise.all([
        api.get(`/api/hotels/${hotelId}/brief`).then((r) => r.data),
        api.get(`/api/hotels/${hotelId}/seasons`).then((r) => r.data),
      ]);
      setHotel(h);
      setRows(
        (Array.isArray(s) ? s : []).map((x) => ({
          id: x.id,
          label: x.label || "low",
          start_date: iso(x.start_date),
          end_date: iso(x.end_date),
        }))
      );
    } catch (e) {
      setServerMsg("Не удалось загрузить данные");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const errors = useMemo(() => validateSeasons(rows), [rows]);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => cmp(iso(a.start_date), iso(b.start_date)) || cmp(iso(a.end_date), iso(b.end_date))),
    [rows]
  );
  const visibleRows = useMemo(
    () => (filter === "all" ? sortedRows : sortedRows.filter((r) => (r.label || "low") === filter)),
    [filter, sortedRows]
  );

  const stats = useMemo(() => {
    const byLabel = SEASON_OPTIONS.reduce((acc, s) => {
      acc[s.value] = 0;
      return acc;
    }, {});
    let totalDays = 0;
    rows.forEach((r) => {
      const key = r.label || "low";
      byLabel[key] = (byLabel[key] || 0) + 1;
      const count = daysCount(r.start_date, r.end_date);
      if (count) totalDays += count;
    });
    return { byLabel, totalDays };
  }, [rows]);

  const mark = (id, field) => errors.some((e) => e.id === id && e.field === field);
  const errTextFor = (id) => {
    const uniq = new Set(errors.filter((e) => e.id === id).map((e) => e.msg));
    return Array.from(uniq).join("; ");
  };

  const patchRow = (id, patch) => {
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const addRow = () => {
    const last = sortedRows[sortedRows.length - 1];
    let startDate = "";
    if (last?.end_date) {
      const parsed = parseIsoDate(last.end_date);
      if (parsed) {
        const next = addDays(parsed, 1);
        startDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      }
    }
    setRows((r) => [
      ...r,
      {
        id: makeTmpId(),
        label: filter !== "all" ? filter : "low",
        start_date: startDate,
        end_date: "",
      },
    ]);
  };

  const applyTemplate = (kind) => {
    const label = kind === "uzbekistan" ? "типовой календарь Узбекистана" : kind === "summer" ? "летний курорт" : "один сезон на год";
    if (!confirm(`Добавить шаблон «${label}» к текущему списку?`)) return;
    setRows((current) => [...current, ...buildTemplateRows(kind)]);
    setServerMsg("Шаблон добавлен. Проверьте даты и нажмите «Заменить все текущим списком» или сохраните строки по отдельности.");
  };

  const removeRow = async (row) => {
    if (!confirm("Удалить сезон?")) return;
    if (String(row.id).startsWith("new-")) {
      setRows((rs) => rs.filter((x) => x.id !== row.id));
      return;
    }
    try {
      setSaving(true);
      await api.delete(`/api/hotels/${hotelId}/seasons/${row.id}`);
      setRows((rs) => rs.filter((x) => x.id !== row.id));
      setServerMsg("Удалено ✅");
    } catch (e) {
      console.error(e);
      alert("Не удалось удалить");
    } finally {
      setSaving(false);
    }
  };

  const saveRow = async (row) => {
    setServerMsg("");
    const s = iso(row.start_date);
    const e = iso(row.end_date);
    if (!s || !e || s > e) {
      setServerMsg("Заполните корректно даты");
      return;
    }
    const tmp = rows.map((r) => (r.id === row.id ? { ...row, start_date: s, end_date: e } : r));
    const errs = validateSeasons(tmp);
    if (errs.length) {
      setServerMsg("Исправьте пересечения интервалов");
      return;
    }

    try {
      setSaving(true);
      if (String(row.id).startsWith("new-")) {
        const { data: created } = await api.post(`/api/hotels/${hotelId}/seasons`, {
          label: row.label,
          start_date: s,
          end_date: e,
        });
        setRows((rs) =>
          rs.map((x) =>
            x.id === row.id
              ? {
                  id: created.id,
                  label: created.label || row.label,
                  start_date: iso(created.start_date),
                  end_date: iso(created.end_date),
                }
              : x
          )
        );
      } else {
        const { data: updated } = await api.put(`/api/hotels/${hotelId}/seasons/${row.id}`, {
          label: row.label,
          start_date: s,
          end_date: e,
        });
        setRows((rs) =>
          rs.map((x) =>
            x.id === row.id
              ? {
                  id: updated.id,
                  label: updated.label || row.label,
                  start_date: iso(updated.start_date),
                  end_date: iso(updated.end_date),
                }
              : x
          )
        );
      }
      setServerMsg("Сохранено ✅");
    } catch (e) {
      console.error(e);
      const code = e?.response?.data?.error || "save_failed";
      if (code === "overlap" || code === "overlap_in_payload") setServerMsg("На сервере обнаружено пересечение интервалов");
      else if (code === "bad_dates" || code === "start_after_end") setServerMsg("Проверь даты");
      else if (e?.response?.status === 401) setServerMsg("Нужна авторизация (войдите заново)");
      else setServerMsg("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const bulkReplace = async () => {
    if (!confirm("Полностью заменить сезоны текущим списком?")) return;
    const errs = validateSeasons(rows);
    if (errs.length) {
      setServerMsg("Исправьте ошибки перед заменой");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        items: sortedRows.map((r) => ({
          label: r.label || "low",
          start_date: iso(r.start_date),
          end_date: iso(r.end_date),
        })),
      };
      const { data } = await api.put(`/api/hotels/${hotelId}/seasons/bulk`, payload);
      const items = data?.items || [];
      setRows(items.map((x) => ({ id: x.id, label: x.label || "low", start_date: iso(x.start_date), end_date: iso(x.end_date) })));
      setServerMsg("Заменено ✅");
    } catch (e) {
      console.error(e);
      const code = e?.response?.data?.error || "bulk_failed";
      if (code === "overlap_in_payload") setServerMsg("Пересечения в отправленном наборе");
      else if (e?.response?.status === 401) setServerMsg("Нужна авторизация (войдите заново)");
      else setServerMsg("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-6 w-44 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-5 text-white md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/15">
                  Travella hotels
                </div>
                <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] md:text-3xl">Сезоны отеля</h1>
                <div className="mt-1 text-sm font-medium text-slate-200">
                  {hotel ? (
                    <>
                      <span className="font-bold text-white">{hotel.name}</span>
                      {hotel.city ? <span className="text-slate-300"> · {hotel.city}</span> : null}
                    </>
                  ) : (
                    "Отель"
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="inline-flex h-10 items-center rounded-2xl bg-white px-4 text-sm font-black text-slate-900 shadow-sm transition hover:bg-orange-50"
                  to={`/admin/hotels/${hotelId}/edit`}
                >
                  ← Карточка отеля
                </Link>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={saving}
                  className="inline-flex h-10 items-center rounded-2xl bg-orange-500 px-4 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
                >
                  + Добавить сезон
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-4 md:p-5">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Всего сезонов</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{rows.length}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Покрыто дней</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{stats.totalDays}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Ошибки</div>
              <div className={`mt-1 text-2xl font-black ${errors.length ? "text-rose-600" : "text-emerald-600"}`}>{errors.length}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Фильтр</div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
              >
                <option value="all">Все сезоны</option>
                {SEASON_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {serverMsg && (
            <div className="px-4 pt-4 md:px-5">
              <div
                className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
                  /✅/.test(serverMsg)
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {serverMsg}
              </div>
            </div>
          )}

          <div className="grid gap-3 p-4 md:grid-cols-3 md:p-5">
            <button
              type="button"
              onClick={() => applyTemplate("uzbekistan")}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:bg-orange-50/40"
            >
              <div className="text-sm font-black text-slate-950">Типовой Узбекистан</div>
              <div className="mt-1 text-xs font-medium leading-5 text-slate-500">Низкий → высокий → средний → высокий → низкий.</div>
            </button>
            <button
              type="button"
              onClick={() => applyTemplate("summer")}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:bg-orange-50/40"
            >
              <div className="text-sm font-black text-slate-950">Летний курорт</div>
              <div className="mt-1 text-xs font-medium leading-5 text-slate-500">Пик спроса летом, плечевые сезоны весной/осенью.</div>
            </button>
            <button
              type="button"
              onClick={() => applyTemplate("single")}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:bg-orange-50/40"
            >
              <div className="text-sm font-black text-slate-950">Один сезон на год</div>
              <div className="mt-1 text-xs font-medium leading-5 text-slate-500">Быстрый вариант, если сезонность пока не нужна.</div>
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Календарь сезонов</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Даты не должны пересекаться. Переход через Новый год указывайте датой окончания в следующем году.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SEASON_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setFilter(filter === s.value ? "all" : s.value)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ring-1 transition ${s.badge} ${filter === s.value ? "scale-[1.02] shadow-sm" : "opacity-80 hover:opacity-100"}`}
                >
                  {s.label} <span className="rounded-full bg-white/70 px-1.5 py-0.5">{stats.byLabel[s.value] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {visibleRows.map((r) => {
              const meta = seasonMeta(r.label);
              const count = daysCount(r.start_date, r.end_date);
              const rowErrors = errTextFor(r.id);
              const isNew = String(r.id).startsWith("new-");

              return (
                <div
                  key={r.id}
                  className={`rounded-3xl border bg-white p-4 shadow-sm transition ${
                    rowErrors ? "border-rose-200 ring-4 ring-rose-50" : "border-slate-200 hover:border-orange-200"
                  }`}
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(420px,1.4fr)_auto] lg:items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${meta.badge}`}>{meta.label}</span>
                        {isNew && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-100">новый</span>}
                      </div>
                      <select
                        className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                        value={r.label || "low"}
                        onChange={(e) => patchRow(r.id, { label: e.target.value })}
                      >
                        {SEASON_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>{item.label} — {item.hint}</option>
                        ))}
                      </select>
                      <div className="mt-2 text-xs font-medium text-slate-500">Технический тег: <span className="font-black text-slate-700">{r.label || "low"}</span></div>
                    </div>

                    <div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Начало</span>
                          <input
                            type="date"
                            className={`h-11 w-full rounded-2xl border bg-white px-3 text-sm font-bold outline-none transition focus:ring-4 ${
                              mark(r.id, "start_date") ? "border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-orange-400 focus:ring-orange-100"
                            }`}
                            value={r.start_date || ""}
                            onChange={(e) => patchRow(r.id, { start_date: e.target.value })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Конец</span>
                          <input
                            type="date"
                            className={`h-11 w-full rounded-2xl border bg-white px-3 text-sm font-bold outline-none transition focus:ring-4 ${
                              mark(r.id, "end_date") ? "border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-orange-400 focus:ring-orange-100"
                            }`}
                            value={r.end_date || ""}
                            onChange={(e) => patchRow(r.id, { end_date: e.target.value })}
                          />
                        </label>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                        <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-100">{formatRuDate(r.start_date)} → {formatRuDate(r.end_date)}</span>
                        <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-100">{count ? `${count} дн.` : "дни не рассчитаны"}</span>
                        {rowErrors ? <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700 ring-1 ring-rose-100">{rowErrors}</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        className="h-10 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                        disabled={saving}
                        onClick={() => saveRow(r)}
                      >
                        Сохранить
                      </button>
                      <button
                        className="h-10 rounded-2xl border border-rose-200 bg-white px-4 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                        disabled={saving}
                        onClick={() => removeRow(r)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!visibleRows.length && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="text-base font-black text-slate-800">Сезонов пока нет</div>
                <p className="mt-1 text-sm font-medium text-slate-500">Добавьте сезон вручную или используйте быстрый шаблон.</p>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={saving}
                  className="mt-4 inline-flex h-10 items-center rounded-2xl bg-orange-500 px-4 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
                >
                  + Добавить сезон
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-4 z-10 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-bold text-slate-600">
              {errors.length > 0 ? (
                <span className="text-rose-600">Есть ошибки: {errors.length}. Исправьте даты или пересечения перед массовым сохранением.</span>
              ) : (
                <span className="text-emerald-700">Ошибок не найдено. Можно сохранить весь список.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50" onClick={addRow} disabled={saving}>
                + Добавить
              </button>
              <button
                className="h-10 rounded-2xl bg-orange-500 px-4 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={bulkReplace}
                disabled={saving || errors.length > 0}
                title={errors.length ? "Исправьте ошибки перед заменой" : ""}
              >
                {saving ? "Сохраняю…" : "Заменить все текущим списком"}
              </button>
            </div>
          </div>
        </div>

        <p className="px-1 text-xs font-medium leading-5 text-slate-500">
          Подсказка: если сезон переходит на следующий год, укажите дату конца в следующем году, например 16.11.2025 → 15.03.2026.
        </p>
      </div>
    </div>
  );
}
