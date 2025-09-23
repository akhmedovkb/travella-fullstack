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
  // добавляем токен из любого из возможных хранилищ
  const t =
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("clientToken");
  if (t && !cfg.headers.Authorization) {
    cfg.headers.Authorization = `Bearer ${t}`;
  }
  return cfg;
});

/* -------------------- utils -------------------- */
// нормализация в YYYY-MM-DD для <input type="date">
const iso = (d) => {
  if (!d) return "";
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  const s = String(d);
  // уже YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO со временем
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  // вдруг пришло только «YYYY-MM-DD …»
  const first10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(first10)) return first10;
  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const overlaps = (a, b) => !(a.end < b.start || b.end < a.start); // пересечение включительно

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

  // пустые / перепутанные даты
  rows.forEach((r) => {
    const s = iso(r.start_date);
    const e = iso(r.end_date);
    if (!s) errors.push({ id: r.id, field: "start_date", msg: "Обязательное поле" });
    if (!e) errors.push({ id: r.id, field: "end_date", msg: "Обязательное поле" });
    if (s && e && s > e) {
      errors.push({ id: r.id, field: "start_date", msg: "Начало позже конца" });
      errors.push({ id: r.id, field: "end_date", msg: "Конец раньше начала" });
    }
  });

  // пересечения (сортируем, проверяем соседей)
  const sorted = [...items].sort((a, b) => cmp(a.start, b.start) || cmp(a.end, b.end));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (overlaps(prev, cur)) {
      errors.push({ id: prev.id, field: "start_date", msg: "Пересечение с соседним интервалом" });
      errors.push({ id: cur.id, field: "start_date", msg: "Пересечение с соседним интервалом" });
    }
  }
  return errors;
}

/* -------------------- page -------------------- */
export default function AdminHotelSeasons() {
  const { id: hotelId } = useParams();
  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState(null);
  const [rows, setRows] = useState([]); // [{id,label,start_date,end_date}]
  const [saving, setSaving] = useState(false);
  const [serverMsg, setServerMsg] = useState("");

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
  const mark = (id, field) => errors.some((e) => e.id === id && e.field === field);
  const errTextFor = (id) => {
    const uniq = new Set(errors.filter((e) => e.id === id).map((e) => e.msg));
    return Array.from(uniq).join("; ");
  };

  const addRow = () => {
    const tmpId = "new-" + Math.random().toString(36).slice(2, 7);
    setRows((r) => [
      ...r,
      {
        id: tmpId,
        label: "low",
        start_date: "",
        end_date: "",
      },
    ]);
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
    // локальная валидация строки
    const s = iso(row.start_date);
    const e = iso(row.end_date);
    if (!s || !e || s > e) {
      setServerMsg("Заполните корректно даты");
      return;
    }
    // проверка на пересечения со всем списком (с учётом текущего)
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
      if (code === "overlap" || code === "overlap_in_payload")
        setServerMsg("На сервере обнаружено пересечение интервалов");
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
        items: rows.map((r) => ({
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

  if (loading) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>;

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Сезоны отеля</h1>
          <div className="text-sm text-gray-600">
            {hotel ? (
              <>
                <span className="font-medium">{hotel.name}</span>
                {hotel.city ? <> • {hotel.city}</> : null}
              </>
            ) : (
              "Отель"
            )}
          </div>
        </div>
        <Link className="text-blue-600 hover:underline text-sm" to={`/admin/hotels/${hotelId}/edit`}>
          ← карточка отеля
        </Link>
      </div>

      {serverMsg && (
        <div
          className={`mb-3 text-sm px-3 py-2 rounded border ${
            /✅/.test(serverMsg) ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"
          }`}
        >
          {serverMsg}
        </div>
      )}

      <div className="rounded border overflow-hidden">
        {/* шапка — даём больше места, чтобы ничего не «ехало» */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_170px_170px_minmax(220px,auto)] gap-2 md:gap-3 bg-gray-50 px-3 py-2 text-sm font-medium">
          <div>Тег сезона</div>
          <div>Начало</div>
          <div>Конец</div>
          <div className="md:text-right">Действия</div>
        </div>

        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_170px_170px_minmax(220px,auto)] gap-2 md:gap-3 items-center px-3 py-2 border-t text-sm"
          >
            <div>
              <select
                className="border rounded h-9 px-2 w-full"
                value={r.label || "low"}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))}
              >
                <option value="low">low</option>
                <option value="high">high</option>
                <option value="shoulder">shoulder</option>
                <option value="peak">peak</option>
                <option value="other">other</option>
              </select>
            </div>

            <div>
              <input
                type="date"
                className={`border rounded h-9 px-2 w-full ${mark(r.id, "start_date") ? "border-red-500" : ""}`}
                value={r.start_date || ""}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, start_date: e.target.value } : x)))}
              />
            </div>

            <div>
              <input
                type="date"
                className={`border rounded h-9 px-2 w-full ${mark(r.id, "end_date") ? "border-red-500" : ""}`}
                value={r.end_date || ""}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, end_date: e.target.value } : x)))}
              />
            </div>

            <div className="flex flex-wrap md:justify-end items-center gap-2">
              {errors.some((e) => e.id === r.id) && (
                <span title={errTextFor(r.id)} className="text-xs text-red-600 mr-1">
                  есть ошибки
                </span>
              )}
              <button
                className="h-9 px-3 border rounded hover:bg-gray-50 disabled:opacity-50"
                disabled={saving}
                onClick={() => saveRow(r)}
              >
                Сохранить
              </button>
              <button
                className="h-9 px-3 border rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
                disabled={saving}
                onClick={() => removeRow(r)}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}

        {!rows.length && <div className="px-3 py-6 text-sm text-gray-500 border-t">Сезонов пока нет</div>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="h-9 px-3 border rounded hover:bg-gray-50" onClick={addRow} disabled={saving}>
          + Добавить сезон
        </button>
        <button
          className="h-9 px-3 border rounded hover:bg-gray-50 disabled:opacity-50"
          onClick={bulkReplace}
          disabled={saving || errors.length > 0}
          title={errors.length ? "Исправьте ошибки перед заменой" : ""}
        >
          Заменить все текущим списком
        </button>
      </div>

      {errors.length > 0 && (
        <div className="mt-3 p-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded">
          Обнаружены ошибки: {errors.length}. Проверьте даты и пересечения.
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Подсказка: если сезон переходит на следующий год, укажите дату конца в следующем году (например, 2025-11-16 → 2026-03-15).
      </p>
    </div>
  );
}
