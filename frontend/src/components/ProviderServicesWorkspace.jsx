import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Layers3, MapPin, Plus, RefreshCw, WalletCards } from "lucide-react";
import { tError, tSuccess } from "../shared/toast";
import {
  GUIDE_SERVICE_GROUPS,
  TRANSPORT_SERVICE_GROUPS,
  TRANSPORT_CATEGORY_IDS,
  PROVIDER_SERVICE_LABELS as LABELS,
  findServiceGroup,
} from "../config/providerServiceCatalog";

const transportCategory = (value) => TRANSPORT_CATEGORY_IDS.includes(value);
const INTERCITY_CATEGORIES = new Set(["intercity_transfer", "border_transfer", "one_way_transfer"]);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(number(value));
const cityLabel = (value) => String(value || "").trim().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());

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
  catalogGroup: "",
  category: "",
  title: "",
  citySlug: "",
  originCity: "",
  destinationCity: "",
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

  const fleet = useMemo(() => (Array.isArray(profile?.car_fleet) ? profile.car_fleet.filter((car) => car && car.is_active !== false) : []), [profile]);
  const cities = useMemo(() => (Array.isArray(profile?.city_slugs) ? profile.city_slugs : []), [profile]);
  const isTransport = transportCategory(form.category);
  const isIntercity = INTERCITY_CATEGORIES.has(form.category);
  const preview = calculatedPreview(form);
  const serviceTitle = (current) => INTERCITY_CATEGORIES.has(current.category)
    ? `${LABELS[current.category] || "Междугородняя услуга"} · ${cityLabel(current.originCity) || "Откуда"} → ${cityLabel(current.destinationCity) || "Куда"}`
    : `${LABELS[current.category] || "Услуга"}${current.citySlug ? ` · ${cityLabel(current.citySlug)}` : ""}`;

  const categoryGroups = useMemo(() => {
    if (providerType === "transport") return TRANSPORT_SERVICE_GROUPS;
    if (providerType === "guide") return [...GUIDE_SERVICE_GROUPS, ...TRANSPORT_SERVICE_GROUPS];
    return [...GUIDE_SERVICE_GROUPS, ...TRANSPORT_SERVICE_GROUPS];
  }, [providerType]);
  const activeCategoryGroup = categoryGroups.find((group) => group.id === form.catalogGroup)
    || findServiceGroup(form.category, categoryGroups);

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
    if (!cities.length) return "Сначала добавьте города в профиле";
    if (INTERCITY_CATEGORIES.has(current.category)) {
      if (!current.originCity || !current.destinationCity) return "Выберите города отправления и назначения";
      if (current.originCity === current.destinationCity) return "Города отправления и назначения должны отличаться";
    } else if (!current.citySlug) return "Выберите город услуги";
    if (transportCategory(current.category) && !String(current.vehicleModel || "").trim()) return "Укажите автомобиль";
    if (current.pricingMode === "packages" && (number(current.halfDayPrice) <= 0 || number(current.fullDayPrice) <= 0)) return "Укажите стоимость неполного и полного дня";
    if (current.pricingMode !== "packages" && number(current.price) <= 0) return current.pricingMode === "hourly" ? "Укажите цену за час" : "Укажите цену услуги";
    return "";
  }

  const detailsFrom = (current, existing = {}) => ({
    ...existing,
    city_slug: INTERCITY_CATEGORIES.has(current.category)
      ? String(current.originCity || "").trim() || null
      : String(current.citySlug || "").trim() || null,
    origin_city: INTERCITY_CATEGORIES.has(current.category) ? String(current.originCity || "").trim() || null : null,
    destination_city: INTERCITY_CATEGORIES.has(current.category) ? String(current.destinationCity || "").trim() || null : null,
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
    const duplicate = rows.some((row) => {
      const details = row.details || {};
      return row.category === form.category
        && String(details.city_slug || "") === String(isIntercity ? form.originCity : form.citySlug)
        && String(details.destination_city || "") === String(isIntercity ? form.destinationCity : "")
        && String(details.vehicle_model || row.vehicle_model || "") === String(form.vehicleModel || "");
    });
    if (duplicate) return tError("Такой тариф уже создан. Измените существующую услугу.");
    setSaving(true);
    try {
      const created = await fetchJSON(`/api/providers/${pid}/services`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          title: serviceTitle(form),
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
    const group = findServiceGroup(row.category, categoryGroups);
    setEditingId(row.id);
    setDraft({
      catalogGroup: group?.id || "",
      category: row.category,
      title: row.title || "",
      citySlug: details.city_slug || "",
      originCity: details.origin_city || details.city_slug || "",
      destinationCity: details.destination_city || "",
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
        category: draft.category,
        title: INTERCITY_CATEGORIES.has(draft.category)
          ? `${LABELS[draft.category]} · ${draft.originCity} → ${draft.destinationCity}`
          : `${LABELS[draft.category]} · ${draft.citySlug}`,
        price: draft.pricingMode === "packages" ? number(draft.halfDayPrice) : number(draft.price),
        details: detailsFrom(draft, row.details || {}),
        vehicle_model: transportCategory(draft.category) ? String(draft.vehicleModel || "").trim() : null,
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

  const filtered = useMemo(() => rows.filter((row) => {
    const text = `${row.title || ""} ${LABELS[row.category] || ""}`.toLowerCase();
    const matchesText = text.includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? row.is_active : !row.is_active);
    return matchesText && matchesStatus;
  }), [rows, query, statusFilter]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Каталог и тарифы</h2>
          <p className="mt-0.5 text-sm text-slate-500">{rows.length} услуг · {rows.filter((row) => row.is_active).length} доступны турагентам</p>
        </div>
        <button type="button" onClick={load} disabled={loading} title="Обновить список" className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
      </header>

      <section className="border-b border-slate-200 bg-slate-50 px-5 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase text-orange-600">Новый тариф</div>
            <h3 className="mt-1 text-xl font-bold text-slate-950">Добавьте услугу в Tour Builder</h3>
            <p className="mt-1 text-sm text-slate-500">Три шага: услуга, зона работы и стоимость.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><CheckCircle2 size={16} className="text-emerald-600" />Публикуется сразу после добавления</div>
        </div>

        {!cities.length && <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Добавьте рабочие локации в профиле, чтобы создать тариф.</div>}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <FormStep icon={Layers3} number="1" title="Выберите услугу" description="Каталог одинаков для всех поставщиков">
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField label="Категория" value={activeCategoryGroup?.id || ""} onChange={(value) => setForm((current) => ({ ...current, catalogGroup: value, category: "", title: "" }))} options={categoryGroups.map((group) => ({ value: group.id, label: group.label }))} placeholder="Выберите категорию" />
                <SelectField label="Услуга" value={form.category} disabled={!activeCategoryGroup} onChange={(value) => setField("category", value)} options={(activeCategoryGroup?.services || []).map((service) => ({ value: service.id, label: service.label }))} placeholder="Выберите конкретную услугу" />
              </div>
            </FormStep>

            <FormStep icon={MapPin} number="2" title={isIntercity ? "Укажите маршрут" : "Выберите локацию"} description="Доступны только города из вашего профиля">
              <div className={`grid gap-4 ${isIntercity ? "md:grid-cols-2" : "md:max-w-md"}`}>
                {isIntercity ? <>
                  <CitySelect label="Откуда" value={form.originCity} cities={cities} onChange={(value) => setForm((current) => ({ ...current, originCity: value, destinationCity: current.destinationCity === value ? "" : current.destinationCity }))} />
                  <CitySelect label="Куда" value={form.destinationCity} cities={cities.filter((city) => city !== form.originCity)} onChange={(value) => setField("destinationCity", value)} />
                </> : <CitySelect label="Город услуги" value={form.citySlug} cities={cities} onChange={(value) => setField("citySlug", value)} />}
              </div>
              {isTransport && <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
                {fleet.length > 0 ? <SelectField label="Автомобиль из профиля" value="" onChange={applyVehicle} options={fleet.map((car, index) => ({ value: String(car.id ?? index), label: `${car.model || "Автомобиль"} · ${car.seats || "?"} мест` }))} placeholder="Выберите автомобиль" /> : <div className="md:col-span-3 text-sm text-amber-700">Добавьте автомобиль в автопарк профиля.</div>}
                <ReadOnlyValue label="Модель" value={form.vehicleModel || "Не выбрана"} />
                <ReadOnlyValue label="Вместимость" value={form.seats ? `${form.seats} мест` : "—"} />
              </div>}
            </FormStep>

            <FormStep icon={WalletCards} number="3" title="Укажите стоимость" description="Tour Builder рассчитает итог по длительности">
              <div className="mb-4 inline-flex max-w-full flex-wrap rounded-md border border-slate-300 bg-slate-50 p-1" role="group" aria-label="Тип тарифа">
                {[['fixed','За услугу'],['hourly','За час'],['packages','Пакеты']].map(([key,label]) => <button key={key} type="button" onClick={() => setField("pricingMode", key)} className={`h-9 rounded px-4 text-sm font-semibold ${form.pricingMode === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white'}`}>{label}</button>)}
              </div>
              {form.pricingMode === "fixed" && <div className="grid gap-4 sm:grid-cols-2"><MoneyField label="Цена за услугу" value={form.price} onChange={(value) => setField("price", value)} /><ReadOnlyCurrency /></div>}
              {form.pricingMode === "hourly" && <div className="grid gap-4 sm:grid-cols-3"><MoneyField label="Цена за час" value={form.price} onChange={(value) => setField("price", value)} /><NumberField label="Минимальный заказ, часов" value={form.minimumHours} onChange={(value) => setField("minimumHours", value)} /><ReadOnlyCurrency /></div>}
              {form.pricingMode === "packages" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><NumberField label="Неполный день, часов" value={form.halfDayHours} onChange={(value) => setField("halfDayHours", value)} /><MoneyField label="Цена неполного дня" value={form.halfDayPrice} onChange={(value) => setField("halfDayPrice", value)} /><NumberField label="Полный день, часов" value={form.fullDayHours} onChange={(value) => setField("fullDayHours", value)} /><MoneyField label="Цена полного дня" value={form.fullDayPrice} onChange={(value) => setField("fullDayPrice", value)} /><MoneyField label="Дополнительный час" value={form.extraHourPrice} onChange={(value) => setField("extraHourPrice", value)} /></div>}
            </FormStep>
          </div>

          <aside className="overflow-hidden rounded-lg bg-slate-950 text-white xl:sticky xl:top-4">
            <div className="border-b border-white/10 px-5 py-4"><div className="text-xs font-bold uppercase text-orange-400">Предпросмотр</div><div className="mt-1 text-xs text-slate-400">Так тариф увидит турагент</div></div>
            <div className="px-5 py-5"><div className="text-lg font-bold leading-snug">{serviceTitle(form)}</div><div className="mt-4 flex items-center gap-2 text-sm text-slate-300"><MapPin size={16} />{isIntercity ? `${cityLabel(form.originCity) || "Откуда"} → ${cityLabel(form.destinationCity) || "Куда"}` : cityLabel(form.citySlug) || "Локация не выбрана"}</div><div className="mt-6 border-t border-white/10 pt-4"><div className="text-xs uppercase text-slate-400">Расчёт для примера</div><div className="mt-1 text-sm text-slate-300">{preview.duration} · {preview.rule}</div><div className="mt-2 text-2xl font-bold">{money(preview.total)} <span className="text-base font-semibold text-slate-300">UZS</span></div></div></div>
            <div className="px-5 pb-5"><button type="button" onClick={addService} disabled={saving || !cities.length} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-5 font-bold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={19} />{saving ? "Сохранение..." : "Добавить тариф"}</button></div>
          </aside>
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
            const draftCategoryGroup = expanded && draft
              ? categoryGroups.find((group) => group.id === draft.catalogGroup) || findServiceGroup(draft.category, categoryGroups)
              : null;
            const draftIsTransport = Boolean(expanded && draft && transportCategory(draft.category));
            const draftIsIntercity = Boolean(expanded && draft && INTERCITY_CATEGORIES.has(draft.category));
            return <div key={row.id} className="py-4">
              <div className="grid items-center gap-4 md:grid-cols-[minmax(240px,1.5fr)_minmax(220px,1fr)_120px_auto]">
                <div><div className="font-semibold text-slate-950">{row.title || LABELS[row.category] || row.category}</div><div className="mt-1 text-sm text-slate-500">{LABELS[row.category] || row.category}{row.details?.destination_city ? ` · ${row.details.origin_city || row.details.city_slug} → ${row.details.destination_city}` : row.details?.city_slug ? ` · ${row.details.city_slug}` : ""}{row.details?.vehicle_model ? ` · ${row.details.vehicle_model}` : ""}{row.details?.seats ? ` · ${row.details.seats} мест` : ""}</div></div>
                <div><div className="font-semibold text-slate-900">{pricingLabel(row)}</div><div className="text-xs text-slate-500">Тариф Tour Builder</div></div>
                <div className={`text-sm font-semibold ${row.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>{row.is_active ? "Включена" : "Выключена"}</div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => expanded ? (setEditingId(null), setDraft(null)) : beginEdit(row)} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{expanded ? "Закрыть" : "Редактировать"}</button><button type="button" onClick={() => patchService(row.id, { is_active: !row.is_active })} className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-600">{row.is_active ? "Выключить" : "Включить"}</button></div>
              </div>
              {expanded && draft && (
                <div className="mt-4 border-l-4 border-slate-400 bg-slate-50 p-4">
                  <div className="mb-4">
                    <h4 className="font-bold text-slate-950">Основные данные</h4>
                    <p className="text-xs text-slate-500">Все поля доступны так же, как при создании услуги.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs font-semibold text-slate-600">Категория услуги
                      <select
                        value={draftCategoryGroup?.id || ""}
                        onChange={(event) => setDraft({ ...draft, catalogGroup: event.target.value, category: "", title: "" })}
                        className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal"
                      >
                        <option value="">Выберите категорию</option>
                        {categoryGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Конкретная услуга
                      <select
                        value={draft.category}
                        disabled={!draftCategoryGroup}
                        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                        className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal disabled:bg-slate-100"
                      >
                        <option value="">Выберите услугу</option>
                        {(draftCategoryGroup?.services || []).map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
                      </select>
                    </label>
                    {draftIsIntercity ? <>
                      <CitySelect compact label="Откуда" value={draft.originCity} cities={cities} onChange={(value) => setDraft({ ...draft, originCity: value, destinationCity: draft.destinationCity === value ? "" : draft.destinationCity })} />
                      <CitySelect compact label="Куда" value={draft.destinationCity} cities={cities.filter((city) => city !== draft.originCity)} onChange={(value) => setDraft({ ...draft, destinationCity: value })} />
                    </> : <CitySelect compact label="Город услуги" value={draft.citySlug} cities={cities} onChange={(value) => setDraft({ ...draft, citySlug: value })} />}
                  </div>

                  {draftIsTransport && (
                    <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-3">
                      {fleet.length > 0 && <label className="text-xs font-semibold text-slate-600">Автомобиль из профиля
                        <select defaultValue="" onChange={(event) => {
                          const car = fleet.find((item, index) => String(item.id ?? index) === event.target.value);
                          if (car) setDraft({ ...draft, vehicleModel: String(car.model || ""), seats: car.seats ? String(car.seats) : "" });
                        }} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal">
                          <option value="">Выберите автомобиль</option>
                          {fleet.map((car, index) => <option key={car.id || index} value={String(car.id ?? index)}>{car.model || "Автомобиль"} · {car.seats || "?"} мест</option>)}
                        </select>
                      </label>}
                      <ReadOnlyValue compact label="Модель" value={draft.vehicleModel || "Выберите автомобиль"} />
                      <ReadOnlyValue compact label="Пассажирских мест" value={draft.seats || "—"} />
                    </div>
                  )}

                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <h4 className="mb-3 font-bold text-slate-950">Тариф</h4>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold text-slate-600">Тип тарифа
                        <select value={draft.pricingMode} onChange={(event) => setDraft({ ...draft, pricingMode: event.target.value })} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal">
                          <option value="fixed">За услугу</option>
                          <option value="hourly">За час</option>
                          <option value="packages">Пакеты</option>
                        </select>
                      </label>
                      {draft.pricingMode !== "packages" && <MoneyField label={draft.pricingMode === "hourly" ? "Цена за час" : "Цена услуги"} value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} />}
                      {draft.pricingMode === "hourly" && <NumberField label="Минимальный заказ, часов" value={draft.minimumHours} onChange={(value) => setDraft({ ...draft, minimumHours: value })} />}
                    </div>
                    {draft.pricingMode === "packages" && <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><NumberField label="Неполный день, часов" value={draft.halfDayHours} onChange={(value) => setDraft({ ...draft, halfDayHours: value })} /><MoneyField label="Цена неполного дня" value={draft.halfDayPrice} onChange={(value) => setDraft({ ...draft, halfDayPrice: value })} /><NumberField label="Полный день, часов" value={draft.fullDayHours} onChange={(value) => setDraft({ ...draft, fullDayHours: value })} /><MoneyField label="Цена полного дня" value={draft.fullDayPrice} onChange={(value) => setDraft({ ...draft, fullDayPrice: value })} /><MoneyField label="Дополнительный час" value={draft.extraHourPrice} onChange={(value) => setDraft({ ...draft, extraHourPrice: value })} /></div>}
                  </div>
                  <div className="mt-5 flex justify-between gap-3 border-t border-slate-200 pt-4">
                    <button type="button" onClick={() => removeService(row)} className="h-10 rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">Удалить</button>
                    <button type="button" onClick={() => saveEdit(row)} disabled={saving} className="h-10 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">Сохранить изменения</button>
                  </div>
                </div>
              )}
            </div>;
          })}
        </div>
      </section>

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
function FormStep({ icon: Icon, number, title, description, children }) {
  return <section className="border-b border-slate-200 p-5 last:border-b-0"><div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-950 text-white"><Icon size={18} /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-bold text-orange-600">ШАГ {number}</span><h4 className="font-bold text-slate-950">{title}</h4></div><p className="mt-0.5 text-sm text-slate-500">{description}</p></div></div>{children}</section>;
}
function SelectField({ label, value, onChange, options, placeholder, disabled = false }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-400"><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function CitySelect({ label, value, cities, onChange, compact = false }) {
  return <label className={`${compact ? "text-xs text-slate-600" : "text-sm text-slate-700"} font-semibold`}>{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={!cities.length} className={`${compact ? "h-10 text-sm" : "h-11"} mt-1 w-full rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50`}><option value="">Выберите город</option>{cities.map((city) => <option key={city} value={city}>{cityLabel(city)}</option>)}</select></label>;
}
function ReadOnlyValue({ label, value, compact = false }) {
  return <label className={`${compact ? "text-xs text-slate-600" : "text-sm text-slate-700"} font-semibold`}>{label}<div className={`${compact ? "h-10 text-sm" : "h-11"} mt-1 flex items-center rounded-md border border-slate-200 bg-slate-100 px-3 font-normal text-slate-600`}>{value}</div></label>;
}
