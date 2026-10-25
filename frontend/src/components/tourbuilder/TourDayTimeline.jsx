import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const COMPONENT_TYPES = [
  { value: "transfer", label: "Транспорт", legacyType: "transport" },
  { value: "hotel", label: "Отель", legacyType: "hotel" },
  { value: "tour", label: "Экскурсия / программа", legacyType: "guide" },
  { value: "meal", label: "Питание", legacyType: "meal" },
];

const SUPPORT_TO_TOUR_SUBTYPE = {
  escort: "support_escort",
  meet: "support_meet",
  seeoff: "support_seeoff",
  translation: "support_translation",
  coordinator: "support_coordinator",
};

const componentMeta = (value) => COMPONENT_TYPES.find((item) => item.value === value) || COMPONENT_TYPES[0];

const toMinutes = (value) => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const durationText = (start, end, t) => {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes === endMinutes) return t("tb.timeline.set_time");
  const minutes = endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? t("tb.timeline.hours", { count: hours }) : "", rest ? t("tb.timeline.minutes", { count: rest }) : ""].filter(Boolean).join(" ");
};

const nextTime = (items) => {
  const sorted = [...items].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  return sorted.at(-1)?.end_time || "10:00";
};

const plusHours = (value, hours = 2) => {
  const minutes = toMinutes(value);
  if (!Number.isFinite(minutes)) return "12:00";
  const next = Math.min(minutes + hours * 60, 23 * 60 + 59);
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
};

const addDays = (dateValue, days = 1) => {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const hasOverlap = (item, items) => {
  // Размещение описывает период проживания, а не занятость туриста:
  // оно может пересекаться с экскурсиями, питанием и трансферами.
  if (item.active_service_category === "hotel" || item.type === "hotel") return false;
  const start = toMinutes(item.start_time);
  const rawEnd = toMinutes(item.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd === start) return true;
  const end = rawEnd > start ? rawEnd : rawEnd + 24 * 60;
  return items.some((other) => {
    if (other.id === item.id) return false;
    if (other.active_service_category === "hotel" || other.type === "hotel") return false;
    const otherStart = toMinutes(other.start_time);
    const otherRawEnd = toMinutes(other.end_time);
    if (!Number.isFinite(otherStart) || !Number.isFinite(otherRawEnd) || otherRawEnd === otherStart) return false;
    const otherEnd = otherRawEnd > otherStart ? otherRawEnd : otherRawEnd + 24 * 60;
    return start < otherEnd && end > otherStart;
  });
};

export const normalizeScheduleItems = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item, index) => {
      const rawCategory = item?.active_service_category === "attractions"
        ? "tour"
        : item?.active_service_category || (item?.type === "hotel" ? "hotel" : item?.type === "guide" ? "tour" : item?.type === "meal" ? "meal" : "transfer");
      const rawServices = item?.services && typeof item.services === "object" ? item.services : {};
      const legacySupportSubtype = rawServices?.support?.subtype;
      const services = rawCategory === "support"
        ? {
            ...rawServices,
            tour: {
              ...(rawServices.tour || {}),
              subtype: SUPPORT_TO_TOUR_SUBTYPE[legacySupportSubtype] || "support_escort",
            },
          }
        : rawServices;
      return {
        id: String(item?.id || `event-${index + 1}`),
        start_time: String(item?.start_time || item?.startTime || "10:00"),
        end_time: String(item?.end_time || item?.endTime || "12:00"),
        title: String(rawCategory === "support" ? "Экскурсия / программа" : item?.title || "Компонент программы"),
        type: String(rawCategory === "support" ? "guide" : item?.type || "activity"),
        provider_id: item?.provider_id || null,
        provider_name: String(item?.provider_name || ""),
        service_id: item?.service_id || null,
        service_title: String(item?.service_title || ""),
        services,
        active_service_category: String(rawCategory === "support" ? "tour" : rawCategory),
        end_day_offset: rawCategory === "hotel" ? Math.max(1, Number(item?.end_day_offset || item?.endDayOffset || 1)) : 0,
      };
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

export default function TourDayTimeline({ dayKey, items, onChange, selectedId, onSelect, expandedId = null, onExpandedChange }) {
  const { t, i18n } = useTranslation();
  const normalized = useMemo(() => normalizeScheduleItems(items), [items]);
  const [draftId, setDraftId] = useState(selectedId || normalized[0]?.id || null);
  const activeId = selectedId || draftId;

  useEffect(() => {
    if (activeId && normalized.some((item) => item.id === activeId)) return;
    const next = normalized[0]?.id || null;
    if (!activeId && !next) return;
    setDraftId(next);
    onSelect?.(next);
  }, [activeId, normalized, onSelect]);

  const select = (id) => {
    setDraftId(id);
    onSelect?.(id);
  };

  const patch = (id, changes) => {
    onChange(normalized.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  };

  const add = () => {
    const start = nextTime(normalized);
    const item = {
      id: `event-${Date.now()}`,
      start_time: start,
      end_time: plusHours(start),
      title: "Transport",
      type: "transport",
      active_service_category: "transfer",
    };
    onChange([...normalized, item]);
    select(item.id);
    onExpandedChange?.(item.id);
  };

  const remove = (id) => {
    const next = normalized.filter((item) => item.id !== id);
    onChange(next);
    if (expandedId === id) onExpandedChange?.(null);
    if (activeId === id) select(next[0]?.id || null);
  };

  return (
    <section data-tour-event-day={dayKey} className="overflow-hidden border-y border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-1 py-3 sm:px-3">
        <div>
          <h3 className="text-base font-bold text-slate-950">{t("tb.timeline.title")}</h3>
          <p className="text-xs text-slate-500">{t("tb.timeline.subtitle")}</p>
        </div>
        {normalized.length > 0 && (
          <button type="button" onClick={add} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-orange-300 hover:bg-orange-50">
            {t("tb.timeline.add")}
          </button>
        )}
      </header>

      {normalized.length === 0 ? (
        <button type="button" onClick={add} className="mx-3 my-2 flex min-h-16 w-[calc(100%-1.5rem)] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50/60 px-4 text-sm font-semibold text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700">
          {t("tb.timeline.create_first")}
        </button>
      ) : (
        <div className="divide-y divide-slate-100 px-1 sm:px-3">
          {normalized.map((item) => {
            const active = item.id === activeId;
            const invalid = hasOverlap(item, normalized);
            const component = componentMeta(item.active_service_category);
            const isHotel = component.value === "hotel";
            const checkoutDate = isHotel ? addDays(dayKey, item.end_day_offset || 1) : "";
            const checkoutLabel = checkoutDate
              ? new Intl.DateTimeFormat(i18n.language || "ru", { day: "2-digit", month: "2-digit" }).format(new Date(`${checkoutDate}T12:00:00`))
              : "";
            return (
              <div key={item.id} className="grid min-w-0 gap-2 py-2.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
                <div className="flex items-center justify-between gap-3 px-1 sm:block sm:px-0 sm:pt-2">
                  <div className="text-sm font-bold text-slate-900">
                    {isHotel ? `${item.start_time} → ${checkoutLabel} ${item.end_time}` : `${item.start_time}–${item.end_time}`}
                  </div>
                  <div className={`mt-1 text-xs font-medium ${invalid ? "text-rose-600" : "text-slate-500"}`}>
                    {isHotel ? t("tb.timeline.nights", { count: item.end_day_offset || 1 }) : invalid ? t("tb.timeline.check_interval") : durationText(item.start_time, item.end_time, t)}
                  </div>
                </div>
                <div className={`min-w-0 rounded-md border px-3 py-2.5 transition ${active ? "border-orange-500 bg-orange-50/40 ring-1 ring-orange-200" : "border-slate-200 bg-white hover:border-slate-400"}`}>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { select(item.id); onExpandedChange?.(null); }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-950">{t(`tb.timeline.components.${component.value}`)}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{t(`tb.timeline.components.${component.value}`)}</span>
                          {item.provider_name && <span className="max-w-full break-words rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{item.provider_name}</span>}
                          {item.services?.guide?.provider_name && <span className="max-w-full break-words rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">{t("tb.timeline.guide")}: {item.services.guide.provider_name}</span>}
                          {item.services?.tour?.subtype && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">{t(`tb.timeline.tour_types.${item.services.tour.subtype}`)}</span>}
                          {item.services?.support?.subtype && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">{t(`tb.timeline.support_types.${item.services.support.subtype}`)}</span>}
                          {item.services?.transport?.subtype && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{t(`tb.timeline.transport_types.${item.services.transport.subtype}`)}</span>}
                          {item.services?.transport?.provider_name && <span className="max-w-full break-words rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{t("tb.transport")}: {item.services.transport.provider_name}</span>}
                          {item.services?.transport?.flight?.raw_offer_id && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">{t("tb.timeline.flight_selected")}</span>}
                          {item.services?.transport?.rail?.price > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{t("tb.timeline.rail")} · {Number(item.services.transport.rail.price).toLocaleString()} {item.services.transport.rail.currency || "UZS"} / {t("tb.timeline.person_short")}</span>}
                          {item.services?.hotel?.provider_name && <span className="max-w-full break-words rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">{t("tb.hotel")}: {item.services.hotel.provider_name}</span>}
                          {item.services?.attractions?.items?.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{t("tb.timeline.attractions")}: {item.services.attractions.items.length}</span>}
                          {item.services?.meal?.items?.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{t("tb.meals")}</span>}
                        </div>
                      </div>
                      {active && <span className="hidden text-xs font-semibold text-orange-700 sm:inline">{t("tb.timeline.selected")}</span>}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextExpandedId = expandedId === item.id ? null : item.id;
                      select(item.id);
                      onExpandedChange?.(nextExpandedId);
                    }}
                    className="w-full shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:w-auto"
                  >
                    {expandedId === item.id ? t("tb.timeline.done") : t("tb.timeline.configure")}
                  </button>
                  </div>

                  {expandedId === item.id && (
                    <div className="mt-3 grid min-w-0 items-end gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2 xl:grid-cols-[120px_160px_minmax(0,1fr)_auto]">
                      <label className="flex h-full flex-col justify-end text-xs font-semibold text-slate-500">{t(isHotel ? "tb.timeline.checkin" : "tb.timeline.start")}<input type="time" value={item.start_time} onChange={(e) => patch(item.id, { start_time: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
                      <label className="flex h-full flex-col justify-end text-xs font-semibold text-slate-500">{t(isHotel ? "tb.timeline.checkout_next_day" : "tb.timeline.end")}<input type="time" value={item.end_time} onChange={(e) => patch(item.id, { end_time: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
                      <label className="flex h-full flex-col justify-end text-xs font-semibold text-slate-500">{t("tb.timeline.component")}<select value={component.value} onChange={(e) => { const next = componentMeta(e.target.value); const hotelDefaults = next.value === "hotel" && component.value !== "hotel" ? { start_time: "14:00", end_time: "12:00", end_day_offset: 1 } : { end_day_offset: 0 }; patch(item.id, { active_service_category: next.value, type: next.legacyType, title: next.label, ...hotelDefaults }); }} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900">{COMPONENT_TYPES.map((option) => <option key={option.value} value={option.value}>{t(`tb.timeline.components.${option.value}`)}</option>)}</select></label>
                      <button type="button" onClick={() => remove(item.id)} className="self-end rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">{t("tb.remove")}</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
