import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CarFront, CheckCircle2, Layers3, MapPin, Plus, RefreshCw, Search, Trash2, UserRound, WalletCards, X } from "lucide-react";
import { tError, tSuccess } from "../shared/toast";
import ConfirmModal from "./ConfirmModal";
import {
  GUIDE_SERVICE_GROUPS,
  TRANSPORT_SERVICE_GROUPS,
  TRANSPORT_CATEGORY_IDS,
  PROVIDER_SERVICE_LABELS as LABELS,
  findServiceGroup,
} from "../config/providerServiceCatalog";

const transportCategory = (value) => TRANSPORT_CATEGORY_IDS.includes(value);
const INTERCITY_CATEGORIES = new Set(["intercity_transfer", "border_transfer", "one_way_transfer"]);
const LEGACY_GUIDE_WITH_TRANSPORT = "city_tour_guide_with_transport";
const guideCategory = (value) => GUIDE_SERVICE_GROUPS.some((group) => group.services.some((service) => service.id === value))
  || value === LEGACY_GUIDE_WITH_TRANSPORT;
const catalogCategory = (value) => value === LEGACY_GUIDE_WITH_TRANSPORT ? "city_tour_guide" : value;
const catalogGroup = (value, groups) => findServiceGroup(catalogCategory(value), groups);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(number(value));
const cityLabel = (value) => String(value || "").trim().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
const blankRateVariant = () => ({ id: globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2), audience: "all", validFrom: "", validTo: "", minGuests: "1", maxGuests: "", price: "" });

function validateRateVariants(variants, w) {
  const normalized = (variants || []).map((variant) => ({
    from: variant.validFrom || "0000-01-01",
    to: variant.validTo || "9999-12-31",
    min: Math.max(1, number(variant.minGuests) || 1),
    max: number(variant.maxGuests) > 0 ? number(variant.maxGuests) : Infinity,
    price: number(variant.price),
    audience: variant.audience || "all",
  }));
  for (const variant of normalized) {
    if (variant.price <= 0) return w("validation_condition_price");
    if (variant.from > variant.to) return w("validation_condition_dates");
    if (variant.min > variant.max) return w("validation_condition_guests");
  }
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const dateOverlap = normalized[left].from <= normalized[right].to && normalized[right].from <= normalized[left].to;
      const guestOverlap = normalized[left].min <= normalized[right].max && normalized[right].min <= normalized[left].max;
      const audienceOverlap = normalized[left].audience === "all" || normalized[right].audience === "all" || normalized[left].audience === normalized[right].audience;
      if (dateOverlap && guestOverlap && audienceOverlap) return w("validation_condition_overlap");
    }
  }
  return "";
}

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
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let payload = {};
    try { payload = JSON.parse(raw); } catch { payload = {}; }
    const error = new Error(payload.message || raw || `HTTP ${response.status}`);
    Object.assign(error, payload, { status: response.status });
    throw error;
  }
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
  transportIncluded: false,
  pricingMode: "fixed",
  price: "",
  minimumHours: "2",
  halfDayHours: "4",
  halfDayPrice: "",
  fullDayHours: "8",
  fullDayPrice: "",
  extraHourPrice: "",
  rateVariants: [],
});

function pricingLabel(service, w) {
  const details = service?.details || {};
  if (details.pricing_mode === "hourly") return w("pricing_hourly_summary", { price: money(service.price), hours: details.minimum_hours || 1 });
  if (details.pricing_mode === "packages") {
    return w("pricing_packages_summary", { halfHours: details.half_day_hours || 4, halfPrice: money(details.half_day_price), fullHours: details.full_day_hours || 8, fullPrice: money(details.full_day_price) });
  }
  return w("pricing_fixed_summary", { price: money(service?.price) });
}

function calculatedPreview(form, w) {
  if (form.pricingMode === "hourly") {
    const duration = Math.max(5, number(form.minimumHours) || 1);
    return { duration: w("hours", { count: duration }), rule: `${money(form.price)} × ${duration}`, total: number(form.price) * duration };
  }
  if (form.pricingMode === "packages") {
    const duration = 5;
    const halfHours = Math.max(1, number(form.halfDayHours) || 4);
    const fullHours = Math.max(halfHours, number(form.fullDayHours) || 8);
    if (duration <= halfHours) return { duration: w("hours", { count: duration }), rule: w("half_day"), total: number(form.halfDayPrice) };
    if (duration <= fullHours) return { duration: w("hours", { count: duration }), rule: w("full_day"), total: number(form.fullDayPrice) };
    return { duration: w("hours", { count: duration }), rule: w("full_day_extra"), total: number(form.fullDayPrice) + (duration - fullHours) * number(form.extraHourPrice) };
  }
  return { duration: w("selected_event"), rule: w("price_per_service"), total: number(form.price) };
}

export default function ProviderServicesWorkspace({ providerId, providerType }) {
  const { t } = useTranslation();
  const w = (key, options = {}) => t(`provider_services.workspace.${key}`, options);
  const f = (key, options = {}) => t(`provider_services_filters.${key}`, options);
  const pid = Number(providerId);
  const [rows, setRows] = useState([]);
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState("");

  const fleet = useMemo(() => (Array.isArray(profile?.car_fleet) ? profile.car_fleet.filter((car) => car && car.is_active !== false) : []), [profile]);
  const cities = useMemo(() => (Array.isArray(profile?.city_slugs) ? profile.city_slugs : []), [profile]);
  const isTransport = transportCategory(form.category);
  const isGuideService = guideCategory(form.category);
  const usesVehicle = isTransport || (isGuideService && form.transportIncluded);
  const isIntercity = INTERCITY_CATEGORIES.has(form.category);
  const isNewDestination = isIntercity && Boolean(form.destinationCity)
    && !cities.some((city) => String(city).trim().toLowerCase() === String(form.destinationCity).trim().toLowerCase());
  const preview = calculatedPreview(form, w);
  const serviceLabel = (category) => t(`provider_services.items.${category}`, { defaultValue: LABELS[category] || category || "Услуга" });
  const groupLabel = (group) => t(`provider_services.groups.${group.id}`, { defaultValue: group.label });
  const serviceTitle = (current) => INTERCITY_CATEGORIES.has(current.category)
    ? `${serviceLabel(current.category)} · ${cityLabel(current.originCity) || t("provider_services.from", "Откуда")} → ${cityLabel(current.destinationCity) || t("provider_services.to", "Куда")}`
    : `${serviceLabel(current.category)}${current.citySlug ? ` · ${cityLabel(current.citySlug)}` : ""}`;
  const includesTransport = (service) => service?.category === LEGACY_GUIDE_WITH_TRANSPORT || service?.details?.transport_included === true;
  const storedServiceTitle = (row) => row.details?.destination_city
    ? `${serviceLabel(row.category)} · ${cityLabel(row.details.origin_city || row.details.city_slug)} → ${cityLabel(row.details.destination_city)}`
    : `${serviceLabel(row.category)}${row.details?.city_slug ? ` · ${cityLabel(row.details.city_slug)}` : ""}`;
  const duplicateKey = (service) => {
    const details = service.details || {};
    const normalize = (value) => String(value || "").trim().toLowerCase();
    return [
      normalize(service.category),
      normalize(details.city_slug),
      normalize(details.origin_city),
      normalize(details.destination_city),
      String(includesTransport(service)),
      normalize(details.vehicle_model || service.vehicle_model),
      normalize(details.pricing_mode || "fixed"),
    ].join("\u001f");
  };
  const formDuplicateKey = (current) => duplicateKey({
    category: current.category,
    details: detailsFrom(current),
    vehicle_model: current.vehicleModel,
  });

  const categoryGroups = useMemo(() => {
    if (providerType === "transport") return TRANSPORT_SERVICE_GROUPS;
    if (providerType === "guide") return [...GUIDE_SERVICE_GROUPS, ...TRANSPORT_SERVICE_GROUPS];
    return [...GUIDE_SERVICE_GROUPS, ...TRANSPORT_SERVICE_GROUPS];
  }, [providerType]);
  const activeCategoryGroup = categoryGroups.find((group) => group.id === form.catalogGroup)
    || catalogGroup(form.category, categoryGroups);
  const stepOneComplete = Boolean(form.category);
  const locationComplete = isIntercity
    ? Boolean(form.originCity && form.destinationCity && String(form.originCity).trim().toLowerCase() !== String(form.destinationCity).trim().toLowerCase())
    : Boolean(form.citySlug);
  const vehicleComplete = !usesVehicle || Boolean(String(form.vehicleModel || "").trim());
  const stepTwoComplete = stepOneComplete && locationComplete && vehicleComplete;
  const stepThreeComplete = stepTwoComplete && (form.pricingMode === "packages"
    ? number(form.halfDayPrice) > 0 && number(form.fullDayPrice) > 0
    : number(form.price) > 0);

  async function load() {
    if (!pid) return;
    setLoading(true);
    try {
      const services = await fetchJSON(`/api/providers/${pid}/services`);
      const me = await fetchJSON("/api/providers/profile").catch(() => ({}));
      setRows(Array.isArray(services) ? services : []);
      setProfile(me || {});
    } catch (error) {
      tError(w("load_error", { error: error.message }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [pid]);

  useEffect(() => { setFormError(""); }, [form]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const applyVehicle = (value) => {
    const car = fleet.find((item, index) => String(item.id ?? index) === value);
    if (!car) return;
    setForm((current) => ({ ...current, vehicleModel: String(car.model || ""), seats: car.seats ? String(car.seats) : "" }));
  };

  function validate(current) {
    if (!current.category) return w("validation_category");
    if (!cities.length) return w("validation_profile_cities");
    if (INTERCITY_CATEGORIES.has(current.category)) {
      if (!current.originCity || !current.destinationCity) return w("validation_route");
      if (String(current.originCity).trim().toLowerCase() === String(current.destinationCity).trim().toLowerCase()) return w("validation_different_cities");
    } else if (!current.citySlug) return w("validation_city");
    if ((transportCategory(current.category) || (guideCategory(current.category) && current.transportIncluded)) && !String(current.vehicleModel || "").trim()) return w("validation_vehicle");
    if (current.pricingMode === "packages" && (number(current.halfDayPrice) <= 0 || number(current.fullDayPrice) <= 0)) return w("validation_package_prices");
    if (current.pricingMode !== "packages" && number(current.price) <= 0) return current.pricingMode === "hourly" ? w("validation_hourly_price") : w("validation_price");
    if (current.pricingMode !== "packages") {
      const variantsError = validateRateVariants(current.rateVariants, w);
      if (variantsError) return variantsError;
    }
    return "";
  }

  const detailsFrom = (current, existing = {}) => ({
    ...existing,
    city_slug: INTERCITY_CATEGORIES.has(current.category)
      ? String(current.originCity || "").trim() || null
      : String(current.citySlug || "").trim() || null,
    origin_city: INTERCITY_CATEGORIES.has(current.category) ? String(current.originCity || "").trim() || null : null,
    destination_city: INTERCITY_CATEGORIES.has(current.category) ? String(current.destinationCity || "").trim() || null : null,
    ...(transportCategory(current.category) || (guideCategory(current.category) && current.transportIncluded)
      ? { seats: Math.max(1, number(current.seats) || 1), vehicle_model: String(current.vehicleModel || "" ).trim(), max_guests: null, transport_included: Boolean(guideCategory(current.category) && current.transportIncluded) }
      : { seats: null, vehicle_model: null, max_guests: number(current.seats) > 0 ? number(current.seats) : null, transport_included: false }),
    pricing_mode: current.pricingMode,
    minimum_hours: Math.max(1, number(current.minimumHours) || 1),
    ...(current.pricingMode === "packages" ? {
      half_day_hours: Math.max(1, number(current.halfDayHours) || 4),
      half_day_price: number(current.halfDayPrice),
      full_day_hours: Math.max(1, number(current.fullDayHours) || 8),
      full_day_price: number(current.fullDayPrice),
      extra_hour_price: number(current.extraHourPrice),
    } : {}),
    rate_variants: current.pricingMode === "packages" ? [] : (current.rateVariants || []).map((variant) => ({
      id: variant.id,
      resident_type: variant.audience || "all",
      valid_from: variant.validFrom || null,
      valid_to: variant.validTo || null,
      min_guests: Math.max(1, number(variant.minGuests) || 1),
      max_guests: number(variant.maxGuests) > 0 ? number(variant.maxGuests) : null,
      price: number(variant.price),
    })).filter((variant) => variant.price > 0),
  });

  async function addService() {
    const error = validate(form);
    if (error) {
      setFormError(error);
      return tError(error);
    }
    const duplicate = rows.find((row) => duplicateKey(row) === formDuplicateKey(form));
    if (duplicate) return openExistingService(duplicate);
    setSaving(true);
    try {
      const created = await fetchJSON(`/api/providers/${pid}/services`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category === LEGACY_GUIDE_WITH_TRANSPORT ? "city_tour_guide" : form.category,
          title: serviceTitle(form),
          price: form.pricingMode === "packages" ? number(form.halfDayPrice) : number(form.price),
          currency: "UZS",
          details: detailsFrom(form),
        }),
      });
      setRows((current) => [created, ...current]);
      if (isNewDestination) {
        const refreshedProfile = await fetchJSON("/api/providers/profile").catch(() => null);
        if (refreshedProfile) setProfile(refreshedProfile);
      }
      setForm(blankForm());
      setFormError("");
      tSuccess(w("created"));
    } catch (error) {
      if (error.code === "duplicate_provider_service") {
        const existing = rows.find((row) => Number(row.id) === Number(error.duplicateId))
          || rows.find((row) => duplicateKey(row) === formDuplicateKey(form));
        if (existing) return openExistingService(existing);
      }
      tError(w("create_error", { error: error.message }));
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
      tError(w("update_error", { error: error.message }));
      throw error;
    }
  }

  function beginEdit(row) {
    const details = row.details || {};
    const group = catalogGroup(row.category, categoryGroups);
    setEditingId(row.id);
    setDraft({
      catalogGroup: group?.id || "",
      category: catalogCategory(row.category),
      title: row.title || "",
      citySlug: details.city_slug || "",
      originCity: details.origin_city || details.city_slug || "",
      destinationCity: details.destination_city || "",
      seats: details.seats || "",
      vehicleModel: details.vehicle_model || "",
      transportIncluded: includesTransport(row),
      pricingMode: details.pricing_mode || "fixed",
      price: row.price || "",
      minimumHours: details.minimum_hours || "2",
      halfDayHours: details.half_day_hours || "4",
      halfDayPrice: details.half_day_price || "",
      fullDayHours: details.full_day_hours || "8",
      fullDayPrice: details.full_day_price || "",
      extraHourPrice: details.extra_hour_price || "",
      rateVariants: Array.isArray(details.rate_variants) ? details.rate_variants.map((variant) => ({
        id: variant.id || globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
        audience: variant.resident_type || "all",
        validFrom: variant.valid_from || "",
        validTo: variant.valid_to || "",
        minGuests: variant.min_guests || "1",
        maxGuests: variant.max_guests || "",
        price: variant.price || "",
      })) : [],
    });
  }

  function openExistingService(row) {
    if (!row) return;
    beginEdit(row);
    window.setTimeout(() => document.getElementById(`provider-service-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    tError(w("duplicate_opened"));
  }

  async function saveEdit(row) {
    const error = validate(draft);
    if (error) return tError(error);
    const duplicate = rows.find(
      (item) => item.id !== row.id && duplicateKey(item) === formDuplicateKey(draft)
    );
    if (duplicate) return openExistingService(duplicate);
    setSaving(true);
    try {
      await patchService(row.id, {
        category: draft.category === LEGACY_GUIDE_WITH_TRANSPORT ? "city_tour_guide" : draft.category,
        title: INTERCITY_CATEGORIES.has(draft.category)
          ? `${serviceLabel(draft.category)} · ${draft.originCity} → ${draft.destinationCity}`
          : `${serviceLabel(draft.category)} · ${draft.citySlug}`,
        price: draft.pricingMode === "packages" ? number(draft.halfDayPrice) : number(draft.price),
        details: detailsFrom(draft, row.details || {}),
        vehicle_model: (transportCategory(draft.category) || (guideCategory(draft.category) && draft.transportIncluded)) ? String(draft.vehicleModel || "").trim() : null,
      });
      setEditingId(null);
      setDraft(null);
      tSuccess(w("saved"));
    } finally {
      setSaving(false);
    }
  }

  async function removeService(row) {
    setDeletingId(row.id);
    try {
      await fetchJSON(`/api/providers/${pid}/services/${row.id}`, { method: "DELETE" });
      setRows((current) => current.filter((item) => item.id !== row.id));
      if (editingId === row.id) {
        setEditingId(null);
        setDraft(null);
      }
      setPendingDelete(null);
      tSuccess(w("deleted"));
    } catch (error) {
      tError(w("delete_error", { error: error.message }));
    } finally {
      setDeletingId(null);
    }
  }

  const availableCategoryGroups = useMemo(() => categoryGroups
    .map((group) => ({
      ...group,
      count: rows.filter((row) => group.services.some((service) => service.id === catalogCategory(row.category))).length,
    }))
    .filter((group) => group.count > 0), [categoryGroups, rows]);
  const availableCities = useMemo(() => Array.from(new Set(rows.flatMap((row) => [
    row.details?.city_slug,
    row.details?.origin_city,
    row.details?.destination_city,
  ]).filter(Boolean))).sort((a, b) => cityLabel(a).localeCompare(cityLabel(b))), [rows]);
  const hasFilters = Boolean(query.trim()) || categoryFilter !== "all" || cityFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    setQuery("");
    setCategoryFilter("all");
    setCityFilter("all");
    setStatusFilter("all");
  };

  const filtered = useMemo(() => rows.filter((row) => {
    const rowCities = [row.details?.city_slug, row.details?.origin_city, row.details?.destination_city].filter(Boolean);
    const text = `${row.title || ""} ${serviceLabel(row.category)} ${rowCities.map(cityLabel).join(" ")} ${row.details?.vehicle_model || ""}`.toLowerCase();
    const matchesText = text.includes(query.trim().toLowerCase());
    const matchesCategory = categoryFilter === "all"
      || catalogGroup(row.category, categoryGroups)?.id === categoryFilter;
    const matchesCity = cityFilter === "all" || rowCities.includes(cityFilter);
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? row.is_active : !row.is_active);
    return matchesText && matchesCategory && matchesCity && matchesStatus;
  }), [rows, query, categoryFilter, cityFilter, statusFilter, categoryGroups]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950">{w("catalog_title")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{w("services_available", { total: rows.length, active: rows.filter((row) => row.is_active).length })}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} title={w("refresh")} className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
      </header>

      <section className="border-b border-slate-200 bg-slate-50 px-5 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase text-orange-600">{w("new_rate")}</div>
            <h3 className="mt-1 text-xl font-bold text-slate-950">{w("add_service_title")}</h3>
            <p className="mt-1 text-sm text-slate-500">{w("add_service_subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><CheckCircle2 size={16} className="text-emerald-600" />{w("publishes_immediately")}</div>
        </div>

        {!cities.length && <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{w("add_profile_locations")}</div>}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <FormStep icon={Layers3} number="1" title={w("choose_service")} description={w("catalog_same_for_all")} stepLabel={w("step")} status={stepOneComplete ? "complete" : "current"} statusLabels={{ complete: w("step_complete"), current: w("step_current"), pending: w("step_pending") }}>
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField label={w("category")} value={activeCategoryGroup?.id || ""} onChange={(value) => setForm((current) => ({ ...current, catalogGroup: value, category: "", title: "" }))} options={categoryGroups.map((group) => ({ value: group.id, label: groupLabel(group) }))} placeholder={w("choose_category")} />
                <SelectField label={w("service")} value={form.category} disabled={!activeCategoryGroup} onChange={(value) => setField("category", value)} options={(activeCategoryGroup?.services || []).map((service) => ({ value: service.id, label: serviceLabel(service.id) }))} placeholder={w("choose_specific_service")} />
              </div>
            </FormStep>

            <FormStep icon={MapPin} number="2" title={isIntercity ? w("specify_route") : w("choose_location")} description={w("profile_cities_only")} stepLabel={w("step")} disabled={!stepOneComplete} status={stepTwoComplete ? "complete" : stepOneComplete ? "current" : "pending"} statusLabels={{ complete: w("step_complete"), current: w("step_current"), pending: w("step_pending") }}>
              <div className={`grid gap-4 ${isIntercity ? "md:grid-cols-2" : "md:max-w-md"}`}>
                {isIntercity ? <>
                  <CitySelect label={w("from")} value={form.originCity} cities={cities} onChange={(value) => setForm((current) => ({ ...current, originCity: value, destinationCity: current.destinationCity === value ? "" : current.destinationCity }))} placeholder={w("choose_city")} />
                  <CitySelect allowNew label={w("to")} value={form.destinationCity} cities={cities.filter((city) => city !== form.originCity)} onChange={(value) => setField("destinationCity", value)} placeholder={w("choose_or_add_city")} />
                </> : <CitySelect label={w("service_city")} value={form.citySlug} cities={cities} onChange={(value) => setField("citySlug", value)} placeholder={w("choose_city")} />}
              </div>
              {isNewDestination && <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800"><Plus size={16} className="shrink-0" />{w("destination_will_be_added", { city: cityLabel(form.destinationCity) })}</div>}
              {isGuideService && <TransportMode
                value={form.transportIncluded}
                labels={{ title: f("service_format"), guide: f("guide_only"), guideHint: f("guide_only_hint"), transport: f("guide_with_transport"), transportHint: f("guide_with_transport_hint") }}
                onChange={(transportIncluded) => setForm((current) => ({
                  ...current,
                  transportIncluded,
                  ...(!transportIncluded ? { vehicleModel: "", seats: "" } : {}),
                }))}
              />}
              {usesVehicle && <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
                {fleet.length > 0 ? <SelectField label={w("profile_vehicle")} value="" onChange={applyVehicle} options={fleet.map((car, index) => ({ value: String(car.id ?? index), label: `${car.model || w("vehicle")} · ${w("seats_count", { count: car.seats || "?" })}` }))} placeholder={w("choose_vehicle")} /> : <div className="md:col-span-3 text-sm text-amber-700">{w("add_vehicle")}</div>}
                <ReadOnlyValue label={w("model")} value={form.vehicleModel || w("not_selected")} />
                <ReadOnlyValue label={w("capacity")} value={form.seats ? w("seats_count", { count: form.seats }) : "—"} />
              </div>}
            </FormStep>

            <FormStep icon={WalletCards} number="3" title={w("specify_price")} description={w("duration_calculation")} stepLabel={w("step")} disabled={!stepTwoComplete} status={stepThreeComplete ? "complete" : stepTwoComplete ? "current" : "pending"} statusLabels={{ complete: w("step_complete"), current: w("step_current"), pending: w("step_pending") }}>
              <div className="mb-4 inline-flex max-w-full flex-wrap rounded-md border border-slate-300 bg-slate-50 p-1" role="group" aria-label={w("rate_type")}>
                {[['fixed',w('per_service')],['hourly',w('per_hour')],['packages',w('packages')]].map(([key,label]) => <button key={key} type="button" onClick={() => setField("pricingMode", key)} className={`h-9 rounded px-4 text-sm font-semibold ${form.pricingMode === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white'}`}>{label}</button>)}
              </div>
              {form.pricingMode === "fixed" && <div className="grid gap-4 sm:grid-cols-2"><MoneyField label={w("price_per_service")} value={form.price} onChange={(value) => setField("price", value)} /><ReadOnlyCurrency label={w("currency")} /></div>}
              {form.pricingMode === "hourly" && <div className="grid gap-4 sm:grid-cols-3"><MoneyField label={w("price_per_hour")} value={form.price} onChange={(value) => setField("price", value)} /><NumberField label={w("minimum_hours")} value={form.minimumHours} onChange={(value) => setField("minimumHours", value)} /><ReadOnlyCurrency label={w("currency")} /></div>}
              {form.pricingMode === "packages" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><NumberField label={w("half_day_hours")} value={form.halfDayHours} onChange={(value) => setField("halfDayHours", value)} /><MoneyField label={w("half_day_price")} value={form.halfDayPrice} onChange={(value) => setField("halfDayPrice", value)} /><NumberField label={w("full_day_hours")} value={form.fullDayHours} onChange={(value) => setField("fullDayHours", value)} /><MoneyField label={w("full_day_price")} value={form.fullDayPrice} onChange={(value) => setField("fullDayPrice", value)} /><MoneyField label={w("extra_hour")} value={form.extraHourPrice} onChange={(value) => setField("extraHourPrice", value)} /></div>}
              {form.pricingMode !== "packages" && <RateVariantsEditor variants={form.rateVariants} basePrice={form.price} pricingMode={form.pricingMode} onChange={(rateVariants) => setField("rateVariants", rateVariants)} w={w} />}
            </FormStep>
          </div>

          <aside className="overflow-hidden rounded-lg bg-slate-950 text-white xl:sticky xl:top-20 xl:z-10 xl:self-start">
            <div className="border-b border-white/10 px-5 py-4"><div className="text-xs font-bold uppercase text-orange-400">{w("preview")}</div><div className="mt-1 text-xs text-slate-400">{w("preview_hint")}</div></div>
            <div className="px-5 py-5"><div className="text-lg font-bold leading-snug">{serviceTitle(form)}</div><div className="mt-4 flex items-center gap-2 text-sm text-slate-300"><MapPin size={16} />{isIntercity ? `${cityLabel(form.originCity) || w("from")} → ${cityLabel(form.destinationCity) || w("to")}` : cityLabel(form.citySlug) || w("location_not_selected")}</div><div className="mt-6 border-t border-white/10 pt-4"><div className="text-xs uppercase text-slate-400">{w("example_calculation")}</div><div className="mt-1 text-sm text-slate-300">{preview.duration} · {preview.rule}</div><div className="mt-2 text-2xl font-bold">{money(preview.total)} <span className="text-base font-semibold text-slate-300">UZS</span></div></div></div>
            <div className="px-5 pb-5">{formError && <div role="alert" className="mb-3 border-l-2 border-amber-400 bg-white/5 px-3 py-2 text-sm font-semibold text-amber-200">{formError}</div>}<button type="button" onClick={addService} disabled={saving || !cities.length || !stepThreeComplete} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-5 font-bold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={19} />{saving ? w("saving") : stepThreeComplete ? w("add_rate") : w("complete_steps")}</button><p className="mt-2 text-center text-xs text-slate-400">{stepThreeComplete ? w("ready_to_publish") : w("complete_steps_hint")}</p></div>
          </aside>
        </div>
      </section>

      <section className="px-5 py-5">
        <div>
          <h3 className="font-bold text-slate-950">{w("my_services")}</h3>
          <p className="text-sm text-slate-500">{w("services_enabled", { total: rows.length, active: rows.filter((row) => row.is_active).length })}</p>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_minmax(180px,0.7fr)_minmax(160px,0.55fr)_minmax(150px,0.5fr)_auto]">
            <label className="relative block">
              <span className="sr-only">{w("search_service")}</span>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={w("search_service")} className="h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
            </label>
            <FilterSelect label={f("filter_category")} value={categoryFilter} onChange={setCategoryFilter}>
              <option value="all">{f("all_categories")}</option>
              {availableCategoryGroups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)} ({group.count})</option>)}
            </FilterSelect>
            <FilterSelect label={f("filter_city")} value={cityFilter} onChange={setCityFilter}>
              <option value="all">{f("all_cities")}</option>
              {availableCities.map((city) => <option key={city} value={city}>{cityLabel(city)}</option>)}
            </FilterSelect>
            <FilterSelect label={f("filter_status")} value={statusFilter} onChange={setStatusFilter}>
              <option value="all">{f("all_statuses")}</option>
              <option value="active">{w("enabled_plural")}</option>
              <option value="inactive">{w("disabled_plural")}</option>
            </FilterSelect>
            <button type="button" onClick={clearFilters} disabled={!hasFilters} className="flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-default disabled:opacity-40" title={f("reset_filters")}><X size={17} aria-hidden="true" />{f("reset")}</button>
          </div>
          <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs text-slate-500">
            <span>{f("results_count", { count: filtered.length })}</span>
            {hasFilters && filtered.length !== rows.length && <span>{f("filtered_from", { total: rows.length })}</span>}
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
          {loading ? <div className="py-8 text-center text-slate-500">{w("loading")}</div> : filtered.length === 0 ? <div className="flex flex-col items-center py-10 text-center"><Search size={24} className="mb-2 text-slate-300" aria-hidden="true" /><div className="font-semibold text-slate-700">{w("services_not_found")}</div><div className="mt-1 text-sm text-slate-500">{f("try_other_filters")}</div>{hasFilters && <button type="button" onClick={clearFilters} className="mt-3 text-sm font-semibold text-orange-600 hover:text-orange-700">{f("reset_filters")}</button>}</div> : filtered.map((row) => {
            const expanded = editingId === row.id;
            const draftCategoryGroup = expanded && draft
              ? categoryGroups.find((group) => group.id === draft.catalogGroup) || catalogGroup(draft.category, categoryGroups)
              : null;
            const draftIsGuide = Boolean(expanded && draft && guideCategory(draft.category));
            const draftUsesVehicle = Boolean(expanded && draft && (transportCategory(draft.category) || (draftIsGuide && draft.transportIncluded)));
            const draftIsIntercity = Boolean(expanded && draft && INTERCITY_CATEGORIES.has(draft.category));
            return <div id={`provider-service-${row.id}`} key={row.id} className={`scroll-mt-24 py-4 ${expanded ? "bg-orange-50/30" : ""}`}>
              <div className="grid items-center gap-4 md:grid-cols-[minmax(240px,1.5fr)_minmax(220px,1fr)_120px_auto]">
                <div><div className="font-semibold text-slate-950">{storedServiceTitle(row)}</div><div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-500"><span>{serviceLabel(row.category)}{row.details?.vehicle_model ? ` · ${row.details.vehicle_model}` : ""}{row.details?.seats ? ` · ${w("seats_count", { count: row.details.seats })}` : ""}</span>{guideCategory(row.category) && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${includesTransport(row) ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{includesTransport(row) ? f("transport_included") : f("guide_only")}</span>}</div></div>
                <div><div className="font-semibold text-slate-900">{pricingLabel(row, w)}</div><div className="text-xs text-slate-500">{w("tour_builder_rate")}</div></div>
                <div className={`text-sm font-semibold ${row.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>{row.is_active ? w("enabled") : w("disabled")}</div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => expanded ? (setEditingId(null), setDraft(null)) : beginEdit(row)} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{expanded ? w("close") : w("edit")}</button><button type="button" onClick={() => patchService(row.id, { is_active: !row.is_active })} className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-600">{row.is_active ? w("disable") : w("enable")}</button><button type="button" onClick={() => setPendingDelete(row)} disabled={deletingId === row.id} title={w("delete")} aria-label={w("delete")} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"><Trash2 size={16} aria-hidden="true" /></button></div>
              </div>
              {expanded && draft && (
                <div className="mt-4 border-l-4 border-slate-400 bg-slate-50 p-4">
                  <div className="mb-4">
                    <h4 className="font-bold text-slate-950">{w("basic_data")}</h4>
                    <p className="text-xs text-slate-500">{w("edit_fields_hint")}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs font-semibold text-slate-600">{w("service_category")}
                      <select
                        value={draftCategoryGroup?.id || ""}
                        onChange={(event) => setDraft({ ...draft, catalogGroup: event.target.value, category: "", title: "" })}
                        className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal"
                      >
                        <option value="">{w("choose_category")}</option>
                        {categoryGroups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">{w("specific_service")}
                      <select
                        value={draft.category}
                        disabled={!draftCategoryGroup}
                        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                        className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal disabled:bg-slate-100"
                      >
                        <option value="">{w("choose_service_option")}</option>
                        {(draftCategoryGroup?.services || []).map((service) => <option key={service.id} value={service.id}>{serviceLabel(service.id)}</option>)}
                      </select>
                    </label>
                    {draftIsIntercity ? <>
                      <CitySelect compact label={w("from")} value={draft.originCity} cities={cities} onChange={(value) => setDraft({ ...draft, originCity: value, destinationCity: draft.destinationCity === value ? "" : draft.destinationCity })} placeholder={w("choose_city")} />
                      <CitySelect compact label={w("to")} value={draft.destinationCity} cities={cities.filter((city) => city !== draft.originCity)} onChange={(value) => setDraft({ ...draft, destinationCity: value })} placeholder={w("choose_city")} />
                    </> : <CitySelect compact label={w("service_city")} value={draft.citySlug} cities={cities} onChange={(value) => setDraft({ ...draft, citySlug: value })} placeholder={w("choose_city")} />}
                  </div>

                  {draftIsGuide && <TransportMode
                    compact
                    value={draft.transportIncluded}
                    labels={{ title: f("service_format"), guide: f("guide_only"), guideHint: f("guide_only_hint"), transport: f("guide_with_transport"), transportHint: f("guide_with_transport_hint") }}
                    onChange={(transportIncluded) => setDraft({ ...draft, transportIncluded, ...(!transportIncluded ? { vehicleModel: "", seats: "" } : {}) })}
                  />}

                  {draftUsesVehicle && (
                    <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-3">
                      {fleet.length > 0 && <label className="text-xs font-semibold text-slate-600">{w("profile_vehicle")}
                        <select defaultValue="" onChange={(event) => {
                          const car = fleet.find((item, index) => String(item.id ?? index) === event.target.value);
                          if (car) setDraft({ ...draft, vehicleModel: String(car.model || ""), seats: car.seats ? String(car.seats) : "" });
                        }} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal">
                          <option value="">{w("choose_vehicle")}</option>
                          {fleet.map((car, index) => <option key={car.id || index} value={String(car.id ?? index)}>{car.model || w("vehicle")} · {w("seats_count", { count: car.seats || "?" })}</option>)}
                        </select>
                      </label>}
                      <ReadOnlyValue compact label={w("model")} value={draft.vehicleModel || w("choose_vehicle")} />
                      <ReadOnlyValue compact label={w("passenger_seats")} value={draft.seats || "—"} />
                    </div>
                  )}

                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <h4 className="mb-3 font-bold text-slate-950">{w("rate")}</h4>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold text-slate-600">{w("rate_type")}
                        <select value={draft.pricingMode} onChange={(event) => setDraft({ ...draft, pricingMode: event.target.value })} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-normal">
                          <option value="fixed">{w("per_service")}</option>
                          <option value="hourly">{w("per_hour")}</option>
                          <option value="packages">{w("packages")}</option>
                        </select>
                      </label>
                      {draft.pricingMode !== "packages" && <MoneyField label={draft.pricingMode === "hourly" ? w("price_per_hour") : w("service_price")} value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} />}
                      {draft.pricingMode === "hourly" && <NumberField label={w("minimum_hours")} value={draft.minimumHours} onChange={(value) => setDraft({ ...draft, minimumHours: value })} />}
                    </div>
                    {draft.pricingMode === "packages" && <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><NumberField label={w("half_day_hours")} value={draft.halfDayHours} onChange={(value) => setDraft({ ...draft, halfDayHours: value })} /><MoneyField label={w("half_day_price")} value={draft.halfDayPrice} onChange={(value) => setDraft({ ...draft, halfDayPrice: value })} /><NumberField label={w("full_day_hours")} value={draft.fullDayHours} onChange={(value) => setDraft({ ...draft, fullDayHours: value })} /><MoneyField label={w("full_day_price")} value={draft.fullDayPrice} onChange={(value) => setDraft({ ...draft, fullDayPrice: value })} /><MoneyField label={w("extra_hour")} value={draft.extraHourPrice} onChange={(value) => setDraft({ ...draft, extraHourPrice: value })} /></div>}
                    {draft.pricingMode !== "packages" && <RateVariantsEditor compact variants={draft.rateVariants || []} basePrice={draft.price} pricingMode={draft.pricingMode} onChange={(rateVariants) => setDraft({ ...draft, rateVariants })} w={w} />}
                  </div>
                  <div className="mt-5 flex justify-between gap-3 border-t border-slate-200 pt-4">
                    <button type="button" onClick={() => setPendingDelete(row)} className="h-10 rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">{w("delete")}</button>
                    <button type="button" onClick={() => saveEdit(row)} disabled={saving} className="h-10 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{w("save_changes")}</button>
                  </div>
                </div>
              )}
            </div>;
          })}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={w("delete")}
        message={pendingDelete ? w("delete_confirm", { service: storedServiceTitle(pendingDelete) }) : ""}
        confirmLabel={w("delete")}
        cancelLabel={t("actions.cancel", { defaultValue: "Отмена" })}
        busyLabel={`${w("delete")}...`}
        danger
        busy={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onConfirm={() => pendingDelete && removeService(pendingDelete)}
        onClose={() => {
          if (!deletingId) setPendingDelete(null);
        }}
      />

    </div>
  );
}

function MoneyField({ label, value, onChange }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<div className="mt-1 flex h-11 overflow-hidden rounded-md border border-slate-300 bg-white"><input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0" className="min-w-0 flex-1 px-3 font-normal outline-none" /><span className="flex items-center border-l border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">UZS</span></div></label>;
}
function RateVariantsEditor({ variants, basePrice, pricingMode, onChange, w, compact = false }) {
  const [previewDate, setPreviewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [previewGuests, setPreviewGuests] = useState("2");
  const [previewAudience, setPreviewAudience] = useState("nrs");
  const update = (index, key, value) => onChange(variants.map((variant, current) => current === index ? { ...variant, [key]: value } : variant));
  const matchingIndex = variants.findIndex((variant) => {
    const from = variant.validFrom || "0000-01-01";
    const to = variant.validTo || "9999-12-31";
    const min = Math.max(1, number(variant.minGuests) || 1);
    const max = number(variant.maxGuests) > 0 ? number(variant.maxGuests) : Infinity;
    const audience = variant.audience || "all";
    const guests = Math.max(1, number(previewGuests) || 1);
    return number(variant.price) > 0 && (audience === "all" || audience === previewAudience) && previewDate >= from && previewDate <= to && guests >= min && guests <= max;
  });
  const matching = matchingIndex >= 0 ? variants[matchingIndex] : null;
  const previewPrice = matching ? number(matching.price) : number(basePrice);
  return <div className={`${compact ? "mt-4" : "mt-5"} border-t border-slate-200 pt-4`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h5 className="text-sm font-bold text-slate-900">{w("price_conditions")}</h5><p className="mt-0.5 text-xs text-slate-500">{w("price_conditions_hint")}</p></div><button type="button" onClick={() => onChange([...variants, blankRateVariant()])} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus size={16} />{w("add_price_condition")}</button></div>
    {variants.length > 0 && <div className="mt-3 space-y-3">{variants.map((variant, index) => <div key={variant.id || index} className={`min-w-0 border-l-2 p-3 ${matchingIndex === index ? "border-emerald-500 bg-emerald-50/60" : "border-orange-400 bg-orange-50/40"}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase text-slate-500">{w("condition_number", { number: index + 1 })}</span><button type="button" onClick={() => onChange(variants.filter((_, current) => current !== index))} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={15} />{w("delete_condition")}</button></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <SelectField label={w("rate_audience")} value={variant.audience || "all"} onChange={(value) => update(index, "audience", value)} placeholder={w("all_travelers")} options={[{ value: "all", label: w("all_travelers") }, { value: "res", label: w("residents") }, { value: "nrs", label: w("nonresidents") }]} />
        <div className="hidden sm:block" />
        <DateField label={w("valid_from")} value={variant.validFrom} onChange={(value) => update(index, "validFrom", value)} />
        <DateField label={w("valid_to")} value={variant.validTo} onChange={(value) => update(index, "validTo", value)} />
        <NumberField label={w("min_guests")} value={variant.minGuests} onChange={(value) => update(index, "minGuests", value)} />
        <OptionalNumberField label={w("max_guests")} value={variant.maxGuests} onChange={(value) => update(index, "maxGuests", value)} />
        <div className="min-w-0 sm:col-span-2"><MoneyField label={w("condition_price")} value={variant.price} onChange={(value) => update(index, "price", value)} /></div>
      </div>
    </div>)}</div>}
    <div className="mt-3 border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[150px] flex-1"><DateField label={w("test_date")} value={previewDate} onChange={setPreviewDate} /></div>
        <div className="w-32"><NumberField label={w("test_guests")} value={previewGuests} onChange={setPreviewGuests} /></div>
        <div className="min-w-[180px] flex-1"><SelectField label={w("test_audience")} value={previewAudience} onChange={setPreviewAudience} placeholder={w("nonresidents")} options={[{ value: "nrs", label: w("nonresidents") }, { value: "res", label: w("residents") }]} /></div>
        <div className="min-w-[180px] flex-1 pb-1"><span className="block text-xs font-semibold text-slate-500">{matching ? w("condition_applied", { number: matchingIndex + 1 }) : w("base_price_applied")}</span><strong className="mt-1 block text-lg text-slate-950">{money(previewPrice)} UZS {pricingMode === "hourly" ? w("per_hour_short") : ""}</strong></div>
      </div>
    </div>
  </div>;
}
function DateField({ label, value, onChange }) {
  return <label className="text-xs font-semibold text-slate-600">{label}<input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal" /></label>;
}
function OptionalNumberField({ label, value, onChange }) {
  return <label className="text-xs font-semibold text-slate-600">{label}<input type="number" min="1" value={value} placeholder="∞" onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal" /></label>;
}
function NumberField({ label, value, onChange }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal" /></label>;
}
function ReadOnlyCurrency({ label }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input value="UZS" readOnly className="mt-1 h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 font-normal text-slate-600" /></label>;
}
function FormStep({ icon: Icon, number, title, description, stepLabel, children, disabled = false, status = "pending", statusLabels }) {
  const complete = status === "complete";
  const current = status === "current";
  return <section aria-disabled={disabled} className={`border-b border-slate-200 p-5 last:border-b-0 ${disabled ? "bg-slate-50/70" : "bg-white"}`}><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${complete ? "bg-emerald-600 text-white" : current ? "bg-slate-950 text-white" : "bg-slate-200 text-slate-500"}`}>{complete ? <CheckCircle2 size={18} /> : <Icon size={18} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`text-xs font-bold ${current ? "text-orange-600" : "text-slate-500"}`}>{stepLabel} {number}</span><h4 className={`font-bold ${disabled ? "text-slate-500" : "text-slate-950"}`}>{title}</h4><span className={`ml-auto text-xs font-semibold ${complete ? "text-emerald-700" : current ? "text-orange-700" : "text-slate-400"}`}>{statusLabels?.[status]}</span></div><p className="mt-0.5 text-sm text-slate-500">{description}</p></div></div>{!disabled && <div className="mt-4">{children}</div>}</section>;
}
function SelectField({ label, value, onChange, options, placeholder, disabled = false }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-400"><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function FilterSelect({ label, value, onChange, children }) {
  return <label className="relative block"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200">{children}</select></label>;
}
function TransportMode({ value, onChange, labels, compact = false }) {
  const options = [
    { value: false, icon: UserRound, title: labels.guide, hint: labels.guideHint },
    { value: true, icon: CarFront, title: labels.transport, hint: labels.transportHint },
  ];
  return <fieldset className={`${compact ? "mt-4" : "mt-5 border-t border-slate-100 pt-4"}`}>
    <legend className="mb-2 text-xs font-bold uppercase text-slate-500">{labels.title}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.value;
        const Icon = option.icon;
        return <button key={String(option.value)} type="button" aria-pressed={selected} onClick={() => onChange(option.value)} className={`flex min-h-16 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-800 hover:border-slate-500"}`}>
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${selected ? "bg-white/10" : "bg-slate-100 text-slate-700"}`}><Icon size={18} aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block text-sm font-bold">{option.title}</span><span className={`mt-0.5 block text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>{option.hint}</span></span>
        </button>;
      })}
    </div>
  </fieldset>;
}
function CitySelect({ label, value, cities, onChange, placeholder, compact = false, allowNew = false }) {
  const listId = React.useId();
  const fieldClass = `${compact ? "h-10 text-sm" : "h-11"} mt-1 w-full rounded-md border border-slate-300 bg-white px-3 font-normal text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50`;
  return <label className={`${compact ? "text-xs text-slate-600" : "text-sm text-slate-700"} font-semibold`}>{label}{allowNew ? <><input list={listId} value={value} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onChange(event.target.value.trim())} placeholder={placeholder} className={fieldClass} /><datalist id={listId}>{cities.map((city) => <option key={city} value={cityLabel(city)} />)}</datalist></> : <select value={value} onChange={(event) => onChange(event.target.value)} disabled={!cities.length} className={fieldClass}><option value="">{placeholder}</option>{cities.map((city) => <option key={city} value={city}>{cityLabel(city)}</option>)}</select>}</label>;
}
function ReadOnlyValue({ label, value, compact = false }) {
  return <label className={`${compact ? "text-xs text-slate-600" : "text-sm text-slate-700"} font-semibold`}>{label}<div className={`${compact ? "h-10 text-sm" : "h-11"} mt-1 flex items-center rounded-md border border-slate-200 bg-slate-100 px-3 font-normal text-slate-600`}>{value}</div></label>;
}
