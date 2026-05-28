//frontend/src/pages/ProviderFinance.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api";

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

function StatCard({ icon, label, value, hint, tone = "slate" }) {
  const tones = {
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
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

export default function ProviderFinance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet("/api/providers/finance", "provider");
      setData(res || {});
    } catch (e) {
      setError(e?.message || "Не удалось загрузить спрос и клиентов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = data?.stats || {};
  const unlocks = Array.isArray(data?.recent_unlocks) ? data.recent_unlocks : [];
  const hotClients = Array.isArray(data?.hot_clients) ? data.hot_clients : [];
  const topServices = Array.isArray(data?.top_services) ? data.top_services : [];
  const quickRequests = Array.isArray(data?.quick_requests) ? data.quick_requests : [];

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
      };
      old.unlock_count += 1;
      if (new Date(row.created_at || 0) > new Date(old.last_activity_at || 0)) {
        old.last_activity_at = row.created_at;
        old.last_service_title = row.service_title;
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
                <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-4xl">
                  📈 Спрос и клиенты
                </h1>
                <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-orange-50/90 sm:text-base">
                  Здесь поставщик видит не финансы, а реальный интерес к своим услугам: кто открывал контакты,
                  какие клиенты горячие, какие объявления собирают спрос и где стоит быстрее ответить.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={load}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-950 shadow-sm transition hover:bg-orange-50"
                >
                  Обновить
                </button>
                <Link
                  to="/dashboard/services/marketplace"
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
                >
                  Мои услуги
                </Link>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon="🔓" tone="orange" label="Открытия контактов" value={stats.unlock_count || 0} hint="клиенты уже проявили прямой интерес" />
          <StatCard icon="🔥" tone="emerald" label="Горячие клиенты" value={stats.hot_clients_count || hottestClients.length || 0} hint="клиенты с контактами для быстрого ответа" />
          <StatCard icon="👀" tone="sky" label="Просмотры" value={stats.views_count || 0} hint="если трекинг просмотров включён в базе" />
          <StatCard icon="⚡" tone="violet" label="Быстрые запросы" value={stats.quick_requests_count || quickRequests.length || 0} hint="заявки и быстрые обращения по услугам" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Последние открытия контактов</h2>
                <p className="text-sm font-semibold text-slate-500">Самые важные лиды: клиент уже оплатил доступ к контакту.</p>
              </div>
              <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
                Нужно отвечать быстро
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Клиент</th>
                    <th className="px-4 py-3">Услуга</th>
                    <th className="px-4 py-3">Источник</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {unlocks.length ? unlocks.map((r) => (
                    <tr key={`u-${r.id}`} className="align-top transition hover:bg-orange-50/30">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-500">{dateTime(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-900">{r.client_name || `Client #${r.client_id || "—"}`}</div>
                        {r.client_phone ? <div className="text-xs font-semibold text-slate-500">☎ {r.client_phone}</div> : null}
                        {r.client_telegram ? <div className="text-xs font-semibold text-slate-500">TG: {r.client_telegram}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800">#{r.service_id} · {r.service_title || "Услуга"}</div>
                        {r.service_category ? <div className="text-xs font-semibold text-slate-500">{r.service_category}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
                          {r.source || "marketplace"}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="4" className="px-4 py-8">
                        <EmptyState title="Открытий пока нет" text="Когда клиент откроет контакты вашей услуги, он появится здесь." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">
                      {initials(c.client_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-black text-slate-950">{c.client_name || `Client #${c.client_id || "—"}`}</div>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
                          {c.unlock_count || 1} открытий
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">Последняя активность: {dateTime(c.last_activity_at)}</div>
                      {c.last_service_title ? <div className="mt-1 truncate text-sm font-bold text-slate-700">{c.last_service_title}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                        {c.client_phone ? <a className="rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50" href={`tel:${c.client_phone}`}>Позвонить</a> : null}
                        {c.client_telegram ? <span className="rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-200">TG: {c.client_telegram}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <EmptyState title="Горячих клиентов пока нет" text="Они появятся после открытий контактов или быстрых запросов." />
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">🏆 Топ услуг по спросу</h2>
              <p className="text-sm font-semibold text-slate-500">Какие объявления чаще всего приводят к открытию контактов.</p>
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
                      <div className="text-2xl font-black text-slate-950">{s.unlock_count || 0}</div>
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">открытий</div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-950"
                      style={{ width: `${Math.max(8, Math.min(100, Number(s.unlock_count || 0) * 18))}%` }}
                    />
                  </div>
                </div>
              )) : (
                <EmptyState title="Топ пока пустой" text="После первых открытий контактов здесь будет рейтинг услуг." />
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">⚡ Быстрые запросы</h2>
              <p className="text-sm font-semibold text-slate-500">Заявки и обращения по услугам, если такой канал включён.</p>
            </div>
            <div className="mt-4 space-y-3">
              {quickRequests.length ? quickRequests.slice(0, 12).map((r, idx) => (
                <div key={`qr-${r.id || idx}`} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{r.client_name || r.name || "Клиент"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{shortDate(r.created_at)}</div>
                    </div>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700 ring-1 ring-violet-100">
                      {r.status || "new"}
                    </span>
                  </div>
                  {r.service_title ? <div className="mt-2 text-sm font-bold text-slate-700">{r.service_title}</div> : null}
                  {r.message ? <div className="mt-2 text-sm font-semibold leading-5 text-slate-500">{r.message}</div> : null}
                </div>
              )) : (
                <EmptyState title="Быстрых запросов пока нет" text="Блок готов для будущих заявок, без показа сумм и платежей." />
              )}
            </div>
          </section>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-sm font-black text-slate-500 shadow-sm">
            Загружаю спрос и клиентов…
          </div>
        ) : null}
      </div>
    </div>
  );
}
