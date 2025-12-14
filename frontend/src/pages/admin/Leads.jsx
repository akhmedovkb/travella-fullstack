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

function clsx(...a) {
  return a.filter(Boolean).join(" ");
}

function Badge({ children, className = "" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        className
      )}
    >
      {children}
    </span>
  );
}

function SourceBadge({ source }) {
  const src = String(source || "").toLowerCase();

  if (src === "telegram_client") {
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">
        telegram_client
      </Badge>
    );
  }

  if (src === "telegram_provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        telegram_provider
      </Badge>
    );
  }

  if (src === "web" || src === "site" || src === "landing") {
    return (
      <Badge className="bg-gray-50 text-gray-700 border-gray-200">web</Badge>
    );
  }

  if (!src) {
    return <Badge className="bg-gray-50 text-gray-700 border-gray-200">—</Badge>;
  }

  return (
    <Badge className="bg-gray-50 text-gray-700 border-gray-200">{src}</Badge>
  );
}

function RoleBadge({ role }) {
  const rr = String(role || "").toLowerCase();

  if (rr === "client") {
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">client</Badge>
    );
  }

  if (rr === "agent" || rr === "provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        {rr === "provider" ? "agent" : rr}
      </Badge>
    );
  }

  if (!rr) {
    return <Badge className="bg-gray-50 text-gray-700 border-gray-200">—</Badge>;
  }

  return (
    <Badge className="bg-gray-50 text-gray-700 border-gray-200">{rr}</Badge>
  );
}

function DecisionBadge({ decision }) {
  const d = String(decision || "").toLowerCase();

  if (!d) {
    return (
      <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">
        pending
      </Badge>
    );
  }

  if (d === "approved_client") {
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">
        approved_client
      </Badge>
    );
  }

  if (d === "approved_provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        approved_provider
      </Badge>
    );
  }

  if (d === "rejected") {
    return (
      <Badge className="bg-red-50 text-red-700 border-red-200">rejected</Badge>
    );
  }

  return <Badge className="bg-gray-50 text-gray-700 border-gray-200">{d}</Badge>;
}

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
        r.decision,
        r.telegram_username,
        r.telegram_first_name,
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

  function getAutoDecision(r) {
    const rr = String(r.requested_role || "").trim().toLowerCase();
    const src = String(r.source || "").trim().toLowerCase();

    // Авто-логика:
    // - если requested_role=client ИЛИ source=telegram_client => approved_client
    // - иначе => approved_provider
    if (rr === "client" || src === "telegram_client") return "approved_client";
    return "approved_provider";
  }

  function autoLabel(decision) {
    return decision === "approved_client"
      ? "Принять (авто: клиент)"
      : "Принять (авто: поставщик)";
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Лиды</h1>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          value={status}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            next.set("status", e.target.value);
            setParams(next, { replace: true });
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
            const next = new URLSearchParams(params);
            next.set("lang", e.target.value);
            setParams(next, { replace: true });
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
            const next = new URLSearchParams(params);
            next.set("page", e.target.value);
            setParams(next, { replace: true });
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
            const next = new URLSearchParams(params);
            next.set("q", e.target.value);
            setParams(next, { replace: true });
          }}
          placeholder="Поиск"
          className="border rounded px-3 py-2 min-w-[260px]"
        />

        {loading ? <span className="text-gray-500">Загрузка…</span> : null}
        {err ? <span className="text-red-600">{err}</span> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1500px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Дата</th>
              <th className="py-2 pr-4">Имя</th>
              <th className="py-2 pr-4">Телефон</th>
              <th className="py-2 pr-4">Источник</th>
              <th className="py-2 pr-4">Роль</th>
              <th className="py-2 pr-4">Decision</th>
              <th className="py-2 pr-4">Статус</th>
              <th className="py-2 pr-4">Telegram</th>
              <th className="py-2 pr-4">Действия</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const isTelegramLead = !!r.telegram_chat_id;
              const undecided = !r.decision;
              const canAutoAccept = isTelegramLead && undecided;

              const auto = getAutoDecision(r);

              return (
                <tr key={r.id} className="border-b align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>

                  <td className="py-2 pr-4">
                    <div className="font-medium">{r.name || "—"}</div>
                    {r.comment ? (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {r.comment}
                      </div>
                    ) : null}
                  </td>

                  <td className="py-2 pr-4 whitespace-nowrap">{r.phone || "—"}</td>

                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <SourceBadge source={r.source} />
                      {r.page ? (
                        <Badge className="bg-gray-50 text-gray-700 border-gray-200">
                          {r.page}
                        </Badge>
                      ) : null}
                    </div>
                  </td>

                  <td className="py-2 pr-4">
                    <RoleBadge role={r.requested_role} />
                  </td>

                  <td className="py-2 pr-4">
                    <DecisionBadge decision={r.decision} />
                  </td>

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
                    {isTelegramLead ? (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-700">
                          chat_id:{" "}
                          <span className="font-mono">{String(r.telegram_chat_id)}</span>
                        </div>
                        {r.telegram_username ? (
                          <div className="text-xs text-gray-500">
                            @{r.telegram_username}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  <td className="py-2 pr-4">
                    {canAutoAccept ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => decide(r.id, auto)}
                          className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 whitespace-nowrap"
                          title="Выбирает approved_client или approved_provider автоматически"
                        >
                          {autoLabel(auto)}
                        </button>

                        <button
                          onClick={() => decide(r.id, "approved_client")}
                          className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800 hover:bg-gray-300 whitespace-nowrap"
                        >
                          Принять (клиент)
                        </button>

                        <button
                          onClick={() => decide(r.id, "approved_provider")}
                          className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800 hover:bg-gray-300 whitespace-nowrap"
                        >
                          Принять (поставщик)
                        </button>

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
