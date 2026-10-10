import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tError, tInfo, tSuccess } from "../shared/toast";
import VehicleModelInput from "./VehicleModelInput";

const GUIDE_CATEGORIES = [
  ["city_tour_guide", "Городская экскурсия"],
  ["mountain_tour_guide", "Экскурсия в горы"],
  ["desert_tour_guide", "Пустынный тур"],
  ["safari_tour_guide", "Сафари-тур"],
  ["meet", "Встреча"],
  ["seeoff", "Проводы"],
  ["translation", "Переводчик"],
];
const TRANSPORT_CATEGORIES = [
  ["city_tour_transport", "Тур по городу"],
  ["mountain_tour_transport", "Тур в горы"],
  ["desert_tour_transport", "Пустынный тур"],
  ["safari_tour_transport", "Сафари-тур"],
  ["one_way_transfer", "Трансфер в одну сторону"],
  ["dinner_transfer", "Трансфер на ужин"],
  ["border_transfer", "Междугородний трансфер"],
];
const LABELS = Object.fromEntries([...GUIDE_CATEGORIES, ...TRANSPORT_CATEGORIES]);
const transportCategory = (value) => TRANSPORT_CATEGORIES.some(([key]) => key === value);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(number(value));

async function fetchJSON(path, init = {}) {
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") || "" : "";
  const response = await fetch(new URL(path, base).toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

const blankForm = () => ({
  category: "",
  title: "",
  citySlug: "",
  seats: "",
  vehicleModel: "",
  pricingMode: "fixed",
  price: "",
  minimumHours: "2",
  halfDayHours: "4",
  halfDayPrice: "",
  fullDayHours: "8",
  fullDayPrice: "",
  extraHourPrice: "",
});

function pricingLabel(service) {
  const details = service?.details || {};
  if (details.pricing_mode === "hourly") return `${money(service.price)} UZS / час · минимум ${details.minimum_hours || 1} ч.`;
  if (details.pricing_mode === "packages") {
    return `${details.half_day_hours || 4} ч. — ${money(details.half_day_price)} UZS · ${details.full_day_hours || 8} ч. — ${money(details.full_day_price)} UZS`;
  }
  return `${money(service?.price)} UZS за услугу`;
}

function calculatedPreview(form) {
  if (form.pricingMode === "hourly") {
    const duration = Math.max(5, number(form.minimumHours) || 1);
    return { duration: `${duration} часов`, rule: `${money(form.price)} × ${duration}`, total: number(form.price) * duration };
  }
  if (form.pricingMode === "packages") {
    const duration = 5;
    const halfHours = Math.max(1, number(form.halfDayHours) || 4);
    const fullHours = Math.max(halfHours, number(form.fullDayHours) || 8);
    if (duration <= halfHours) return { duration: `${duration} часов`, rule: "Неполный день", total: number(form.halfDayPrice) };
    if (duration <= fullHours) return { duration: `${duration} часов`, rule: "Полный день", total: number(form.fullDayPrice) };
    return { duration: `${duration} часов`, rule: "Полный день + доп. часы", total: number(form.fullDayPrice) + (duration - fullHours) * number(form.extraHourPrice) };
  }
  return { duration: "Выбранное событие", rule: "Цена за услугу", total: number(form.price) };
}

export default function ProviderServicesWorkspace({ providerId, providerType }) {
  const { t } = useTranslation();
  const pid = Number(providerId);
  const [rows, setRows] = useState([]);
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const fleet = useMemo(() => (Array.isArray(profile?.car_fleet) ? profile.car_fleet.filter((car) => car && car.is_active !== false) : []), [profile]);
  const cities = useMemo(() => (Array.isArray(profile?.city_slugs) ? profile.city_slugs : []), [profile]);
  const guideCanDrive = providerType === "guide" && fleet.length > 0;
  const isTransport = transportCategory(form.category);
  const preview = calculatedPreview(form);

  const categoryGroups = useMemo(() => {
    const groups = [];
    if (providerType !== "transport") groups.push({ label: "Услуги гида", items: GUIDE_CATEGORIES });
    if (providerType === "transport" || providerType === "agent" || guideCanDrive) {
      groups.push({ label: providerType === "guide" ? "Гид с транспортом" : "Транспорт", items: TRANSPORT_CATEGORIES });
    }
    return groups;
  }, [providerType, guideCanDrive]);

  async function load() {
    if (!pid) return;
    setLoading(true);
    try {
      const [services, me] = await Promise.all([
        fetchJSON(`/api/providers/${pid}/services`),
        fetchJSON("/api/providers/profile").catch(() => ({})),
      ]);
      setRows(Array.isArray(services) ? services : []);
      setProfile(me || {});
    } catch (error) {
      tError(`Не удалось загрузить услуги: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [pid]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const applyVehicle = (value) => {
    const car = fleet.find((item, index) => String(item.id ?? index) === value);
    if (!car) return;
    setForm((current) => ({ ...current, vehicleModel: String(car.model || ""), seats: car.seats ? String(car.seats) : "" }));
  };

  function validate(current) {
    if (!current.category) return "Выберите категорию услуги";
    if (transportCategory(current.category) && !String(current.vehicleModel || "").trim()) return "Укажите автомобиль";
    if (current.pricingMode === "packages" && (number(current.halfDayPrice) <= 0 || number(current.fullDayPrice) <= 0)) return "Укажите стоимость неполного и полного дня";
    if (current.pricingMode !== "packages" && number(current.price) <= 0) return current.pricingMode === "hourly" ? "Укажите цену за час" : "Укажите цену услуги";
    return "";
  }

  const detailsFrom = (current, existing = {}) => ({
    ...existing,
    ...(current.citySlug ? { city_slug: current.citySlug } : {}),
    ...(transportCategory(current.category)
      ? { seats: Math.max(1, number(current.seats) || 1), vehicle_model: String(current.vehicleModel || "" ).trim(), max_guests: null }
      : { seats: null, vehicle_model: null, max_guests: number(current.seats) > 0 ? number(current.seats) : null }),
    pricing_mode: current.pricingMode,
    minimum_hours: Math.max(1, number(current.minimumHours) || 1),
    ...(current.pricingMode === "packages" ? {
      half_day_hours: Math.max(1, number(current.halfDayHours) || 4),
      half_day_price: number(current.halfDayPrice),
      full_day_hours: Math.max(1, number(current.fullDayHours) || 8),
      full_day_price: number(current.fullDayPrice),
      extra_hour_price: number(current.extraHourPrice),
    } : {}),
  });

  async function addService() {
    const error = validate(form);
    if (error) return tError(error);
    setSaving(true);
    try {
      const created = await fetchJSON(`/api/providers/${pid}/services`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          title: form.title.trim() || LABELS[form.category],
          price: form.pricingMode === "packages" ? number(form.halfDayPrice) : number(form.price),
          currency: "UZS",
          details: detailsFrom(form),
        }),
      });
      setRows((current) => [created, ...current]);
      setForm(blankForm());
      tSuccess("Услуга добавлена");
    } catch (error) {
      tError(`Не удалось добавить услугу: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function patchService(id, patch) {
    try {
      const updated = await fetchJSON(`/api/providers/${pid}/services/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setRows((current) => current.map((row) => row.id === id ? updated : row));
      return updated;
    } catch (error) {
      tError(`Не удалось обновить услугу: ${error.message}`);
      throw error;
    }
  }

  function beginEdit(row) {
    const details = row.details || {};
    setEditingId(row.id);
    setDraft({
      category: row.category,
      title: row.title || "",
      citySlug: details.city_slug || "",
      seats: details.seats || "",
      vehicleModel: details.vehicle_model || "",
      pricingMode: details.pricing_mode || "fixed",
      price: row.price || "",
      minimumHours: details.minimum_hours || "2",
      halfDayHours: details.half_day_hours || "4",
      halfDayPrice: details.half_day_price || "",
      fullDayHours: details.full_day_hours || "8",
      fullDayPrice: details.full_day_price || "",
      extraHourPrice: details.extra_hour_price || "",
    });
  }

  async function saveEdit(row) {
    const error = validate(draft);
    if (error) return tError(error);
    setSaving(true);
    try {
      await patchService(row.id, {
        title: draft.title.trim() || LABELS[row.category],
        price: draft.pricingMode === "packages" ? number(draft.halfDayPrice) : number(draft.price),
        details: detailsFrom(draft, row.details || {}),
      });
      setEditingId(null);
      setDraft(null);
      tSuccess("Изменения сохранены");
    } finally {
      setSaving(false);
    }
  }

  async function removeService(row) {
    if (!confirm(`Удалить услугу «${row.title || LABELS[row.category]}»?`)) return;
    try {
      await fetchJSON(`/api/providers/${pid}/services/${row.id}`, { method: "DELETE" });
      setRows((current) => current.filter((item) => item.id !== row.id));
      tSuccess("Услуга удалена");
    } catch (error) {
      tError(`Не удалось удалить услугу: ${error.message}`);
    }
  }

  function openSuggestions() {
    const existing = new Set(rows.map((row) => `${row.category}:${row.details?.city_slug || ""}:${row.details?.vehicle_model || ""}`));
    const candidates = [];
    for (const city of cities) {
      if (providerType !== "transport") candidates.push({ category: "city_tour_guide", title: `Городская экскурсия · ${city}`, city });
      for (const car of fleet) candidates.push({ category: "city_tour_transport", title: `Тур по городу · ${city} · ${car.model || "автомобиль"}`, city, car });
    }
    const unique = candidates.filter((item) => !existing.has(`${item.category}:${item.city}:${item.car?.model || ""}`));
    setSuggestions(unique.map((item, index) => ({ ...item, id: index, selected: true })));
    setSuggestionsOpen(true);
  }

  async function createSuggestions() {
    const selected = suggestions.filter((item) => item.selected);
    if (!selected.length) return tInfo("Выберите хотя бы одну услугу");
    setSaving(true);
    try {
      const body = { items: selected.map((item) => ({
        category: item.category,
        title: item.title,
        price: 0,
        currency: "UZS",
        details: {
          city_slug: item.city,
          ...(item.car ? { seats: number(item.car.seats) || undefined, vehicle_model: item.car.model || "" } : {}),
          pricing_mode: "fixed",
        },
      })) };
      await fetchJSON(`/api/providers/${pid}/services/bulk`, { method: "POST", body: JSON.stringify(body) });
      setSuggestionsOpen(false);
      await load();
      tSuccess("Черновики услуг созданы. Укажите тарифы перед публикацией.");
    } catch (error) {
      tError(`Не удалось создать услуги: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => rows.filter((row) => {
    const text = `${row.title || ""} ${LABELS[row.category] || ""}`.toLowerCase();
    const matchesText = text.includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? row.is_active : !row.is_active);
    return matchesText && matchesStatus;
  }), [rows, query, statusFilter]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Услуги для Tour Builder</h2>
          <p className="mt-1 text-sm text-slate-500">Настройте услуги и правила расчёта цены для турагентов.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} disabled={loading} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Обновить</button>
          <button type="button" onClick={openSuggestions} className="h-10 rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-700 hover:bg-orange-100">Предложить из профиля</button>
        </div>
      </header>

      <section className="border-b border-slate-200 px-5 py-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-950">Новая услуга</h3>
            <p className="text-sm text-slate-500">Что вы оказываете, где, на каких условиях и по какой цене.</p>
          </div>
          <span className="text-sm font-medium text-slate-500">Основные данные</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">Категория
            <select value={form.category} onChange={(event) => setField("category", event.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
              <option value="">Выберите категорию</option>
              {categoryGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">Название
            <input value={form.title} onChange={(event) => setField("title", event.target.value)} placeholder={form.category ? LABELS[form.category] : "Например, вечерняя экскурсия"} className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>
          <label className="text-sm font-semibold text-slate-700">Город
            {cities.length ? <select value={form.citySlug} onChange={(event) => setField("citySlug", event.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal"><option value="">Все города профиля</option>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select> : <input value={form.citySlug} onChange={(event) => setField("citySlug", event.target.value)} placeholder="Город услуги" className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" />}
          </label>
          {!isTransport && <label className="text-sm font-semibold text-slate-700">Максимум гостей
            <input inputMode="numeric" value={form.seats} onChange={(event) => setField("seats", event.target.value)} placeholder="Без ограничения" className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>}
        </div>

        {isTransport && <div className="mt-4 grid gap-4 rounded-md bg-slate-50 p-4 md:grid-cols-3">
          {fleet.length > 0 && <label className="text-sm font-semibold text-slate-700">Автомобиль из профиля
            <select defaultValue="" onChange={(event) => applyVehicle(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal"><option value="">Выберите автомобиль</option>{fleet.map((car, index) => <option key={car.id || index} value={String(car.id ?? index)}>{car.model || "Автомобиль"} · {car.seats || "?"} мест</option>)}</select>
          </label>}
          <label className="text-sm font-semibold text-slate-700">Модель автомобиля
            <VehicleModelInput value={form.vehicleModel} onChange={(vehicleModel) => setField("vehicleModel", vehicleModel)} onModelSelect={({ model, seats }) => setForm((current) => ({ ...current, vehicleModel: model, seats: String(seats) }))} placeholder="Начните вводить марку или модель" className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>
          <label className="text-sm font-semibold text-slate-700">Пассажирских мест
            <input type="number" min="1" value={form.seats} onChange={(event) => setField("seats", event.target.value)} placeholder="7" className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>
        </div>}

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="mb-3"><h3 className="font-bold text-slate-950">Тариф</h3><p className="text-sm text-slate-500">Tour Builder рассчитает стоимость по времени события.</p></div>
          <div className="inline-flex max-w-full flex-wrap rounded-md border border-slate-300 bg-slate-50 p-1" role="group" aria-label="Тип тарифа">
            {[['fixed','За услугу'],['hourly','За час'],['packages','Пакеты']].map(([key,label]) => <button key={key} type="button" onClick={() => setField("pricingMode", key)} className={`h-9 rounded px-4 text-sm font-semibold ${form.pricingMode === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white'}`}>{label}</button>)}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div>
              {form.pricingMode === "fixed" && <div className="grid gap-4 sm:grid-cols-2"><MoneyField label="Цена за услугу" value={form.price} onChange={(value) => setField("price", value)} /><ReadOnlyCurrency /></div>}
              {form.pricingMode === "hourly" && <div className="grid gap-4 sm:grid-cols-3"><MoneyField label="Цена за час" value={form.price} onChange={(value) => setField("price", value)} /><NumberField label="Минимальный заказ, часов" value={form.minimumHours} onChange={(value) => setField("minimumHours", value)} /><ReadOnlyCurrency /></div>}
              {form.pricingMode === "packages" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><NumberField label="Неполный день, часов" value={form.halfDayHours} onChange={(value) => setField("halfDayHours", value)} /><MoneyField label="Цена неполного дня" value={form.halfDayPrice} onChange={(value) => setField("halfDayPrice", value)} /><NumberField label="Полный день, часов" value={form.fullDayHours} onChange={(value) => setField("fullDayHours", value)} /><MoneyField label="Цена полного дня" value={form.fullDayPrice} onChange={(value) => setField("fullDayPrice", value)} /><MoneyField label="Дополнительный час" value={form.extraHourPrice} onChange={(value) => setField("extraHourPrice", value)} /></div>}
            </div>
            <aside className="border-l-4 border-orange-500 bg-orange-50 px-4 py-3">
              <div className="text-xs font-bold uppercase text-orange-700">Как увидит турагент</div>
              <div className="mt-1 font-semibold text-slate-950">{form.title || LABELS[form.category] || "Название услуги"}</div>
              <div className="mt-2 text-sm text-slate-600">Пример: {preview.duration} · {preview.rule}</div>
              <div className="mt-1 text-xl font-bold text-slate-950">{money(preview.total)} UZS</div>
            </aside>
          </div>
          <div className="mt-5 flex justify-end"><button type="button" onClick={addService} disabled={saving} className="h-11 rounded-md bg-orange-600 px-6 font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{saving ? "Сохранение..." : "Добавить услугу"}</button></div>
        </div>
      </section>

      <section className="px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="font-bold text-slate-950">Мои услуги</h3><p className="text-sm text-slate-500">{rows.length} услуг · {rows.filter((row) => row.is_active).length} включено</p></div>
          <div className="flex flex-wrap gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти услугу" className="h-10 min-w-56 rounded-md border border-slate-300 px-3 text-sm" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="all">Все</option><option value="active">Включённые</option><option value="inactive">Выключенные</option></select></div>
        </div>

        <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
          {loading ? <div className="py-8 text-center text-slate-500">Загрузка...</div> : filtered.length === 0 ? <div className="py-8 text-center text-slate-500">Услуги не найдены</div> : filtered.map((row) => {
            const expanded = editingId === row.id;
            return <div key={row.id} className="py-4">
              <div className="grid items-center gap-4 md:grid-cols-[minmax(240px,1.5fr)_minmax(220px,1fr)_120px_auto]">
                <div><div className="font-semibold text-slate-950">{row.title || LABELS[row.category] || row.category}</div><div className="mt-1 text-sm text-slate-500">{LABELS[row.category] || row.category}{row.details?.city_slug ? ` · ${row.details.city_slug}` : ""}{row.details?.vehicle_model ? ` · ${row.details.vehicle_model}` : ""}{row.details?.seats ? ` · ${row.details.seats} мест` : ""}</div></div>
                <div><div className="font-semibold text-slate-900">{pricingLabel(row)}</div><div className="text-xs text-slate-500">Тариф Tour Builder</div></div>
                <div className={`text-sm font-semibold ${row.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>{row.is_active ? "Включена" : "Выключена"}</div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => expanded ? (setEditingId(null), setDraft(null)) : beginEdit(row)} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{expanded ? "Закрыть" : "Редактировать"}</button><button type="button" onClick={() => patchService(row.id, { is_active: !row.is_active })} className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-600">{row.is_active ? "Выключить" : "Включить"}</button></div>
              </div>
              {expanded && draft && <div className="mt-4 border-l-4 border-slate-300 bg-slate-50 p-4"><div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-semibold text-slate-600">Название<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 h-10 w-full rounded border border-slate-300 px-3 text-sm font-normal" /></label>{draft.pricingMode !== 'packages' && <MoneyField label={draft.pricingMode === 'hourly' ? 'Цена за час' : 'Цена услуги'} value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} />}<label className="text-xs font-semibold text-slate-600">Тип тарифа<select value={draft.pricingMode} onChange={(event) => setDraft({ ...draft, pricingMode: event.target.value })} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal"><option value="fixed">За услугу</option><option value="hourly">За час</option><option value="packages">Пакеты</option></select></label></div>{draft.pricingMode === 'packages' && <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><NumberField label="Неполный день, часов" value={draft.halfDayHours} onChange={(value) => setDraft({ ...draft, halfDayHours: value })} /><MoneyField label="Цена неполного дня" value={draft.halfDayPrice} onChange={(value) => setDraft({ ...draft, halfDayPrice: value })} /><NumberField label="Полный день, часов" value={draft.fullDayHours} onChange={(value) => setDraft({ ...draft, fullDayHours: value })} /><MoneyField label="Цена полного дня" value={draft.fullDayPrice} onChange={(value) => setDraft({ ...draft, fullDayPrice: value })} /><MoneyField label="Дополнительный час" value={draft.extraHourPrice} onChange={(value) => setDraft({ ...draft, extraHourPrice: value })} /></div>}<div className="mt-4 flex justify-between gap-3"><button type="button" onClick={() => removeService(row)} className="h-10 rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">Удалить</button><button type="button" onClick={() => saveEdit(row)} disabled={saving} className="h-10 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">Сохранить изменения</button></div></div>}
            </div>;
          })}
        </div>
      </section>

      {suggestionsOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-2xl rounded-lg bg-white shadow-xl"><div className="border-b border-slate-200 px-5 py-4"><h3 className="text-lg font-bold text-slate-950">Предложения из профиля</h3><p className="mt-1 text-sm text-slate-500">Выберите черновики услуг. Дубликаты уже исключены.</p></div><div className="max-h-[55vh] overflow-auto p-5">{suggestions.length ? <div className="space-y-2">{suggestions.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50"><input type="checkbox" checked={item.selected} onChange={(event) => setSuggestions((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked } : candidate))} className="mt-1" /><div><div className="font-semibold text-slate-900">{item.title}</div><div className="text-sm text-slate-500">Тариф потребуется заполнить после создания</div></div></label>)}</div> : <div className="py-8 text-center text-slate-500">Новых предложений нет. Проверьте города и автомобили в профиле.</div>}</div><div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => setSuggestionsOpen(false)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold">Отмена</button><button type="button" onClick={createSuggestions} disabled={saving || !suggestions.some((item) => item.selected)} className="h-10 rounded-md bg-orange-600 px-5 text-sm font-semibold text-white disabled:opacity-50">Создать выбранные</button></div></div></div>}
    </div>
  );
}

function MoneyField({ label, value, onChange }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<div className="mt-1 flex h-11 overflow-hidden rounded-md border border-slate-300 bg-white"><input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0" className="min-w-0 flex-1 px-3 font-normal outline-none" /><span className="flex items-center border-l border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">UZS</span></div></label>;
}
function NumberField({ label, value, onChange }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" /></label>;
}
function ReadOnlyCurrency() {
  return <label className="text-sm font-semibold text-slate-700">Валюта<input value="UZS" readOnly className="mt-1 h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 font-normal text-slate-600" /></label>;
}