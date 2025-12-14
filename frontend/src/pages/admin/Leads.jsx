//frontend/src/pages/admin/Leads.jsx

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
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    fetchLeads();
    fetchPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lang, page]);

  async function updateStatus(id, nextStatus) {
    await apiUpdateStatus(id, nextStatus);
    await fetchLeads();
  }

  async function decide(id, decision) {
    await apiDecideLead(id, decision);
    await fetchLeads();
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Лиды</h1>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          value={status}
          onChange={(e) => {
            params.set("status", e.target.value);
            setParams(params, { replace: true });
          }}
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
          onChange={(e) => {
            params.set("lang", e.target.value);
            setParams(params, { replace: true });
          }}
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
          onChange={(e) => {
            params.set("page", e.target.value);
            setParams(params, { replace: true });
          }}
          className="border rounded px-3 py-2"
        >
          <option value="">— все страницы —</option>
          {(pages || []).map((p) => (
            <option key={p.page} value={p.page}>
              {p.page} ({p.cnt})
            </option>
          ))}
        </select>

        <input
          value={q}
          onChange={(e) => {
            params.set("q", e.target.value);
            setParams(params, { replace: true });
          }}
          placeholder="Поиск"
          className="border rounded px-3 py-2 min-w-[260px]"
        />

        {loading ? <span className="text-gray-500">Загрузка…</span> : null}
        {err ? <span className="text-red-600">{err}</span> : null}
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

              // Авто-подстановка решения для Telegram-лидов:
              // - если лид явно "client" (requested_role) или источник telegram_client => approved_client
              // - иначе => approved_provider
              const rr = String(r.requested_role || "").trim().toLowerCase();
              const src = String(r.source || "").trim().toLowerCase();
              const autoDecision =
                rr === "client" || src === "telegram_client"
                  ? "approved_client"
                  : "approved_provider";
              const autoLabel =
                autoDecision === "approved_client"
                  ? "Принять (клиент)"
                  : "Принять (поставщик)";

              return (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-4">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{r.name || "—"}</td>
                  <td className="py-2 pr-4">{r.phone || "—"}</td>
                  <td className="py-2 pr-4">{r.source || "—"}</td>
                  <td className="py-2 pr-4">{r.requested_role || "—"}</td>

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

                  <td className="py-2 pr-4">
                    {isTelegram && undecided ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => decide(r.id, autoDecision)}
                          className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 whitespace-nowrap"
                        >
                          {autoLabel}
                        </button>

                        {/* на всякий случай оставляем возможность вручную выбрать другой вариант */}
                        {autoDecision !== "approved_provider" ? (
                          <button
                            onClick={() => decide(r.id, "approved_provider")}
                            className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800 hover:bg-gray-300 whitespace-nowrap"
                          >
                            Принять (поставщик)
                          </button>
                        ) : (
                          <button
                            onClick={() => decide(r.id, "approved_client")}
                            className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800 hover:bg-gray-300 whitespace-nowrap"
                          >
                            Принять (клиент)
                          </button>
                        )}

                        <button
                          onClick={() => decide(r.id, "rejected")}
                          className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
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
