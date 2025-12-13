import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listLeads,
  updateLeadStatus as apiUpdateStatus,
  listLeadPages,
  decideLead as apiDecideLead,
} from "../../api/leads";

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
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const status = params.get("status") || "";
  const lang = params.get("lang") || "";
  const page = params.get("page") || "";
  const q = params.get("q") || "";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((r) => {
      if (!needle) return true;
      const u = r.utm || {};
      const hay = [
        r.name,
        r.phone,
        r.city,
        r.comment,
        r.page,
        r.lang,
        r.status,
        r.service,
        r.source,
        r.requested_role,
        u.source,
        u.medium,
        u.campaign,
        u.content,
        u.term,
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
      const data = await listLeads({ status, lang, page });
      setItems(data.items || []);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function fetchPages() {
    try {
      const data = await listLeadPages();
      setPages(data.items || []);
    } catch {}
  }

  async function updateStatus(id, newStatus) {
    const prev = items.slice();
    setItems((arr) =>
      arr.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
    );
    try {
      await apiUpdateStatus(id, newStatus);
    } catch (e) {
      setItems(prev);
      alert("Не удалось обновить статус");
    }
  }

  async function decide(id, decision) {
    if (!window.confirm("Подтвердить действие?")) return;

    const prev = items.slice();
    setItems((arr) =>
      arr.map((r) =>
        r.id === id
          ? { ...r, decision, status: "closed" }
          : r
      )
    );

    try {
      await apiDecideLead(id, decision);
    } catch (e) {
      setItems(prev);
      alert("Ошибка принятия решения");
    }
  }

  useEffect(() => {
    fetchLeads();
  }, [status, lang, page]);

  useEffect(() => {
    fetchPages();
  }, []);

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

        <select
          value={page}
          onChange={(e) => onChangeParam("page", e.target.value)}
          className="border rounded px-3 py-2 min-w-[240px]"
        >
          <option value="">— любая страница —</option>
          {pages.map((p) => (
            <option key={p.page} value={p.page}>
              {p.page} ({p.cnt})
            </option>
          ))}
        </select>

        <input
          value={q}
          onChange={(e) => onChangeParam("q", e.target.value)}
          placeholder="Поиск"
          className="border rounded px-3 py-2 min-w-[260px]"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1300px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Дата</th>
              <th className="py-2 pr-4">Имя</th>
              <th className="py-2 pr-4">Телефон</th>
              <th className="py-2 pr-4">Источник</th>
              <th className="py-2 pr-4">Роль</th>
              <th className="py-2 pr-4">Статус</th>
              <th className="py-2 pr-4">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isTelegram = !!r.telegram_chat_id;
              const undecided = !r.decision;

              return (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-4">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{r.name || "—"}</td>
                  <td className="py-2 pr-4">{r.phone || "—"}</td>
                  <td className="py-2 pr-4">{r.source || "—"}</td>
                  <td className="py-2 pr-4">
                    {r.requested_role || "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={r.status || "new"}
                      onChange={(e) =>
                        updateStatus(r.id, e.target.value)
                      }
                      className="border rounded px-2 py-1"
                    >
                      {STATUSES.slice(1).map((o) => (
                        <option key={o.val} value={o.val}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="py-2 pr-4">
                    {isTelegram && undecided ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            decide(r.id, "approved_provider")
                          }
                          className="px-3 py-1 rounded bg-green-600 text-white"
                        >
                          Принять как поставщика
                        </button>
                        <button
                          onClick={() =>
                            decide(r.id, "approved_client")
                          }
                          className="px-3 py-1 rounded bg-blue-600 text-white"
                        >
                          Принять как клиента
                        </button>
                        <button
                          onClick={() => decide(r.id, "rejected")}
                          className="px-3 py-1 rounded bg-red-600 text-white"
                        >
                          Отклонить
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
