// frontend/src/pages/DashboardServices.jsx
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import ProviderServicesCard from "../components/ProviderServicesCard";
import { tSuccess, tError, tWarn } from "../shared/toast";

const DEFAULT_DETAILS = {
  directionCountry: "",
  directionFrom: "",
  directionTo: "",
  startDate: "",
  endDate: "",
  hotel: "",
  accommodationCategory: "",
  accommodation: "",
  adt: "",
  chd: "",
  inf: "",
  food: "",
  halal: false,
  transfer: "",
  changeable: false,
  visaIncluded: false,
  insuranceIncluded: false,
  earlyCheckIn: false,
  arrivalFastTrack: false,
  netPrice: "",
  grossPrice: "",
  expiration: "",
  isActive: true,
  flightType: "one_way",
  airline: "",
  returnDate: "",
  startFlightDate: "",
  endFlightDate: "",
  flightDetails: "",
  eventName: "",
  eventCategory: "",
  location: "",
  ticketDetails: "",
  description: "",
  visaCountry: "",
  proofImages: [],
};

const EXTENDED_AGENT_CATEGORIES = [
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
  "visa_support",
];

const foodOptions = ["BB", "HB", "FB", "AI", "UAI", "HALAL"];
const transferOptions = ["group", "individual", "none"];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function parseMoney(value) {
  if (value === undefined || value === null || String(value).trim() === "") return NaN;
  const normalized = String(value).replace(/\s+/g, "").replace(/,/g, ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function compactDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactDeep)
      .filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, compactDeep(v)])
        .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
    );
  }
  return value;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs font-semibold text-slate-400">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={cx(
        "h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className={cx(
        "h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className={cx(
        "min-h-[92px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        "flex items-start gap-3 rounded-2xl border p-3 text-left transition",
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50/50"
      )}
    >
      <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black", checked ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400")}>
        {checked ? "✓" : ""}
      </span>
      <span>
        <span className="block text-sm font-black">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs font-medium text-current/70">{hint}</span> : null}
      </span>
    </button>
  );
}

function ImageUploader({ title, hint, images, onChange, max = 10 }) {
  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, max - images.length));
    if (!files.length) return;
    const next = [];
    for (const file of files) {
      if (!String(file.type || "").startsWith("image/")) continue;
      next.push(await fileToDataUrl(file));
    }
    onChange([...images, ...next].slice(0, max));
    event.target.value = "";
  };

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">{title}</div>
          {hint ? <div className="mt-1 text-xs font-medium leading-5 text-slate-500">{hint}</div> : null}
        </div>
        {!!images.length && (
          <button type="button" onClick={() => onChange([])} className="text-xs font-black text-rose-600 hover:underline">
            Очистить
          </button>
        )}
      </div>

      {images.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((src, idx) => (
            <div key={`${src}-${idx}`} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <img src={src} alt="" className="h-20 w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(images.filter((_, i) => i !== idx))}
                className="absolute right-1 top-1 hidden rounded-full bg-white/90 px-2 py-1 text-xs font-black text-rose-600 shadow group-hover:block"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">
          Изображений пока нет
        </div>
      )}

      <label className="mt-3 inline-flex cursor-pointer rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-600">
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        Выбрать файлы
      </label>
    </div>
  );
}

export default function DashboardServices() {
  const { t } = useTranslation();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API_BASE });
    instance.interceptors.request.use((cfg) => {
      const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
      if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
      return cfg;
    });
    return instance;
  }, [API_BASE]);

  const [profile, setProfile] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("create");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [images, setImages] = useState([]);
  const [details, setDetails] = useState(DEFAULT_DETAILS);

  const isAgent = profile?.type === "agent";
  const isExtended = isAgent && EXTENDED_AGENT_CATEGORIES.includes(category);

  const steps = useMemo(
    () => [
      { id: 1, label: t("service_form.step_main", { defaultValue: "Основное" }), hint: t("service_form.step_main_hint", { defaultValue: "Категория, название, направление" }) },
      { id: 2, label: t("service_form.step_details", { defaultValue: "Детали" }), hint: t("service_form.step_details_hint", { defaultValue: "Отель, рейс, размещение" }) },
      { id: 3, label: t("service_form.step_value", { defaultValue: "Ценность" }), hint: t("service_form.step_value_hint", { defaultValue: "Что включено и proof" }) },
      { id: 4, label: t("service_form.step_price", { defaultValue: "Цена" }), hint: t("service_form.step_price_hint", { defaultValue: "Стоимость и актуальность" }) },
      { id: 5, label: t("service_form.step_preview", { defaultValue: "Предпросмотр" }), hint: t("service_form.step_preview_hint", { defaultValue: "Как увидит клиент" }) },
    ],
    [t]
  );

  const categoryOptions = useMemo(() => {
    const type = profile?.type;
    if (type === "agent") {
      return [
        "refused_tour",
        "refused_hotel",
        "refused_flight",
        "refused_event_ticket",
        "visa_support",
        "author_tour",
      ];
    }
    if (type === "guide") return ["city_tour_guide", "mountain_tour_guide", "desert_tour_guide", "safari_tour_guide"];
    if (type === "transport") return ["city_tour_transport", "mountain_tour_transport", "desert_tour_transport", "safari_tour_transport", "one_way_transfer", "dinner_transfer", "border_transfer"];
    if (type === "hotel") return ["hotel_room", "hotel_transfer", "hall_rent"];
    return [];
  }, [profile?.type]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [profileRes, servicesRes] = await Promise.all([
        api.get("/api/providers/profile"),
        api.get("/api/providers/services"),
      ]);
      setProfile(profileRes.data || {});
      setServices(Array.isArray(servicesRes.data) ? servicesRes.data : []);
    } catch (err) {
      console.error(err);
      tError(t("services_load_error", { defaultValue: "Не удалось загрузить услуги" }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setSelectedService(null);
    setCategory("");
    setTitle("");
    setDescription("");
    setPrice("");
    setImages([]);
    setDetails({ ...DEFAULT_DETAILS });
    setStep(1);
    setTab("create");
  };

  const patchDetails = (patch) => setDetails((prev) => ({ ...prev, ...patch }));

  const loadServiceToEdit = (service) => {
    const d = service?.details && typeof service.details === "object" ? service.details : {};
    setSelectedService(service);
    setCategory(service.category || "");
    setTitle(service.title || "");
    setDescription(service.description || d.description || "");
    setPrice(service.price ?? "");
    setImages(Array.isArray(service.images) ? service.images : []);
    setDetails({ ...DEFAULT_DETAILS, ...d, proofImages: Array.isArray(d.proofImages || d.proof_images) ? (d.proofImages || d.proof_images) : [] });
    setStep(1);
    setTab("create");
  };

  const validate = () => {
    if (!category) {
      tWarn(t("select_category", { defaultValue: "Выберите категорию" }));
      return false;
    }
    if (!title.trim()) {
      tWarn(t("title_required", { defaultValue: "Укажите название" }));
      return false;
    }
    if (isExtended) {
      const requiredByCategory = {
        refused_tour: [details.directionFrom, details.directionTo, details.netPrice, details.grossPrice],
        author_tour: [details.directionFrom, details.directionTo, details.netPrice, details.grossPrice],
        refused_hotel: [details.directionCountry, details.directionTo, details.startDate, details.endDate, details.netPrice, details.grossPrice],
        refused_flight: [details.directionFrom, details.directionTo, details.startDate, details.airline, details.netPrice, details.grossPrice],
        refused_event_ticket: [details.location, details.startDate, details.netPrice, details.grossPrice],
        visa_support: [details.description, details.netPrice, details.grossPrice],
      };
      if ((requiredByCategory[category] || []).some((v) => v === undefined || v === null || String(v).trim() === "")) {
        tWarn(t("fill_all_fields", { defaultValue: "Заполните обязательные поля" }));
        return false;
      }
      const net = parseMoney(details.netPrice);
      const gross = parseMoney(details.grossPrice);
      if (!Number.isFinite(net) || net <= 0 || !Number.isFinite(gross) || gross <= 0) {
        tWarn(t("validation.gross_positive", { defaultValue: "Укажите корректную цену" }));
        return false;
      }
      if (gross < net) {
        tWarn(t("validation.gross_ge_net", { defaultValue: "Цена для клиента не может быть меньше нетто" }));
        return false;
      }
    } else {
      const p = parseMoney(price);
      if (!description.trim() || !Number.isFinite(p) || p <= 0) {
        tWarn(t("fill_all_fields", { defaultValue: "Заполните обязательные поля" }));
        return false;
      }
    }
    return true;
  };

  const saveService = async () => {
    if (!validate()) return;
    try {
      setSaving(true);
      const net = parseMoney(details.netPrice);
      const gross = parseMoney(details.grossPrice);
      const simplePrice = parseMoney(price);
      const expirationDate = details.expiration ? new Date(details.expiration) : null;
      const payload = compactDeep({
        title: title.trim(),
        category,
        images,
        price: isExtended ? undefined : simplePrice,
        description: isExtended ? undefined : description,
        details: isExtended
          ? {
              ...details,
              netPrice: net,
              grossPrice: gross,
              proofImages: details.proofImages || [],
              ...(expirationDate && Number.isFinite(expirationDate.getTime())
                ? { expiration_ts: Math.floor(expirationDate.getTime() / 1000) }
                : {}),
            }
          : undefined,
      });
      const res = selectedService?.id
        ? await api.put(`/api/providers/services/${selectedService.id}`, payload)
        : await api.post("/api/providers/services", payload);
      const saved = res.data;
      setServices((prev) => {
        if (selectedService?.id) return prev.map((s) => (s.id === selectedService.id ? saved : s));
        return [...prev, saved];
      });
      tSuccess(selectedService ? t("service_updated", { defaultValue: "Услуга обновлена" }) : t("service_added", { defaultValue: "Услуга добавлена" }));
      resetForm();
      setTab("list");
    } catch (err) {
      console.error(err);
      tError(err?.response?.data?.message || t("add_error", { defaultValue: "Ошибка сохранения" }));
    } finally {
      setSaving(false);
    }
  };

  const deleteService = async (service) => {
    if (!service?.id) return;
    if (!window.confirm(t("confirm_delete", { defaultValue: "Удалить услугу?" }))) return;
    try {
      await api.delete(`/api/providers/services/${service.id}`);
      setServices((prev) => prev.filter((s) => s.id !== service.id));
      if (selectedService?.id === service.id) resetForm();
      tSuccess(t("service_deleted", { defaultValue: "Услуга удалена" }));
    } catch (err) {
      console.error(err);
      tError(t("delete_error", { defaultValue: "Ошибка удаления" }));
    }
  };

  const submitForModeration = async (service, event) => {
    event?.stopPropagation?.();
    try {
      await api.post(`/api/providers/services/${service.id}/submit`, {});
      setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, status: "pending" } : s)));
      tSuccess(t("moderation.submitted_toast", { defaultValue: "Отправлено на модерацию" }));
    } catch (err) {
      console.error(err);
      tError(t("submit_error", { defaultValue: "Не удалось отправить на модерацию" }));
    }
  };

  const routeText = [details.directionFrom, details.directionTo].filter(Boolean).join(" → ") || details.directionCountry || t("service_form.preview_route_empty", { defaultValue: "Маршрут будет показан здесь" });
  const priceText = isExtended ? details.grossPrice || details.netPrice : price;
  const includedPreview = [
    details.insuranceIncluded ? t("insurance_included", { defaultValue: "Страховка" }) : null,
    details.earlyCheckIn ? t("early_check_in", { defaultValue: "Раннее заселение" }) : null,
    details.arrivalFastTrack ? t("arrival_fast_track", { defaultValue: "Fast Track" }) : null,
    details.visaIncluded ? t("visa_included", { defaultValue: "Виза" }) : null,
    details.transfer ? t("transfer", { defaultValue: "Трансфер" }) : null,
  ].filter(Boolean);

  if (loading) {
    return <div className="rounded-3xl bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm">{t("loading", { defaultValue: "Загрузка…" })}</div>;
  }

  if (!profile?.id) return null;

  return (
    <div className="space-y-6">
      {(profile.type === "guide" || profile.type === "transport" || profile.type === "agent") && (
        <details className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-800">
            {t("provider_services_tourbuilder_title", { defaultValue: "Прайс-лист для TourBuilder" })}
          </summary>
          <div className="mt-4">
            <ProviderServicesCard providerId={profile.id} providerType={profile.type} currencyDefault={profile.currency || "USD"} />
          </div>
        </details>
      )}

      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-orange-50/45 to-amber-50/50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                {t("service_form.studio_badge", { defaultValue: "Студия создания" })}
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
                {t("services_marketplace", { defaultValue: "Услуги для MARKETPLACE" })}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {t("service_form.studio_hint", { defaultValue: "Создавайте отказные услуги блоками: направление, детали, ценность, цена и proof. Чем понятнее карточка, тем выше шанс открытия контактов." })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-3xl border border-slate-200 bg-white/80 p-1.5 shadow-sm lg:min-w-[360px]">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setTab("create");
                }}
                className={cx("rounded-2xl px-4 py-3 text-sm font-black transition", tab === "create" ? "bg-slate-950 text-white shadow" : "text-slate-600 hover:bg-orange-50")}
              >
                {t("provider_services_tab_create", { defaultValue: "Создать услугу" })}
              </button>
              <button
                type="button"
                onClick={() => setTab("list")}
                className={cx("rounded-2xl px-4 py-3 text-sm font-black transition", tab === "list" ? "bg-slate-950 text-white shadow" : "text-slate-600 hover:bg-orange-50")}
              >
                {t("provider_services_tab_created", { defaultValue: "Созданные услуги" })}
                <span className="ml-2 rounded-full bg-white/30 px-2 py-0.5 text-xs">{services.length}</span>
              </button>
            </div>
          </div>
        </div>

        {tab === "list" ? (
          <div className="p-4 sm:p-6">
            {services.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
                {t("provider_services_empty", { defaultValue: "Пока нет созданных услуг." })}
              </div>
            ) : (
              <div className="grid gap-3">
                {services.map((service) => (
                  <button
                    type="button"
                    key={service.id}
                    onClick={() => loadServiceToEdit(service)}
                    className="group rounded-[1.5rem] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg"
                  >
                    <div className="flex gap-3">
                      {service.images?.[0] ? (
                        <img src={service.images[0]} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-2xl">🏝️</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-black text-slate-950">{service.title || t("not_specified", { defaultValue: "Не указано" })}</div>
                        <div className="mt-1 text-xs font-bold text-slate-500">{t(`category.${service.category}`, { defaultValue: service.category })}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{service.status || "draft"}</span>
                          {(service.status === "draft" || service.status === "rejected") && (
                            <span onClick={(e) => submitForModeration(service, e)} className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-black text-white">
                              {t("moderation.send_to_review", { defaultValue: "На модерацию" })}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="hidden rounded-2xl bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 group-hover:block">
                        {t("edit", { defaultValue: "Редактировать" })}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            {selectedService && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-sm font-black text-slate-800">{t("edit_service", { defaultValue: "Редактирование услуги" })}</div>
                <button type="button" onClick={resetForm} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-orange-600 shadow-sm">
                  {t("new_service", { defaultValue: "Новая услуга" })}
                </button>
              </div>
            )}

            <Field label={t("select_category", { defaultValue: "Выберите категорию" })}>
              <SelectInput value={category} onChange={(e) => { setCategory(e.target.value); setStep(1); setDetails({ ...DEFAULT_DETAILS }); }}>
                <option value="">{t("select_category", { defaultValue: "Выберите категорию" })}</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{t(`category.${cat}`, { defaultValue: cat })}</option>
                ))}
              </SelectInput>
            </Field>

            {category && isExtended && (
              <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {steps.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStep(item.id)}
                      className={cx("rounded-2xl px-3 py-3 text-left transition", step === item.id ? "bg-slate-950 text-white shadow-lg" : "bg-white text-slate-600 hover:bg-orange-50")}
                    >
                      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{t("service_form.step", { defaultValue: "Шаг" })} {item.id}</div>
                      <div className="mt-1 text-sm font-black">{item.label}</div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] font-semibold opacity-70">{item.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {category && (
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  {!isExtended ? (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("title", { defaultValue: "Название" })}><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                        <Field label={t("price", { defaultValue: "Цена" })}><TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
                        <div className="sm:col-span-2"><Field label={t("description", { defaultValue: "Описание" })}><TextArea value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {step === 1 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_main", { defaultValue: "Основное" })}</div>
                            <div className="text-sm font-medium text-slate-500">{t("service_form.step_main_hint", { defaultValue: "Название, направление и даты" })}</div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2"><Field label={t("title", { defaultValue: "Название" })}><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
                            <Field label={t("direction_country", { defaultValue: "Страна назначения" })}><TextInput value={details.directionCountry} onChange={(e) => patchDetails({ directionCountry: e.target.value })} /></Field>
                            <Field label={t("direction_from", { defaultValue: "Город вылета" })}><TextInput value={details.directionFrom} onChange={(e) => patchDetails({ directionFrom: e.target.value })} /></Field>
                            <Field label={t("direction_to", { defaultValue: "Город прибытия" })}><TextInput value={details.directionTo} onChange={(e) => patchDetails({ directionTo: e.target.value })} /></Field>
                            <Field label={category === "refused_flight" ? t("departure_date", { defaultValue: "Дата вылета" }) : t("start_date", { defaultValue: "Дата начала" })}><TextInput type="date" value={details.startDate || details.startFlightDate || ""} onChange={(e) => patchDetails({ startDate: e.target.value, startFlightDate: e.target.value })} /></Field>
                            <Field label={t("end_date", { defaultValue: "Дата окончания" })}><TextInput type="date" value={details.endDate || details.endFlightDate || ""} onChange={(e) => patchDetails({ endDate: e.target.value, endFlightDate: e.target.value })} /></Field>
                          </div>
                        </div>
                      )}

                      {step === 2 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_details", { defaultValue: "Детали" })}</div>
                            <div className="text-sm font-medium text-slate-500">{t("service_form.step_details_hint", { defaultValue: "Отель, рейс, размещение" })}</div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {category !== "visa_support" && category !== "refused_event_ticket" && (
                              <>
                                <Field label={t("hotel", { defaultValue: "Отель" })}><TextInput value={details.hotel} onChange={(e) => patchDetails({ hotel: e.target.value })} /></Field>
                                <Field label={t("accommodation_category", { defaultValue: "Категория размещения" })}><TextInput value={details.accommodationCategory} onChange={(e) => patchDetails({ accommodationCategory: e.target.value })} /></Field>
                                <Field label={t("accommodation", { defaultValue: "Размещение" })}><TextInput value={details.accommodation} onChange={(e) => patchDetails({ accommodation: e.target.value })} /></Field>
                                <Field label={t("food", { defaultValue: "Питание" })}>
                                  <SelectInput value={details.food} onChange={(e) => patchDetails({ food: e.target.value })}>
                                    <option value="">{t("food_options.select", { defaultValue: "Выберите вариант" })}</option>
                                    {foodOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                  </SelectInput>
                                </Field>
                                <Field label={t("flight_details", { defaultValue: "Детали рейса" })}><TextArea value={details.flightDetails} onChange={(e) => patchDetails({ flightDetails: e.target.value })} /></Field>
                              </>
                            )}
                            {category === "refused_flight" && (
                              <>
                                <Field label={t("airline", { defaultValue: "Авиакомпания" })}><TextInput value={details.airline} onChange={(e) => patchDetails({ airline: e.target.value })} /></Field>
                                <Field label={t("flight_type", { defaultValue: "Тип рейса" })}>
                                  <SelectInput value={details.flightType} onChange={(e) => patchDetails({ flightType: e.target.value })}>
                                    <option value="one_way">{t("one_way", { defaultValue: "В одну сторону" })}</option>
                                    <option value="round_trip">Round trip</option>
                                  </SelectInput>
                                </Field>
                                {details.flightType === "round_trip" && <Field label={t("end_flight_date", { defaultValue: "Дата обратно" })}><TextInput type="date" value={details.returnDate} onChange={(e) => patchDetails({ returnDate: e.target.value })} /></Field>}
                              </>
                            )}
                            {category === "refused_event_ticket" && (
                              <>
                                <Field label={t("event_name", { defaultValue: "Название события" })}><TextInput value={details.eventName} onChange={(e) => patchDetails({ eventName: e.target.value })} /></Field>
                                <Field label={t("location", { defaultValue: "Локация" })}><TextInput value={details.location} onChange={(e) => patchDetails({ location: e.target.value })} /></Field>
                                <div className="sm:col-span-2"><Field label={t("ticketDetails", { defaultValue: "Детали билета" })}><TextArea value={details.ticketDetails} onChange={(e) => patchDetails({ ticketDetails: e.target.value })} /></Field></div>
                              </>
                            )}
                            {category === "visa_support" && (
                              <>
                                <Field label={t("visa_country", { defaultValue: "Страна визы" })}><TextInput value={details.visaCountry} onChange={(e) => patchDetails({ visaCountry: e.target.value })} /></Field>
                                <div className="sm:col-span-2"><Field label={t("description", { defaultValue: "Описание" })}><TextArea value={details.description} onChange={(e) => patchDetails({ description: e.target.value })} /></Field></div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {step === 3 && (
                        <div className="space-y-4">
                          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-4">
                              <div className="text-lg font-black text-slate-950">{t("service_form.step_value", { defaultValue: "Ценность" })}</div>
                              <div className="text-sm font-medium text-slate-500">{t("service_form.step_value_hint", { defaultValue: "Что включено и proof" })}</div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label={t("transfer", { defaultValue: "Трансфер" })}>
                                <SelectInput value={details.transfer} onChange={(e) => patchDetails({ transfer: e.target.value })}>
                                  <option value="">{t("food_options.select", { defaultValue: "Выберите вариант" })}</option>
                                  {transferOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                </SelectInput>
                              </Field>
                              <Toggle checked={details.visaIncluded} onChange={(v) => patchDetails({ visaIncluded: v })} label={t("visa_included", { defaultValue: "Виза включена" })} />
                              <Toggle checked={details.insuranceIncluded} onChange={(v) => patchDetails({ insuranceIncluded: v })} label={t("insurance_included", { defaultValue: "Страховка включена" })} />
                              <Toggle checked={details.earlyCheckIn} onChange={(v) => patchDetails({ earlyCheckIn: v })} label={t("early_check_in", { defaultValue: "Раннее заселение" })} />
                              <Toggle checked={details.arrivalFastTrack} onChange={(v) => patchDetails({ arrivalFastTrack: v })} label={t("arrival_fast_track", { defaultValue: "Arrival Fast Track" })} />
                              <Toggle checked={details.changeable} onChange={(v) => patchDetails({ changeable: v })} label={t("changeable", { defaultValue: "Можно вносить изменения" })} />
                            </div>
                          </div>
                          <ImageUploader
                            title={t("service_form.proof_trust_title", { defaultValue: "Подтверждение подлинности" })}
                            hint={t("service_form.proof_trust_hint", { defaultValue: "Скриншоты подтверждения помогают клиенту быстрее решиться открыть контакты поставщика." })}
                            images={details.proofImages || []}
                            onChange={(next) => patchDetails({ proofImages: next })}
                            max={6}
                          />
                        </div>
                      )}

                      {step === 4 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_price", { defaultValue: "Цена" })}</div>
                            <div className="text-sm font-medium text-slate-500">{t("service_form.step_price_hint", { defaultValue: "Стоимость и актуальность" })}</div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={t("net_price", { defaultValue: "Цена нетто" })}><TextInput inputMode="decimal" value={details.netPrice} onChange={(e) => patchDetails({ netPrice: e.target.value })} /></Field>
                            <Field label={t("gross_price", { defaultValue: "Цена для клиента" })}><TextInput inputMode="decimal" value={details.grossPrice} onChange={(e) => patchDetails({ grossPrice: e.target.value })} /></Field>
                            <Field label={t("expiration_timer", { defaultValue: "Таймер актуальности" })} hint={t("service_form.expiration_hint", { defaultValue: "После этого времени предложение станет менее актуальным." })}>
                              <TextInput type="datetime-local" value={details.expiration} onChange={(e) => patchDetails({ expiration: e.target.value })} />
                            </Field>
                            <Toggle checked={details.isActive} onChange={(v) => patchDetails({ isActive: v })} label={t("is_active", { defaultValue: "Актуально" })} />
                          </div>
                        </div>
                      )}

                      {step === 5 && (
                        <div className="rounded-[1.5rem] border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4 shadow-sm">
                          <div className="text-lg font-black text-slate-950">{t("service_form.step_preview", { defaultValue: "Предпросмотр" })}</div>
                          <p className="mt-1 text-sm font-medium leading-6 text-slate-600">{t("service_form.step_preview_hint", { defaultValue: "Проверьте, как клиент увидит вашу услугу." })}</p>
                          <div className="mt-4 rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                            <div className="text-base font-black text-slate-950">{title || t("service_form.preview_title_empty", { defaultValue: "Название услуги" })}</div>
                            <div className="mt-2 text-sm font-bold text-slate-600">✈️ {routeText}</div>
                            <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-800">🗓 {details.startDate || details.startFlightDate || "—"} {details.endDate ? `→ ${details.endDate}` : ""}</div>
                            <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
                              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{t("price", { defaultValue: "Цена" })}</div>
                              <div className="mt-1 text-3xl font-black tracking-[-0.04em]">{priceText || t("service_form.preview_price_empty", { defaultValue: "Цена появится здесь" })}</div>
                            </div>
                            {includedPreview.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{includedPreview.map((x) => <span key={x} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">{x}</span>)}</div>}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <ImageUploader title={t("service_images", { defaultValue: "Фото услуги" })} hint={t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })} images={images} onChange={setImages} max={10} />

                  <div className="sticky bottom-0 z-20 -mx-4 flex gap-2 border-t border-slate-100 bg-white/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
                    {isExtended && step > 1 && (
                      <button type="button" onClick={() => setStep((v) => Math.max(1, v - 1))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600">
                        {t("service_form.prev_step", { defaultValue: "Назад" })}
                      </button>
                    )}
                    {isExtended && step < steps.length ? (
                      <button type="button" onClick={() => setStep((v) => Math.min(steps.length, v + 1))} className="w-full rounded-2xl bg-slate-950 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">
                        {t("service_form.next_step", { defaultValue: "Следующий шаг" })}
                      </button>
                    ) : (
                      <button type="button" onClick={saveService} disabled={saving} className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60">
                        {saving ? t("saving", { defaultValue: "Сохраняю…" }) : t("save_service", { defaultValue: "Сохранить услугу" })}
                      </button>
                    )}
                    {selectedService?.id && <button type="button" onClick={() => deleteService(selectedService)} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white">{t("delete", { defaultValue: "Удалить" })}</button>}
                  </div>
                </div>

                <aside className="hidden xl:block">
                  <div className="sticky top-5 space-y-4">
                    <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
                      <div className="relative h-40 bg-gradient-to-br from-orange-100 via-amber-50 to-sky-50">
                        {images?.[0] ? <img src={images[0]} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400"><div className="text-3xl">🏝️</div><div className="text-xs font-black">{t("service_form.preview_photo_hint", { defaultValue: "Фото появится здесь" })}</div></div>}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent p-4">
                          <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-orange-600">{category ? t(`category.${category}`, { defaultValue: category }) : t("service_form.preview_category", { defaultValue: "Категория" })}</span>
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="line-clamp-2 text-lg font-black leading-snug text-slate-950">{title || t("service_form.preview_title_empty", { defaultValue: "Название услуги" })}</div>
                        <div className="text-xs font-bold text-slate-600">✈️ {routeText}</div>
                        <div className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-800">🗓 {details.startDate || details.startFlightDate || "—"}</div>
                        <div className="rounded-2xl bg-slate-950 p-3 text-white">
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{t("price", { defaultValue: "Цена" })}</div>
                          <div className="mt-1 text-2xl font-black tracking-[-0.04em]">{priceText || t("service_form.preview_price_empty", { defaultValue: "Цена появится здесь" })}</div>
                        </div>
                        <div className="rounded-2xl bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-800 ring-1 ring-orange-100">
                          {t("service_form.preview_tip", { defaultValue: "Так клиент будет воспринимать вашу услугу. Фото и proof повышают доверие." })}
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
