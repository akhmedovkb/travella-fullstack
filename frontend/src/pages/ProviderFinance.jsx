// frontend/src/pages/ProviderFinance.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api";

const PERIODS = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "all", label: "Всё время" },
];

const LEAD_STATUSES = [
  { value: "new", label: "Новый", tone: "bg-orange-50 text-orange-700 ring-orange-100" },
  { value: "contacted", label: "Связался", tone: "bg-sky-50 text-sky-700 ring-sky-100" },
  { value: "in_progress", label: "В работе", tone: "bg-violet-50 text-violet-700 ring-violet-100" },
  { value: "closed", label: "Закрыл сделку", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  { value: "not_relevant", label: "Неактуально", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
];

function statusMeta(status) {
  return LEAD_STATUSES.find((x) => x.value === String(status || "new")) || LEAD_STATUSES[0];
}

function dateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function initials(name) {
  const s = String(name || "Клиент").trim();
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}

function telegramHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("@")) return `https://t.me/${raw.slice(1)}`;
  if (/^[a-zA-Z0-9_]{5,}$/.test(raw)) return `https://t.me/${raw}`;
  return "";
}

function StatCard({ icon, label, value, hint, tone = "slate" }) {
  const tones = {
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100",
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black tracking-[-0.05em] text-slate-950">{value}</div>
        </div>
        <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl text-xl ring-1 ${tones[tone] || tones.slate}`}>
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-3 text-sm font-semibold leading-5 text-slate-500">{hint}</div> : null}
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
      <div className="text-sm font-black text-slate-700">{title}</div>
      {text ? <div className="mt-1 text-sm font-semibold text-slate-400">{text}</div> : null}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

function ContactActions({ phone, telegram }) {
  const tg = telegramHref(telegram);
  return (
    <div className="flex flex-wrap gap-2 text-xs font-black">
      {phone ? (
        <a className="rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50" href={`tel:${phone}`}>
          📞 Позвонить
        </a>
      ) : null}
      {tg ? (
        <a className="rounded-full bg-sky-50 px-3 py-1 text-sky-700 ring-1 ring-sky-100 hover:bg-sky-100" href={tg} target="_blank" rel="noreferrer">
          💬 Telegram
        </a>
      ) : telegram ? (
        <span className="rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-200">TG: {telegram}</span>
      ) : null}
    </div>
  );
}

function LeadControls({ row, onStatus, onNote }) {
  const [note, setNote] = useState(row.lead_note || "");
  const clientId = row.client_id;
  const serviceId = row.service_id || row.last_service_id;

  useEffect(() => {
    setNote(row.lead_note || "");
  }, [row.lead_note, row.client_id, row.service_id, row.last_service_id]);

  if (!clientId || !serviceId) return null;

  return (
    <div className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Статус</span>
        {LEAD_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStatus({ clientId, serviceId, status: s.value })}
            className={[
              "rounded-full px-2.5 py-1 text-[11px] font-black ring-1 transition",
              String(row.lead_status || "new") === s.value
                ? s.tone
                : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
          placeholder="Заметка: что обещал клиент, когда перезвонить, что уточнить"
        />
        <button
          type="button"
          onClick={() => onNote({ clientId, serviceId, note })}
          className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-orange-600"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

export default function ProviderFinance() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("30d");
  const [serviceId, setServiceId] = useState("");

  async function load(next = {}) {
    const p = next.period ?? period;
    const s = next.serviceId ?? serviceId;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (p) params.set("period", p);
      if (s) params.set("service_id", s);
      const res = await apiGet(`/api/providers/finance?${params.toString()}`, "provider");
      setData(res || {});
    } catch (e) {
      setError(e?.message || "Не удалось загрузить спрос и клиентов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changePeriod(value) {
    setPeriod(value);
    await load({ period: value });
  }

  async function changeService(value) {
    setServiceId(value);
    await load({ serviceId: value });
  }

  async function saveStatus({ clientId, serviceId, status }) {
    setSaving(true);
    try {
      await apiPost("/api/providers/finance/leads/status", { client_id: clientId, service_id: serviceId, status }, "provider");
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить статус лида");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote({ clientId, serviceId, note }) {
    setSaving(true);
    try {
      await apiPost("/api/providers/finance/leads/note", { client_id: clientId, service_id: serviceId, note }, "provider");
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить заметку");
    } finally {
      setSaving(false);
    }
  }

  const stats = data?.stats || {};
  const unlocks = Array.isArray(data?.recent_unlocks) ? data.recent_unlocks : [];
  const hotClients = Array.isArray(data?.hot_clients) ? data.hot_clients : [];
  const topServices = Array.isArray(data?.top_services) ? data.top_services : [];
  const quickRequests = Array.isArray(data?.quick_requests) ? data.quick_requests : [];
  const services = Array.isArray(data?.services) ? data.services : [];

  const hottestClients = useMemo(() => {
    if (hotClients.length) return hotClients;
    const byClient = new Map();
    for (const row of unlocks) {
      const key = row.client_id || row.client_phone || row.client_name || `row-${row.id}`;
      const old = byClient.get(key) || {
        client_id: row.client_id,
        client_name: row.client_name,
        client_phone: row.client_phone,
        client_telegram: row.client_telegram,
        unlock_count: 0,
        last_activity_at: row.created_at,
        last_service_title: row.service_title,
        last_service_id: row.service_id,
        lead_status: row.lead_status || "new",
        lead_note: row.lead_note || "",
      };
      old.unlock_count += 1;
      if (new Date(row.created_at || 0) > new Date(old.last_activity_at || 0)) {
        old.last_activity_at = row.created_at;
        old.last_service_title = row.service_title;
        old.last_service_id = row.service_id;
        old.lead_status = row.lead_status || old.lead_status || "new";
        old.lead_note = row.lead_note || old.lead_note || "";
      }
      byClient.set(key, old);
    }
    return Array.from(byClient.values()).sort((a, b) => {
      if ((b.unlock_count || 0) !== (a.unlock_count || 0)) return (b.unlock_count || 0) - (a.unlock_count || 0);
      return new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0);
    });
  }, [hotClients, unlocks]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-orange-900 p-5 text-white sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/15">
                  Travella CRM
                </div>
                <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-4xl">📈 Спрос и клиенты</h1>
                <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-orange-50/90 sm:text-base">
                  Рабочий экран поставщика: новые открытия контактов, горячие клиенты, быстрые запросы, заметки и статусы лидов.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => load()}
                  disabled={loading}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-950 shadow-sm transition hover:bg-orange-50 disabled:opacity-60"
                >
                  {loading ? "Обновляю…" : "Обновить"}
                </button>
                <Link to="/dashboard/services/marketplace" className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15">
                  Мои услуги
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr_auto] lg:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Период</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => changePeriod(p.value)}
                    className={[
                      "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                      period === p.value ? "bg-slate-950 text-white ring-slate-950" : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Услуга</div>
              <select
                value={serviceId}
                onChange={(e) => changeService(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Все услуги</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>#{s.id} · {s.title || s.category || "Услуга"}</option>
                ))}
              </select>
            </div>
            <div className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-700 ring-1 ring-orange-100">
              {saving ? "Сохраняю изменения…" : `${stats.new_leads_count || 0} новых лидов`}
            </div>
          </div>
        </div>

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard icon="🔓" tone="orange" label="Открытия контактов" value={stats.unlock_count || 0} hint="клиенты уже проявили прямой интерес" />
          <StatCard icon="🔥" tone="emerald" label="Горячие клиенты" value={stats.hot_clients_count || hottestClients.length || 0} hint="клиенты с контактами для быстрого ответа" />
          <StatCard icon="👀" tone="sky" label="Просмотры" value={stats.views_count || 0} hint="интерес к карточкам" />
          <StatCard icon="❤️" tone="rose" label="В избранном" value={stats.favorite_count || 0} hint="сколько раз услуги сохранили" />
          <StatCard icon="⚡" tone="violet" label="Быстрые запросы" value={stats.quick_requests_count || quickRequests.length || 0} hint="обращения по услугам" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Последние открытия контактов</h2>
                <p className="text-sm font-semibold text-slate-500">Клиент уже оплатил доступ к контакту. Это самый горячий лид.</p>
              </div>
              <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">Нужно отвечать быстро</span>
            </div>

            <div className="mt-4 space-y-3">
              {unlocks.length ? unlocks.map((r) => (
                <div key={`u-${r.id}`} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4 transition hover:bg-orange-50/30">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-black text-slate-950">{r.client_name || `Client #${r.client_id || "—"}`}</div>
                        <StatusBadge status={r.lead_status} />
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200">{dateTime(r.created_at)}</span>
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-700">#{r.service_id} · {r.service_title || "Услуга"}</div>
                      {r.service_category ? <div className="mt-0.5 text-xs font-semibold text-slate-500">{r.service_category} · {r.source || "marketplace"}</div> : null}
                      <div className="mt-2"><ContactActions phone={r.client_phone} telegram={r.client_telegram} /></div>
                    </div>
                  </div>
                  <LeadControls row={r} onStatus={saveStatus} onNote={saveNote} />
                </div>
              )) : <EmptyState title="Открытий пока нет" text="Когда клиент откроет контакты вашей услуги, он появится здесь." />}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">🔥 Горячие клиенты</h2>
              <p className="text-sm font-semibold text-slate-500">Приоритетный список для связи и закрытия сделки.</p>
            </div>

            <div className="mt-4 space-y-3">
              {hottestClients.length ? hottestClients.slice(0, 12).map((c, idx) => (
                <div key={`hc-${c.client_id || c.client_phone || idx}`} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4 transition hover:bg-orange-50/40">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">{initials(c.client_name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-black text-slate-950">{c.client_name || `Client #${c.client_id || "—"}`}</div>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">{c.unlock_count || 1} открытий</span>
                        <StatusBadge status={c.lead_status} />
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">Последняя активность: {dateTime(c.last_activity_at)}</div>
                      {c.last_service_title ? <div className="mt-1 truncate text-sm font-bold text-slate-700">#{c.last_service_id} · {c.last_service_title}</div> : null}
                      <div className="mt-2"><ContactActions phone={c.client_phone} telegram={c.client_telegram} /></div>
                      <LeadControls row={{ ...c, service_id: c.last_service_id }} onStatus={saveStatus} onNote={saveNote} />
                    </div>
                  </div>
                </div>
              )) : <EmptyState title="Горячих клиентов пока нет" text="Они появятся после открытий контактов или быстрых запросов." />}
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">🏆 Топ услуг по спросу</h2>
              <p className="text-sm font-semibold text-slate-500">Рейтинг по открытиям, быстрым запросам, избранному и просмотрам.</p>
            </div>
            <div className="mt-4 space-y-3">
              {topServices.length ? topServices.slice(0, 10).map((s, idx) => (
                <div key={`top-${s.service_id || idx}`} className="rounded-3xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-black text-orange-600">#{idx + 1}</div>
                      <div className="truncate font-black text-slate-950">#{s.service_id} · {s.service_title || "Услуга"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{s.service_category || "category"}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-2xl font-black text-slate-950">{s.demand_score || 0}</div>
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">скоринг</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-black">
                    <div className="rounded-2xl bg-orange-50 p-2 text-orange-700">🔓 {s.unlock_count || 0}</div>
                    <div className="rounded-2xl bg-sky-50 p-2 text-sky-700">👀 {s.views_count || 0}</div>
                    <div className="rounded-2xl bg-rose-50 p-2 text-rose-700">❤️ {s.favorite_count || 0}</div>
                    <div className="rounded-2xl bg-violet-50 p-2 text-violet-700">⚡ {s.quick_requests_count || 0}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/dashboard/services/marketplace?service=${s.service_id}`} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-black text-white hover:bg-orange-600">Открыть услугу</Link>
                    <Link to={`/dashboard/services/marketplace`} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-200">Обновить цену/актуальность</Link>
                  </div>
                </div>
              )) : <EmptyState title="Топ пока пустой" text="После первых действий здесь будет рейтинг услуг." />}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">⚡ Быстрые запросы</h2>
              <p className="text-sm font-semibold text-slate-500">Заявки и обращения по услугам.</p>
            </div>
            <div className="mt-4 space-y-3">
              {quickRequests.length ? quickRequests.slice(0, 12).map((r, idx) => (
                <div key={`qr-${r.source || "qr"}-${r.id || idx}`} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{r.client_name || "Клиент"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{shortDate(r.created_at)} · {r.source || "request"}</div>
                    </div>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700 ring-1 ring-violet-100">{r.status || "new"}</span>
                  </div>
                  {r.service_title ? <div className="mt-2 text-sm font-bold text-slate-700">#{r.service_id} · {r.service_title}</div> : null}
                  {r.message ? <div className="mt-2 text-sm font-semibold leading-5 text-slate-500">{r.message}</div> : null}
                </div>
              )) : <EmptyState title="Быстрых запросов пока нет" text="Они появятся после обращения клиента по услуге." />}
            </div>
          </section>
        </div>

        {loading ? <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-sm font-black text-slate-500 shadow-sm">Загружаю спрос и клиентов…</div> : null}
      </div>
    </div>
  );
}
