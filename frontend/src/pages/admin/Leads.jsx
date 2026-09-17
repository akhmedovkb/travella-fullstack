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
  { val: "new", label: "Новые" },
  { val: "working", label: "В работе" },
  { val: "closed", label: "Закрытые" },
];

const LANGS = [
  { val: "", label: "— любой —" },
  { val: "ru", label: "ru" },
  { val: "uz", label: "uz" },
  { val: "en", label: "en" },
];

const QUICK_FILTERS = [
  { val: "all", label: "Все" },
  { val: "new", label: "Новые" },
  { val: "providers", label: "Поставщики" },
  { val: "clients", label: "Клиенты" },
  { val: "duplicates", label: "Дубли" },
  { val: "unlinked", label: "Без связи" },
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

function StatCard({ label, value, hint, tone = "slate" }) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-950"
      : tone === "green"
      ? "border-green-200 bg-green-50 text-green-950"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-950"
      : "border-slate-200 bg-white text-slate-950";

  return (
    <div className={clsx("rounded-2xl border px-4 py-3 shadow-sm", toneClass)}>
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function SourceBadge({ source }) {
  const src = String(source || "").toLowerCase();

  if (src === "telegram_client") {
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">
        Telegram клиент
      </Badge>
    );
  }

  if (src === "telegram_provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        Telegram поставщик
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
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">Клиент</Badge>
    );
  }

  if (rr === "agent" || rr === "provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        Поставщик
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
        Нужно решить
      </Badge>
    );
  }

  if (d === "approved_client") {
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200">
        Клиент одобрен
      </Badge>
    );
  }

  if (d === "approved_provider") {
    return (
      <Badge className="bg-green-50 text-green-700 border-green-200">
        Поставщик одобрен
      </Badge>
    );
  }

  if (d === "rejected") {
    return (
      <Badge className="bg-red-50 text-red-700 border-red-200">Отклонён</Badge>
    );
  }

  return <Badge className="bg-gray-50 text-gray-700 border-gray-200">{d}</Badge>;
}

function LinkedEntityBadge({ kind, row }) {
  if (kind === "client" && row?.client_match_id) {
    return (
      <div className="space-y-1">
        <Badge className="bg-blue-50 text-blue-700 border-blue-200">
          Клиент #{row.client_match_id}
        </Badge>
        <div className="text-xs text-gray-500">
          {row.client_match_name || "—"}
          {row.client_match_phone ? ` · ${row.client_match_phone}` : ""}
        </div>
      </div>
    );
  }

  if (kind === "provider" && row?.provider_match_id) {
    return (
      <div className="space-y-1">
        <Badge className="bg-green-50 text-green-700 border-green-200">
          Поставщик #{row.provider_match_id}
        </Badge>
        <div className="text-xs text-gray-500">
          {row.provider_match_name || "—"}
          {row.provider_match_type ? ` · ${row.provider_match_type}` : ""}
          {row.provider_match_phone ? ` · ${row.provider_match_phone}` : ""}
        </div>
      </div>
    );
  }

  return <span className="text-gray-400">—</span>;
}

function DuplicateWarningBadge({ row }) {
  if (!row?.has_both_client_and_provider) {
    return <span className="text-gray-400">—</span>;
  }

  const reasonMap = {
    same_chat_id: "Один и тот же Telegram chat_id в client и provider",
    same_phone: "Один и тот же телефон в client и provider",
    possible_duplicate: "Найден и client, и provider — нужна проверка",
  };

  const reason = reasonMap[row.duplicate_reason] || "Возможный дубль";

  return (
    <div className="space-y-1">
      <Badge className="bg-red-50 text-red-700 border-red-200">
        Проверить дубль
      </Badge>
      <div className="text-xs text-red-600">{reason}</div>
    </div>
  );
}

export default function AdminLeads() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [toast, setToast] = useState("");
  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2500);
  }

  const [whoami, setWhoami] = useState(null);
  const [whoamiErr, setWhoamiErr] = useState("");

  const status = params.get("status") || "";
  const lang = params.get("lang") || "";
  const page = params.get("page") || "";
  const q = params.get("q") || "";
  const quick = params.get("quick") || "all";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return items.filter((r) => {
      const quickMatch =
        quick === "all" ||
        (quick === "new" && String(r.status || "new") === "new") ||
        (quick === "providers" && isProviderLead(r)) ||
        (quick === "clients" && isClientLead(r)) ||
        (quick === "duplicates" && !!r.has_both_client_and_provider) ||
        (quick === "unlinked" &&
          !r.client_match_id &&
          !r.provider_match_id &&
          !r.decision);

      if (!quickMatch) return false;
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

        r.client_match_id,
        r.client_match_name,
        r.client_match_email,
        r.client_match_phone,
        r.client_match_telegram,
        r.client_match_chat_id,

        r.provider_match_id,
        r.provider_match_name,
        r.provider_match_email,
        r.provider_match_phone,
        r.provider_match_type,
        r.provider_match_social,
        r.provider_match_chat_id,

        u.source,
        u.medium,
        u.campaign,
        u.content,
        u.term,
        new Date(r.created_at).toLocaleString(),

        r.has_both_client_and_provider ? "duplicate" : "",
        r.duplicate_reason,
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(needle);
    });
  }, [items, q, quick]);

  const stats = useMemo(() => {
    const rows = filtered || [];
    const newCount = rows.filter((r) => String(r.status || "new") === "new").length;
    const closedCount = rows.filter((r) => String(r.status || "") === "closed").length;
    const clientCount = rows.filter(isClientLead).length;
    const providerCount = rows.filter(isProviderLead).length;
    const duplicateCount = rows.filter((r) => r.has_both_client_and_provider).length;
    const unlinkedCount = rows.filter(
      (r) => !r.client_match_id && !r.provider_match_id && !r.decision
    ).length;

    return {
      total: rows.length,
      newCount,
      closedCount,
      clientCount,
      providerCount,
      duplicateCount,
      unlinkedCount,
    };
  }, [filtered]);

  async function fetchLeads() {
    try {
      setLoading(true);
      setErr("");
      const data = await listLeads({ status, lang, page, q });
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
      //
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

  function setQuickFilter(nextQuick) {
    const next = new URLSearchParams(params);
    if (nextQuick === "all") {
      next.delete("quick");
    } else {
      next.set("quick", nextQuick);
    }
    next.delete("status");
    setParams(next, { replace: true });
  }

  function getAPIBase() {
    return (
      import.meta.env.VITE_API_BASE ||
      import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_BACKEND_URL ||
      ""
    );
  }

  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function pickTokenFromObject(obj) {
    if (!obj || typeof obj !== "object") return "";
    return (
      obj.token ||
      obj.accessToken ||
      obj.access_token ||
      obj.jwt ||
      obj?.data?.token ||
      ""
    );
  }

  function getAuthToken() {
    const directKeys = [
      "token",
      "adminToken",
      "accessToken",
      "jwt",
      "authToken",
      "providerToken",
      "clientToken",
    ];

    for (const k of directKeys) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }

    for (const k of directKeys) {
      const v = sessionStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }

    const jsonKeys = ["auth", "user", "session", "admin", "profile"];
    for (const k of jsonKeys) {
      const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (!raw) continue;
      const obj = safeJsonParse(raw);
      const t = pickTokenFromObject(obj);
      if (t && String(t).trim()) return String(t).trim();
    }

    return "";
  }

  async function adminPost(path, body) {
    const API_BASE = getAPIBase();
    if (!API_BASE) throw new Error("API_BASE is not defined");

    const url = `${API_BASE}${path}`;
    const token = getAuthToken();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify(body || {}),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      //
    }

    if (!res.ok) {
      const msg = data?.message || data?.error || `Request failed (${res.status})`;
      const extra = data?.debug
        ? `\n\nDEBUG:\n${JSON.stringify(data.debug, null, 2)}`
        : "";
      throw new Error(msg + extra);
    }

    return data;
  }

  async function adminDelete(path) {
    const API_BASE = getAPIBase();
    if (!API_BASE) throw new Error("API_BASE is not defined");

    const url = `${API_BASE}${path}`;
    const token = getAuthToken();

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      //
    }

    if (!res.ok) {
      const msg = data?.message || data?.error || `Request failed (${res.status})`;
      const extra = data?.debug
        ? `\n\nDEBUG:\n${JSON.stringify(data.debug, null, 2)}`
        : "";
      throw new Error(msg + extra);
    }

    return data;
  }

  function isClientLead(r) {
    const rr = String(r.requested_role || "").trim().toLowerCase();
    const src = String(r.source || "").trim().toLowerCase();
    return rr === "client" || src === "telegram_client";
  }

  function isProviderLead(r) {
    const rr = String(r.requested_role || "").trim().toLowerCase();
    const src = String(r.source || "").trim().toLowerCase();
    return rr === "agent" || rr === "provider" || src === "telegram_provider";
  }

  async function resetClientByLead(r) {
    const phone = r.phone || "";
    if (!phone && !r.telegram_chat_id) {
      return alert("У лида нет телефона и telegram_chat_id — reset невозможен.");
    }

    const ok = window.confirm(
      `Сбросить Telegram-привязку КЛИЕНТА?\n\nТелефон: ${phone || "—"}\nLead ID: ${r.id}\nchat_id: ${r.telegram_chat_id || "—"}`
    );
    if (!ok) return;

    try {
      const data = await adminPost("/api/admin/reset-client", {
        leadId: r.id,
        telegramChatId: r.telegram_chat_id || null,
        phone: phone || "",
        alsoResetLeads: true,
      });

      showToast(
        `✅ Reset client OK (clientId: ${data?.clientId ?? "—"})` +
          (data?.clientFound === false ? " (client not found, lead reset ok)" : "")
      );
      await fetchLeads();
    } catch (e) {
      alert(e?.message || "Reset client failed");
    }
  }

  async function resetProviderByLead(r) {
    const phone = r.phone || "";
    if (!phone && !r.telegram_chat_id) {
      return alert("У лида нет телефона и telegram_chat_id — reset невозможен.");
    }

    const ok = window.confirm(
      `Сбросить Telegram-привязку ПОСТАВЩИКА?\n\nТелефон: ${phone || "—"}\nLead ID: ${r.id}\nchat_id: ${r.telegram_chat_id || "—"}`
    );
    if (!ok) return;

    try {
      const data = await adminPost("/api/admin/reset-provider", {
        leadId: r.id,
        telegramChatId: r.telegram_chat_id || null,
        phone: phone || "",
        alsoResetLeads: true,
      });

      showToast(
        `✅ Reset provider OK (providerId: ${data?.providerId ?? "—"})` +
          (data?.providerFound === false
            ? " (provider not found, lead reset ok)"
            : "")
      );
      await fetchLeads();
    } catch (e) {
      alert(e?.message || "Reset provider failed");
    }
  }

  async function fetchWhoami() {
    try {
      setWhoamiErr("");
      setWhoami(null);

      const API_BASE = getAPIBase();
      if (!API_BASE) throw new Error("API_BASE is not defined");

      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/_debug/whoami`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        //
      }

      if (!res.ok) {
        throw new Error(data?.message || data?.error || `whoami failed (${res.status})`);
      }

      setWhoami(data);
    } catch (e) {
      setWhoamiErr(e?.message || "whoami failed");
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Лиды</h1>

      {toast ? (
        <div className="mb-3">
          <span className="inline-flex items-center px-3 py-2 rounded bg-green-50 text-green-800 border border-green-200 text-sm">
            {toast}
          </span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={fetchWhoami}
          className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
          title="Проверить, кем сервер видит текущую сессию/токен"
        >
          Проверить доступ
        </button>

        {whoamiErr ? <span className="text-sm text-red-600">{whoamiErr}</span> : null}

        {whoami ? (
          <span className="text-sm text-gray-700">
            Роль: <span className="font-mono">{String(whoami.role || "")}</span> | роли:{" "}
            <span className="font-mono">
              {Array.isArray(whoami.roles) ? whoami.roles.join(",") : ""}
            </span>{" "}
            | админ: <span className="font-mono">{String(!!whoami.is_admin)}</span> | id:{" "}
            <span className="font-mono">{String(whoami.id)}</span>
          </span>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Всего" value={stats.total} hint="в текущей выдаче" tone="blue" />
        <StatCard label="Новые" value={stats.newCount} hint="нужно разобрать" tone="amber" />
        <StatCard label="Клиенты" value={stats.clientCount} hint="заявки клиентов" tone="blue" />
        <StatCard label="Поставщики" value={stats.providerCount} hint="регистрации" tone="green" />
        <StatCard label="Закрытые" value={stats.closedCount} hint="уже обработаны" />
        <StatCard label="Дубли" value={stats.duplicateCount} hint="проверить вручную" tone="red" />
        <StatCard label="Без связи" value={stats.unlinkedCount} hint="нет профиля/решения" tone="amber" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => {
          const active = quick === filter.val || (!params.get("quick") && filter.val === "all");
          return (
            <button
              key={filter.val}
              type="button"
              onClick={() => setQuickFilter(filter.val)}
              className={clsx(
                "rounded-full border px-4 py-2 text-sm font-semibold transition",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

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
              <th className="py-2 pr-4">Когда</th>
              <th className="py-2 pr-4">Контакт</th>
              <th className="py-2 pr-4">Источник</th>
              <th className="py-2 pr-4">Роль</th>
              <th className="py-2 pr-4">Решение</th>
              <th className="py-2 pr-4">Статус</th>
              <th className="py-2 pr-4">Telegram</th>
              <th className="py-2 pr-4">Связано</th>
              <th className="py-2 pr-4">Дубль</th>
              <th className="py-2 pr-4">Действия</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const isTelegramLead = !!r.telegram_chat_id;
              const undecided = !r.decision;
              const canAutoAccept = isTelegramLead && undecided;
              const telegramUsername = String(r.telegram_username || "").replace(/^@/, "");

              return (
                <tr
                  key={r.id}
                  className={`border-b align-top ${
                    r.has_both_client_and_provider
                      ? "bg-red-50/60"
                      : String(r.status || "new") === "new"
                      ? "bg-amber-50/40"
                      : ""
                  }`}
                >
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>

                  <td className="py-2 pr-4">
                    <div className="font-medium">{r.name || "—"}</div>
                    <div className="mt-1 text-xs text-gray-600">{r.phone || "телефон не указан"}</div>
                    {r.comment ? (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {r.comment}
                      </div>
                    ) : null}
                  </td>

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
                          ID <span className="font-mono">{String(r.telegram_chat_id)}</span>
                        </div>
                        {r.telegram_username ? (
                          <a
                            href={`https://t.me/${String(r.telegram_username).replace(/^@/, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            @{String(r.telegram_username).replace(/^@/, "")}
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  <td className="py-2 pr-4">
                    <div className="space-y-2">
                      <LinkedEntityBadge kind="client" row={r} />
                      <LinkedEntityBadge kind="provider" row={r} />
                    </div>
                  </td>

                  <td className="py-2 pr-4">
                    <DuplicateWarningBadge row={r} />
                  </td>

                  <td className="py-2 pr-4">
                    {isTelegramLead ? (
                      <div className="flex flex-wrap gap-2">
                        {telegramUsername ? (
                          <a
                            href={`https://t.me/${telegramUsername}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                          >
                            Открыть Telegram
                          </a>
                        ) : null}

                        {r.phone ? (
                          <a
                            href={`tel:${String(r.phone).replace(/[^\d+]/g, "")}`}
                            className="px-2 py-1 text-xs rounded bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                          >
                            Позвонить
                          </a>
                        ) : null}

                        {canAutoAccept ? (
                          <>
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
                          </>
                        ) : null}

                        {isClientLead(r) ? (
                          <button
                            onClick={() => resetClientByLead(r)}
                            className="px-2 py-1 text-xs rounded bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap"
                            title="Сбросить telegram_chat_id у клиента и вернуть telegram-lead в new"
                          >
                            Снять связь с клиентом
                          </button>
                        ) : null}

                        {isProviderLead(r) ? (
                          <button
                            onClick={() => resetProviderByLead(r)}
                            className="px-2 py-1 text-xs rounded bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                            title="Сбросить telegram_chat_id у поставщика и вернуть telegram-lead в new"
                          >
                            Снять связь с поставщиком
                          </button>
                        ) : null}

                        <button
                          onClick={async () => {
                            const ok = window.confirm(
                              `⚠️ УДАЛИТЬ ПОЛНОСТЬЮ?\n\n` +
                                `Lead ID: ${r.id}\n` +
                                `Телефон: ${r.phone || "—"}\n` +
                                `chat_id: ${r.telegram_chat_id || "—"}\n\n` +
                                `Будут удалены:\n` +
                                `• лид\n• клиент / поставщик\n• Telegram-привязка\n\n` +
                                `ОТМЕНЫ НЕТ`
                            );
                            if (!ok) return;

                            try {
                              await adminDelete(`/api/admin/leads/${r.id}`);
                              showToast("🗑 Лид и пользователь полностью удалены");
                              await fetchLeads();
                            } catch (e) {
                              alert(e?.message || "Delete failed");
                            }
                          }}
                          className="px-2 py-1 text-xs rounded bg-black text-white hover:bg-red-700 whitespace-nowrap"
                          title="Полностью удалить лид и пользователя"
                        >
                          Удалить
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {!filtered.length ? (
              <tr>
                <td colSpan={10} className="py-12 text-center">
                  <div className="text-base font-semibold text-slate-700">
                    Лидов по этому фильтру нет
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Попробуйте выбрать другой быстрый фильтр или очистить поиск.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
