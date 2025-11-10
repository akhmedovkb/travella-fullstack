import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listLeads, updateLeadStatus as apiUpdateStatus } from "../../api/leads";

// Базовый URL бэкенда берем из .env (VITE_API_BASE_URL) или из window.frontend.API_BASE,
// который мы уже вставляем в index.html на проде
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "") ||
  ((typeof window !== "undefined" &&
    window.frontend &&
    window.frontend.API_BASE &&
    String(window.frontend.API_BASE).replace(/\/+$/, "")) ||
    "");

const STATUSES = [
  { val: "", label: "— все статусы —" },
  { val: "new", label: "new" },
  { val: "working", label: "working" },
  { val: "closed", label: "closed" },
];
const LANGS = [
  { val: "", label: "— любой —" },
  { val: "ru", label: "ru" },
  { val: "uz", label: "uz" },
  { val: "en", label: "en" },
];

export default function AdminLeads() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const status = params.get("status") || "";
  const lang = params.get("lang") || "";
  const q = params.get("q") || "";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((r) => {
      if (!needle) return true;
      const hay =
        [
          r.name,
          r.phone,
          r.city,
          r.comment,
          r.page,
          r.lang,
          r.status,
          new Date(r.created_at).toLocaleString(),
        ]
          .join(" ")
          .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  async function fetchLeads() {
    try {
      setLoading(true);
      setErr("");
    const data = await listLeads({ status, lang });
    setItems(data.items || []);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id, newStatus) {
    const prev = items.slice();
    setItems((arr) =>
      arr.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
    );
    try {
      await apiUpdateStatus(id, newStatus);
    } catch (e) {
      // откат UI, если не получилось
      setItems(prev);
      alert("Не удалось обновить статус: " + (e.message || ""));
    }
  }

  useEffect(() => {
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lang]);

  const onChangeParam = (key, val) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Leads</h1>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          value={status}
          onChange={(e) => onChangeParam("status", e.target.value)}
          className="border rounded px-3 py-2"
        >
          {STATUSES.map((o) => (
            <option key={o.val} value={o.val}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={lang}
          onChange={(e) => onChangeParam("lang", e.target.value)}
          className="border rounded px-3 py-2"
        >
          {LANGS.map((o) => (
            <option key={o.val} value={o.val}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          value={q}
          onChange={(e) => onChangeParam("q", e.target.value)}
          placeholder="Поиск (имя/телефон/коммент/страница)"
          className="border rounded px-3 py-2 min-w-[260px] flex-1"
        />

        <button
          onClick={fetchLeads}
          className="px-4 py-2 rounded bg-gray-800 text-white"
        >
          Обновить
        </button>

        {loading && <span className="text-sm text-gray-500">Загрузка…</span>}
        {err && <span className="text-sm text-red-600">Ошибка: {err}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Дата</th>
              <th className="py-2 pr-4">Имя</th>
              <th className="py-2 pr-4">Телефон</th>
              <th className="py-2 pr-4">Город/даты</th>
              <th className="py-2 pr-4">Кол-во</th>
              <th className="py-2 pr-4">Комментарий</th>
              <th className="py-2 pr-4">Страница</th>
              <th className="py-2 pr-4">Яз.</th>
              <th className="py-2 pr-4">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 pr-4 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="py-2 pr-4">{r.name || "—"}</td>
                <td className="py-2 pr-4">{r.phone || "—"}</td>
                <td className="py-2 pr-4">{r.city || "—"}</td>
                <td className="py-2 pr-4">{r.pax ?? "—"}</td>
                <td className="py-2 pr-4 max-w-[360px]">
                  <div className="whitespace-pre-wrap break-words">
                    {r.comment || "—"}
                  </div>
                </td>
                <td className="py-2 pr-4">{r.page || "—"}</td>
                <td className="py-2 pr-4">{r.lang || "—"}</td>
                <td className="py-2 pr-4">
                  <select
                    value={r.status || "new"}
                    onChange={(e) => updateStatus(r.id, e.target.value)}
                    className="border rounded px-2 py-1"
                  >
                    {STATUSES.slice(1).map((o) => (
                      <option key={o.val} value={o.val}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {!loading && !filtered.length && (
              <tr>
                <td className="py-6 text-gray-500" colSpan={9}>
                  Ничего не найдено.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}


