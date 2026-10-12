import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  History,
  Search,
  ShieldCheck,
  ShieldMinus,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { apiGet, apiPatch } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

const PROVIDER_TYPES = {
  agent: "Турагент",
  guide: "Гид",
  hotel: "Отель",
  transport: "Транспорт",
  tour_operator: "Туроператор",
};

function providerTypeLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  return PROVIDER_TYPES[key] || value || "Тип не указан";
}

function displayName(person) {
  return person?.name || person?.email || `Поставщик #${person?.id || "—"}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ConfirmDialog({ target, busy, onClose, onConfirm }) {
  if (!target) return null;
  const granting = !target.is_admin;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="admin-access-dialog-title" className="w-full max-w-md rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${granting ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {granting ? <ShieldCheck size={21} /> : <ShieldMinus size={21} />}
            </span>
            <div>
              <h2 id="admin-access-dialog-title" className="text-lg font-bold text-slate-950">
                {granting ? "Назначить администратора?" : "Снять права администратора?"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{displayName(target)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Закрыть" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <p className="px-5 py-4 text-sm leading-6 text-slate-600">
          {granting
            ? "Пользователь получит полный доступ к административным разделам и управлению платформой."
            : "Пользователь потеряет доступ ко всем административным разделам. Его кабинет поставщика останется доступен."}
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Отмена
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50 ${granting ? "bg-slate-950 hover:bg-slate-800" : "bg-red-600 hover:bg-red-700"}`}>
            {busy ? "Сохраняем..." : granting ? "Назначить" : "Снять права"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminAccess() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("admins");
  const [data, setData] = useState({ providers: [], events: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (nextQuery = query, nextScope = scope) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope: nextScope, limit: "100" });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const result = await apiGet(`/api/admin/admin-access?${params}`, "admin");
      setData(result);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [query, scope]);

  useEffect(() => {
    load("", "admins");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeScope(nextScope) {
    setScope(nextScope);
    setQuery("");
    load("", nextScope);
  }

  async function applyRoleChange() {
    if (!target) return;
    setSaving(true);
    try {
      const nextValue = !target.is_admin;
      await apiPatch(`/api/admin/admin-access/${target.id}`, { is_admin: nextValue }, "admin");
      tSuccess(nextValue ? "Администратор назначен" : "Права администратора сняты");
      setTarget(null);
      await load();
    } catch (err) {
      tError(err?.message || "Не удалось изменить права");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-72px)] bg-slate-50 px-4 py-5 md:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-orange-600">Безопасность платформы</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Управление администраторами</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Назначайте доступ только сотрудникам, которым доверено полное управление Travella.</p>
          </div>
          <div className="flex gap-2">
            <div className="min-w-28 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-2xl font-bold text-slate-950">{data.stats?.admins ?? "—"}</div>
              <div className="text-xs font-semibold text-slate-500">Администраторов</div>
            </div>
            <div className="min-w-28 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-2xl font-bold text-slate-950">{data.stats?.providers ?? "—"}</div>
              <div className="text-xs font-semibold text-slate-500">Поставщиков</div>
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex w-fit rounded-md bg-slate-100 p-1">
                {[{ id: "admins", label: "Администраторы" }, { id: "all", label: "Все поставщики" }].map((item) => (
                  <button key={item.id} type="button" onClick={() => changeScope(item.id)} className={`h-9 rounded px-3 text-sm font-semibold transition ${scope === item.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); load(); }} className="flex w-full max-w-lg gap-2">
                <label className="relative flex-1">
                  <span className="sr-only">Поиск пользователя</span>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, email, телефон или ID" className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
                </label>
                <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">Найти</button>
              </form>
            </div>

            {error ? (
              <div className="p-8 text-center"><p className="text-sm font-semibold text-red-600">{error}</p><button type="button" onClick={() => load()} className="mt-3 text-sm font-semibold text-slate-700 underline">Повторить</button></div>
            ) : loading ? (
              <div className="p-10 text-center text-sm text-slate-500">Загрузка пользователей...</div>
            ) : data.providers?.length ? (
              <div className="divide-y divide-slate-100">
                {data.providers.map((provider) => {
                  const self = Number(provider.id) === Number(data.currentAdminId);
                  return (
                    <div key={provider.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${provider.is_admin ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}>
                          {provider.is_admin ? <ShieldCheck size={21} /> : <UserCog size={21} />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate font-bold text-slate-950">{displayName(provider)}</div>
                            {self && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">Это вы</span>}
                            {provider.is_admin && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Администратор</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span>ID {provider.id}</span><span>{providerTypeLabel(provider.type)}</span>
                            {provider.email && <span>{provider.email}</span>}{provider.phone && <span>{provider.phone}</span>}
                          </div>
                        </div>
                      </div>
                      <button type="button" disabled={self} onClick={() => setTarget(provider)} title={self ? "Нельзя изменить собственные права" : undefined} className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${provider.is_admin ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                        {provider.is_admin ? <ShieldMinus size={16} /> : <BadgeCheck size={16} />}
                        {provider.is_admin ? "Снять права" : "Назначить админом"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-10 text-center"><Users className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-sm font-semibold text-slate-700">Ничего не найдено</p><p className="mt-1 text-xs text-slate-500">Измените запрос или переключите список.</p></div>
            )}
          </section>

          <aside className="self-start overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4"><History size={18} className="text-slate-500" /><h2 className="font-bold text-slate-950">История изменений</h2></div>
            <div className="divide-y divide-slate-100">
              {data.events?.length ? data.events.map((event) => (
                <div key={event.id} className="px-4 py-3">
                  <div className="text-sm text-slate-700"><span className="font-semibold text-slate-950">{event.actor_name || event.actor_email || "Удалённый администратор"}</span> {event.action === "granted" ? "назначил администратора" : "снял права у"} <span className="font-semibold text-slate-950">{event.target_name || event.target_email || "удалённого пользователя"}</span></div>
                  <div className="mt-1 text-xs text-slate-400">{formatDate(event.created_at)}</div>
                </div>
              )) : <div className="p-6 text-center text-sm text-slate-500">Изменений пока нет</div>}
            </div>
          </aside>
        </div>
      </div>
      <ConfirmDialog target={target} busy={saving} onClose={() => !saving && setTarget(null)} onConfirm={applyRoleChange} />
    </div>
  );
}
