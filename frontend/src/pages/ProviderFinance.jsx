import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api";

function money(sum) {
  const n = Number(sum || 0);
  try {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " UZS";
  } catch {
    return `${Math.round(n)} UZS`;
  }
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

function statusPill(status) {
  const s = String(status || "").toLowerCase();
  if (["paid", "success", "completed", "unlocked"].includes(s)) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }
  if (["created", "pending", "new"].includes(s)) {
    return "bg-amber-50 text-amber-700 ring-amber-100";
  }
  if (["failed", "error", "canceled", "cancelled", "expired"].includes(s)) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }
  return "bg-slate-50 text-slate-600 ring-slate-100";
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-sm font-semibold text-slate-500">{hint}</div> : null}
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
      setError(e?.message || "Не удалось загрузить финансы поставщика");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = data?.stats || {};
  const unlocks = Array.isArray(data?.recent_unlocks) ? data.recent_unlocks : [];
  const payments = Array.isArray(data?.telegram_payments) ? data.telegram_payments : [];
  const support = Array.isArray(data?.support_donations) ? data.support_donations : [];

  const allPayments = useMemo(() => {
    const rows = [];
    for (const r of payments) rows.push({ ...r, group: "Telegram Payme" });
    for (const r of support) rows.push({ ...r, group: "Support" });
    return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [payments, support]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                Travella provider finance
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
                Финансы поставщика
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                Здесь видно, сколько раз клиенты открывали ваши контакты, какие Telegram Payme-платежи прошли по вашим услугам и какие платежи поддержки проекта связаны с вашими объявлениями.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={load}
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
              >
                Обновить
              </button>
              <Link
                to="/dashboard/services/marketplace"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                Мои услуги
              </Link>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Открытий контактов" value={stats.unlock_count || 0} hint="по вашим услугам" />
          <StatCard label="Сумма unlock" value={money(stats.unlock_amount_sum || 0)} hint="по данным unlock-записей" />
          <StatCard label="Telegram Payme" value={money(stats.telegram_paid_sum || 0)} hint={`${stats.telegram_paid_count || 0} успешных платежей`} />
          <StatCard label="Support" value={money(stats.support_paid_sum || 0)} hint={`${stats.support_paid_count || 0} платежей поддержки`} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Последние открытия контактов</h2>
                <p className="text-sm font-semibold text-slate-500">Кто и по какой услуге открыл контакты.</p>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Клиент</th>
                    <th className="px-4 py-3">Услуга</th>
                    <th className="px-4 py-3 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {unlocks.length ? unlocks.map((r) => (
                    <tr key={`u-${r.id}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-500">{dateTime(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-900">{r.client_name || `Client #${r.client_id || "—"}`}</div>
                        {r.client_phone ? <div className="text-xs font-semibold text-slate-500">{r.client_phone}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800">#{r.service_id} · {r.service_title || "Услуга"}</div>
                        {r.service_category ? <div className="text-xs font-semibold text-slate-500">{r.service_category}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-black text-slate-950">{money(r.price_sum || 0)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" className="px-4 py-8 text-center font-semibold text-slate-400">Открытий пока нет</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-black text-slate-950">Платежи по вашим услугам</h2>
              <p className="text-sm font-semibold text-slate-500">Telegram Payme unlock и support payments.</p>
            </div>
            <div className="mt-4 space-y-3">
              {allPayments.length ? allPayments.slice(0, 20).map((r, idx) => (
                <div key={`${r.group}-${r.id || idx}`} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{r.group}</div>
                      <div className="mt-1 font-black text-slate-950">{r.title || r.payment_type || r.source || "Платёж"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{dateTime(r.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-slate-950">{money(r.amount_sum || 0)}</div>
                      <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusPill(r.status)}`}>
                        {r.status || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                    <div>Услуга: #{r.service_id || "—"}</div>
                    <div>Источник: {r.source || "—"}</div>
                    {r.telegram_payment_charge_id ? <div className="truncate">TG charge: {r.telegram_payment_charge_id}</div> : null}
                    {r.provider_payment_charge_id ? <div className="truncate">Provider charge: {r.provider_payment_charge_id}</div> : null}
                    {r.payme_id ? <div className="truncate">Payme ID: {r.payme_id}</div> : null}
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-400">
                  Платежей пока нет
                </div>
              )}
            </div>
          </section>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-sm font-black text-slate-500 shadow-sm">
            Загружаю финансы…
          </div>
        ) : null}
      </div>
    </div>
  );
}
