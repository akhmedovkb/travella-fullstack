import { useEffect, useMemo, useState } from "react";

const TYPES = [
  { value: "activity", label: "Событие" },
  { value: "guide", label: "Гид" },
  { value: "transport", label: "Транспорт" },
  { value: "meal", label: "Питание" },
  { value: "hotel", label: "Отель" },
];

const toMinutes = (value) => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const durationText = (start, end) => {
  const minutes = toMinutes(end) - toMinutes(start);
  if (!Number.isFinite(minutes) || minutes <= 0) return "Укажите время";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""].filter(Boolean).join(" ");
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

const hasOverlap = (item, items) => {
  const start = toMinutes(item.start_time);
  const end = toMinutes(item.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return true;
  return items.some((other) => {
    if (other.id === item.id) return false;
    const otherStart = toMinutes(other.start_time);
    const otherEnd = toMinutes(other.end_time);
    return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && start < otherEnd && end > otherStart;
  });
};

export const normalizeScheduleItems = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      id: String(item?.id || `event-${index + 1}`),
      start_time: String(item?.start_time || item?.startTime || "10:00"),
      end_time: String(item?.end_time || item?.endTime || "12:00"),
      title: String(item?.title || "Событие программы"),
      type: String(item?.type || "activity"),
      provider_id: item?.provider_id || null,
      provider_name: String(item?.provider_name || ""),
      service_id: item?.service_id || null,
      service_title: String(item?.service_title || ""),
    }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

export default function TourDayTimeline({ items, onChange, selectedId, onSelect }) {
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
      title: "Новое событие",
      type: "activity",
    };
    onChange([...normalized, item]);
    select(item.id);
  };

  const remove = (id) => {
    const next = normalized.filter((item) => item.id !== id);
    onChange(next);
    if (activeId === id) select(next[0]?.id || null);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-base font-bold text-slate-950">Расписание дня</h3>
          <p className="text-xs text-slate-500">Время определяет доступность и тариф гида или транспорта</p>
        </div>
        <button type="button" onClick={add} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-orange-300 hover:bg-orange-50">
          + Добавить событие
        </button>
      </header>

      {normalized.length === 0 ? (
        <button type="button" onClick={add} className="m-4 flex min-h-28 w-[calc(100%-2rem)] items-center justify-center rounded-md border border-dashed border-slate-300 text-sm font-semibold text-slate-500 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700">
          + Создать первое событие дня
        </button>
      ) : (
        <div className="divide-y divide-slate-100 px-4">
          {normalized.map((item) => {
            const active = item.id === activeId;
            const invalid = hasOverlap(item, normalized);
            return (
              <div key={item.id} className="grid grid-cols-[116px_1fr] gap-3 py-3">
                <div className="pt-2">
                  <div className="text-sm font-bold text-slate-900">{item.start_time}–{item.end_time}</div>
                  <div className={`mt-1 text-xs font-medium ${invalid ? "text-rose-600" : "text-slate-500"}`}>
                    {invalid ? "Проверьте интервал" : durationText(item.start_time, item.end_time)}
                  </div>
                </div>
                <div className={`rounded-md border p-3 transition ${active ? "border-orange-500 bg-orange-50/50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                  <button type="button" className="w-full text-left" onClick={() => select(item.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-950">{item.title || "Без названия"}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.type === "guide" && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">Гид</span>}
                          {item.type === "transport" && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Транспорт</span>}
                          {item.type === "activity" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Программа</span>}
                          {item.provider_name && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{item.provider_name}</span>}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-slate-400">{active ? "Выбрано" : "Изменить"}</span>
                    </div>
                  </button>

                  {active && (
                    <div className="mt-3 grid gap-3 border-t border-orange-100 pt-3 md:grid-cols-[110px_110px_160px_1fr_auto]">
                      <label className="text-xs font-semibold text-slate-500">Начало<input type="time" value={item.start_time} onChange={(e) => patch(item.id, { start_time: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
                      <label className="text-xs font-semibold text-slate-500">Окончание<input type="time" value={item.end_time} onChange={(e) => patch(item.id, { end_time: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
                      <label className="text-xs font-semibold text-slate-500">Тип<select value={item.type} onChange={(e) => patch(item.id, { type: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900">{TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
                      <label className="text-xs font-semibold text-slate-500">Название<input value={item.title} onChange={(e) => patch(item.id, { title: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900" /></label>
                      <button type="button" onClick={() => remove(item.id)} className="self-end rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Удалить</button>
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
