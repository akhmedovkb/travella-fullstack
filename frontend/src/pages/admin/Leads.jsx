// frontend/src/pages/admin/Leads.jsx
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

function isTelegramLead(r) {
  const src = String(r?.source || "").toLowerCase();
  return src.startsWith("telegram") || !!r?.telegram_chat_id || !!r?.requested_role;
}

function roleLabel(r) {
  const rr = String(r?.requested_role || "").toLowerCase();
  if (rr === "provider") return "provider";
  if (rr === "client") return "client";
  return "—";
}

function decisionLabel(r) {
  const d = String(r?.decision || "").toLowerCase();
  if (!d) return "—";
  if (d === "approved_client") return "✅ client";
  if (d === "approved_provider") return "✅ provider";
  if (d === "rejected") return "❌ rejected";
  return d;
}

export default function AdminLeads() {
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // точечный лоадер для кнопок по строке
  const [busyId, setBusyId] = useState(null);

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
        r.telegram_username,
        r.telegram_chat_id,
        r.requested_role,
        r.decision,
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
    } catch {
      /* no-op */
    }
  }

  async function updateStatus(id, newStatus) {
    const prev = items.slice();
    setItems((arr) => arr.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    try {
      await apiUpdateStatus(id, newStatus);
    } catch (e) {
      setItems(prev);
      alert("Не удалось обновить статус: " + (e.message || ""));
    }
  }

  async function decideLead(id, decision) {
    const prev = items.slice();
    setBusyId(id);

    // оптимистично обновим UI
    setItems((arr) =>
      arr.map((r) =>
        r.id === id
          ? {
              ...r,
              decision,
              decided_at: new Date().toISOString(),
              // по желанию: можно автоматом закрывать лид
              // status: r.status === "closed" ? r.status : "closed",
            }
          : r
      )
    );

    try {
      await apiDecideLead(id, decision);
      // после решения лучше перечитать с бэка (чтобы подтянуть created user id и т.п.)
      await fetchLeads();
    } catch (e) {
      setItems(prev);
      alert("Не удалось принять решение: " + (e.message || ""));
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lang, page]);

  useEffect(() => {
    fetchPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeParam = (key, val) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  function exportCSV() {
    const header = [
      "Дата",
      "Имя",
      "Телефон",
      "Город/даты",
      "Кол-во",
      "Комментарий",
      "Страница",
      "Язык",
      "Сервис",
      "Source",
      "TG chat id",
      "TG username",
      "Requested role",
      "Decision",
      "UTM source",
      "UTM medium",
      "UTM campaign",
      "UTM content",
      "UTM term",
      "Ответственный",
      "Статус",
    ];
    const rows = filtered.map((r) => {
      const u = r.utm || {};
      return [
        new Date(r.created_at).toLocaleString().replace(",", ""),
        r.name || "",
        r.phone || "",
        r.city || "",
        r.pax ?? "",
        (r.comment || "").replace(/\r?\n/g, " "),
        r.page || "",
        r.lang || "",
        r.service || "",
        r.source || "",
        r.telegram_chat_id ?? "",
        r.telegram_username || "",
        r.requested_role || "",
        r.decision || "",
        u.source || "",
        u.medium || "",
        u.campaign || "",
        u.content || "",
        u.term || "",
        r.assignee_name || "",
        r.status || "",
      ];
    });
    const csv = [header, ...rows]
      .map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          title="Страница"
        >
          <option value="">{`— любая страница —`}</option>
          {pages
            .filter((p) => p.page)
            .map((p) => (
              <option key={p.page} value={p.page}>
                {p.page} {p.cnt ? `(${p.cnt})` : ""}
              </option>
            ))}
        </select>

        <input
          value={q}
          onChange={(e) => onChangeParam("q", e.target.value)}
          placeholder="Поиск (имя/телефон/коммент/страница/UTM)"
          className="border rounded px-3 py-2 min-w-[260px] flex-1"
        />

        <button onClick={fetchLeads} className="px-4 py-2 rounded bg-gray-800 text-white">
          Обновить
        </button>
        <button onClick={exportCSV} className="px-4 py-2 rounded border" title="Скачать CSV текущей выборки">
          CSV
        </button>

        {loading && <span className="text-sm text-gray-500">Загрузка…</span>}
        {err && <span className="text-sm text-red-600">Ошибка: {err}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1500px] text-sm">
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
              <th className="py-2 pr-4">Сервис</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">TG</th>
              <th className="py-2 pr-4">Роль / Решение</th>
              <th className="py-2 pr-4">Действия</th>
              <th className="py-2 pr-4">UTM source</th>
              <th className="py-2 pr-4">UTM medium</th>
              <th className="py-2 pr-4">UTM campaign</th>
              <th className="py-2 pr-4">UTM content</th>
              <th className="py-2 pr-4">UTM term</th>
              <th className="py-2 pr-4">Ответственный</th>
              <th className="py-2 pr-4">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const u = r.utm || {};
              const tg = isTelegramLead(r);
              const decided = !!r.decision;

              return (
                <tr key={r.id} className="border-b align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4">{r.name || "—"}</td>
                  <td className="py-2 pr-4">{r.phone || "—"}</td>
                  <td className="py-2 pr-4">{r.city || "—"}</td>
                  <td className="py-2 pr-4">{r.pax ?? "—"}</td>
                  <td className="py-2 pr-4 max-w-[360px]">
                    <div className="whitespace-pre-wrap break-words">{r.comment || "—"}</div>
                  </td>
                  <td className="py-2 pr-4">{r.page || "—"}</td>
                  <td className="py-2 pr-4">{r.lang || "—"}</td>
                  <td className="py-2 pr-4">{r.service || "—"}</td>

                  <td className="py-2 pr-4">{r.source || "—"}</td>

                  <td className="py-2 pr-4">
                    {r.telegram_chat_id ? (
                      <div className="text-xs">
                        <div className="font-medium">chat: {r.telegram_chat_id}</div>
                        <div className="text-gray-600">{r.telegram_username ? `@${String(r.telegram_username).replace(/^@/, "")}` : "—"}</div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td className="py-2 pr-4">
                    <div className="text-xs">
                      <div>requested: <span className="font-medium">{roleLabel(r)}</span></div>
                      <div>decision: <span className="font-medium">{decisionLabel(r)}</span></div>
                    </div>
                  </td>

                  <td className="py-2 pr-4">
                    {!tg && <span className="text-gray-400">—</span>}

                    {tg && (
                      <div className="flex flex-col gap-2 min-w-[190px]">
                        <button
                          disabled={busyId === r.id}
                          onClick={() => decideLead(r.id, "approved_client")}
                          className="px-3 py-2 rounded border hover:bg-gray-50 disabled:opacity-60"
                          title="Создать/привязать клиента и уведомить в Telegram"
                        >
                          ✅ В клиенты
                        </button>

                        <button
                          disabled={busyId === r.id}
                          onClick={() => decideLead(r.id, "approved_provider")}
                          className="px-3 py-2 rounded border hover:bg-gray-50 disabled:opacity-60"
                          title="Создать/привязать провайдера и уведомить в Telegram"
                        >
                          ✅ В провайдеры
                        </button>

                        <button
                          disabled={busyId === r.id}
                          onClick={() => decideLead(r.id, "rejected")}
                          className="px-3 py-2 rounded border text-red-700 hover:bg-red-50 disabled:opacity-60"
                          title="Отклонить и уведомить в Telegram"
                        >
                          ❌ Отклонить
                        </button>

                        {decided && (
                          <div className="text-xs text-gray-500">
                            {r.decided_at ? `решено: ${new Date(r.decided_at).toLocaleString()}` : "решено"}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="py-2 pr-4">{u.source || "—"}</td>
                  <td className="py-2 pr-4">{u.medium || "—"}</td>
                  <td className="py-2 pr-4">{u.campaign || "—"}</td>
                  <td className="py-2 pr-4">{u.content || "—"}</td>
                  <td className="py-2 pr-4">{u.term || "—"}</td>

                  <td className="py-2 pr-4">{r.assignee_name || "—"}</td>

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
              );
            })}

            {!loading && !filtered.length && (
              <tr>
                <td className="py-6 text-gray-500" colSpan={20}>
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
