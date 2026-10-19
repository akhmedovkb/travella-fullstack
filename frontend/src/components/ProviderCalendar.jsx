// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { enUS, ru, uz } from "date-fns/locale";
import { CalendarDays, Check, CircleAlert, LockKeyhole, MapPin, Save, UserRound } from "lucide-react";

const CALENDAR_PROVIDER_TYPES = new Set(["guide", "transport"]);

/** YYYY-MM-DD из строки/объекта/Date */
const toYMD = (val) => {
  if (!val) return "";
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = val?.date || val?.day || val?.ymd || val?.bookingDate || "";
  return String(s).slice(0, 10);
};

/** Локальная Date из YYYY-MM-DD */
const ymdToLocalDate = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

// локальная «полночь сегодня»
const getStartOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const ProviderCalendar = ({ token }) => {
  const { t, i18n } = useTranslation();

  // ручные блокировки (YYYY-MM-DD)
  const [manual, setManual] = useState([]);
  const [manualInitial, setManualInitial] = useState([]);

  // системно занятые по бронированиям (YYYY-MM-DD)
  const [booked, setBooked] = useState([]);

  // подробности по бронированиям: { [ymd]: [{ name, phone, telegram, profileId, profileUrl }] }
  const [bookedDetails, setBookedDetails] = useState({});

  // тип провайдера: guide / transport / ...
  const [providerType, setProviderType] = useState("");
  const [profileResolved, setProfileResolved] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [activeYmd, setActiveYmd] = useState("");

  const cfg = useMemo(() => {
    const stored =
      token ||
      localStorage.getItem("providerToken") ||
      localStorage.getItem("token");
    return { headers: { Authorization: `Bearer ${stored}` } };
  }, [token]);

  const calendarEnabled = CALENDAR_PROVIDER_TYPES.has(String(providerType || "").toLowerCase());

  // профиль провайдера (тип)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`,
          cfg
        );
        if (!cancel) setProviderType(data?.type || "");
      } catch { /* ignore */ }
      finally {
        if (!cancel) setProfileResolved(true);
      }
    })();
    return () => { cancel = true; };
  }, [cfg]);

  // загрузка календаря
  useEffect(() => {
    if (!profileResolved || !calendarEnabled) return undefined;
    let cancelled = false;

    const normalizeDetailsList = (arr) => {
      const map = {};
      (arr || []).forEach((item) => {
        const date = toYMD(item?.date || item);
        if (!date) return;
        const info = {
          name:
            item?.name ||
            item?.clientName ||
            item?.fullName ||
            item?.companyName ||
            item?.title ||
            "",
          phone: item?.phone || item?.clientPhone || item?.phoneNumber || "",
          telegram:
            (item?.telegram ||
              item?.telegramUsername ||
              item?.telegram_handle ||
              item?.tg ||
              "")?.replace?.(/^@/, "") || "",
          profileId: item?.profileId || item?.clientId || item?.userId || item?.id || null,
          profileUrl:
            item?.profileUrl ||
            item?.url ||
            (item?.profileId ? `/profile/${item.profileId}` : null),
        };
        if (!map[date]) map[date] = [];
        map[date].push(info);
      });
      return map;
    };

    const load = async () => {
      setCalendarLoading(true);
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/calendar`,
          cfg
        );
        if (cancelled) return;

        const bookedArr = (Array.isArray(data?.booked) ? data.booked : [])
          .map((x) => (typeof x === "string" ? x.slice(0, 10) : toYMD(x?.date || x)))
          .filter(Boolean);

        const blockedArr = (Array.isArray(data?.blocked) ? data.blocked : [])
          .map(toYMD)
          .filter(Boolean);

        const detailsMap = normalizeDetailsList(data?.bookedDetails || []);

        setManual(blockedArr);
        setManualInitial(blockedArr);
        setBooked(bookedArr);
        setBookedDetails(detailsMap);

        if (!Object.keys(detailsMap).length) {
          try {
            const det = await axios
              .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-details`, cfg)
              .then((r) => r.data)
              .catch(() => null);
            if (!cancelled && Array.isArray(det)) {
              setBookedDetails(normalizeDetailsList(det));
            }
          } catch { /* ignore */ }
        }
      } catch {
        try {
          const [blk, bkd] = await Promise.all([
            axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, cfg).then((r) => r.data).catch(() => []),
            axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-dates`,  cfg).then((r) => r.data).catch(() => []),
          ]);
          if (cancelled) return;

          const blockedArr = (Array.isArray(blk) ? blk : []).map(toYMD).filter(Boolean);
          const bookedArr  = (Array.isArray(bkd) ? bkd : []).map(toYMD).filter(Boolean);

          setManual(blockedArr);
          setManualInitial(blockedArr);
          setBooked(bookedArr);

          try {
            const det = await axios
              .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-details`, cfg)
              .then((r) => r.data)
              .catch(() => null);
            if (!cancelled && Array.isArray(det)) {
              setBookedDetails(normalizeDetailsList(det));
            }
          } catch { /* ignore */ }
        } catch (e) {
          if (!cancelled) {
            console.error("Ошибка загрузки календаря", e);
            toast.error(t("calendar.load_error") || "Не удалось загрузить календарь");
          }
        }
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [calendarEnabled, cfg, profileResolved, t]);

  // преобразования дат
  const manualAsDates = useMemo(() => manual.map(ymdToLocalDate).filter(Boolean), [manual]);
  const bookedAsDates = useMemo(() => booked.map(ymdToLocalDate).filter(Boolean), [booked]);

  // разрез: сохранённые вручную / новые несохранённые
  const manualSavedYmd = useMemo(
    () => manual.filter((d) => manualInitial.includes(d)),
    [manual, manualInitial]
  );
  const manualNewYmd = useMemo(
    () => manual.filter((d) => !manualInitial.includes(d)),
    [manual, manualInitial]
  );
  const manualSavedAsDates = useMemo(
    () => manualSavedYmd.map(ymdToLocalDate).filter(Boolean),
    [manualSavedYmd]
  );
  const manualNewAsDates = useMemo(
    () => manualNewYmd.map(ymdToLocalDate).filter(Boolean),
    [manualNewYmd]
  );

  // локаль и первый день недели
  const dpLocale = useMemo(() => {
    const lang = (i18n.language || "en").split("-")[0];
    if (lang === "ru") return ru;
    if (lang === "uz") return uz;
    return enUS;
  }, [i18n.language]);

  const weekStartsOn = useMemo(() => {
    const lang = (i18n.language || "en").split("-")[0];
    return lang === "ru" || lang === "uz" ? 1 : 0;
  }, [i18n.language]);

  const startOfToday = useMemo(() => getStartOfToday(), []);
  const pastMatcher = useMemo(() => ({ before: startOfToday }), [startOfToday]);

  // контролируемый выбор
  const handleSelect = (dates) => {
    const arr = Array.isArray(dates) ? dates : dates ? [dates] : [];
    const ymds = arr.map(toYMD).filter(Boolean);
    const filtered = ymds.filter((d) => !booked.includes(d)); // нельзя выбирать системно занятые
    setManual(filtered);
  };

  const handleSave = async () => {
    const final = Array.from(new Set(manual)).sort();
    setSaving(true);
    try {
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        { dates: final },
        cfg
      );
      setManualInitial(final);
      toast.success(data?.message || t("calendar.saved_successfully") || "Даты сохранены");
    } catch (e) {
      console.error("Ошибка сохранения занятых дат", e);
      toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
    } finally {
      setSaving(false);
    }
  };

  // только прошлые запрещаем (booked НЕ дизейблим, чтобы работал hover)
  const disabledMatchers = useMemo(() => [pastMatcher], [pastMatcher]);

  const hasChanges = useMemo(() => {
    const current = [...new Set(manual)].sort().join(",");
    const saved = [...new Set(manualInitial)].sort().join(",");
    return current !== saved;
  }, [manual, manualInitial]);

  const changedDatesCount = useMemo(() => {
    const allDates = new Set([...manual, ...manualInitial]);
    return [...allDates].filter((date) => manual.includes(date) !== manualInitial.includes(date)).length;
  }, [manual, manualInitial]);

  const activeDate = activeYmd ? ymdToLocalDate(activeYmd) : null;
  const activeBookedDetails = activeYmd ? bookedDetails[activeYmd] || [] : [];
  const activeIsBooked = activeYmd ? booked.includes(activeYmd) : false;
  const activeIsManual = activeYmd ? manual.includes(activeYmd) : false;
  const activeIsChanged = activeYmd ? manual.includes(activeYmd) !== manualInitial.includes(activeYmd) : false;
  const activeIsPast = activeDate ? activeDate < startOfToday : false;
  const activeDateLabel = activeDate
    ? new Intl.DateTimeFormat(i18n.language || "en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(activeDate)
    : "";

  const toggleActiveDate = () => {
    if (!activeYmd || activeIsBooked || activeIsPast) return;
    setManual((current) => current.includes(activeYmd) ? current.filter((date) => date !== activeYmd) : [...current, activeYmd]);
  };

  const typeLabel = String(providerType || "").toLowerCase() === "guide"
    ? t("calendar.provider_guide")
    : t("calendar.provider_transport");

  const DayCell = (dayProps) => {
    const dateYmd = toYMD(dayProps.date);
    const isBookedDay = booked.includes(dateYmd);
    const isSavedManual = manualSavedYmd.includes(dateYmd);
    const isChanged = manual.includes(dateYmd) !== manualInitial.includes(dateYmd);
    const isActive = activeYmd === dateYmd;

    const dayNum = dayProps.date.getDate();
    const statusColor = isBookedDay
      ? "bg-slate-700"
      : isChanged
        ? "bg-orange-600"
        : isSavedManual
          ? "bg-sky-600"
          : "";

    return (
      <div className={`relative flex h-full w-full items-start p-2 text-left ${isActive ? "ring-2 ring-inset ring-orange-500" : ""}`}>
        <span className="text-sm font-black">{dayNum}</span>
        {statusColor ? <span aria-hidden="true" className={`absolute inset-x-2 bottom-2 h-1 rounded-full ${statusColor}`} /> : null}
      </div>
    );
  };

  if (!profileResolved) {
    return <div className="mx-auto max-w-7xl px-4 py-16 text-center text-sm font-semibold text-slate-500">{t("calendar.loading")}</div>;
  }

  if (!calendarEnabled) {
    return (
      <div className="mx-auto mt-6 max-w-4xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <div className="text-xs font-black uppercase text-orange-600">{t("calendar.blocking_title")}</div>
        <h1 className="mt-3 text-2xl font-black text-slate-950">{t("calendar.unavailable_title")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          {t("calendar.unavailable_description")}
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-7">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <header className="px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-black uppercase text-orange-600"><CalendarDays size={15} />{typeLabel} · {t("calendar.availability")}</div>
              <h1 className="mt-2 text-2xl font-black text-slate-950">{t("calendar.blocking_title")}</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t("calendar.workspace_description")}</p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="min-w-0 px-3 py-2.5 sm:min-w-28 sm:px-4"><div className="text-lg font-black text-slate-950">{booked.length}</div><div className="truncate text-[11px] font-bold text-slate-500">{t("calendar.by_bookings")}</div></div>
              <div className="min-w-0 px-3 py-2.5 sm:min-w-28 sm:px-4"><div className="text-lg font-black text-sky-700">{manualSavedYmd.length}</div><div className="truncate text-[11px] font-bold text-slate-500">{t("calendar.closed_by_you")}</div></div>
              <div className="min-w-0 px-3 py-2.5 sm:min-w-28 sm:px-4"><div className="text-lg font-black text-orange-700">{changedDatesCount}</div><div className="truncate text-[11px] font-bold text-slate-500">{t("calendar.unsaved")}</div></div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-600 sm:px-7">
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-slate-700" />{t("calendar.booked")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-600" />{t("calendar.closed_by_you")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-600" />{t("calendar.unsaved")}</span>
          <span className="ml-auto hidden items-center gap-2 text-slate-400 sm:flex"><LockKeyhole size={14} />{t("calendar.click_hint")}</span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="relative min-w-0 px-2 py-4 sm:px-6 sm:py-6">
            {calendarLoading ? <div className="py-20 text-center text-sm font-semibold text-slate-500">{t("calendar.loading_availability")}</div> : (
              <DayPicker
                locale={dpLocale}
                weekStartsOn={weekStartsOn}
                mode="multiple"
                selected={manualAsDates}
                onSelect={handleSelect}
                disabled={disabledMatchers}
                modifiers={{ past: pastMatcher, booked: bookedAsDates, manualSaved: manualSavedAsDates, manualNew: manualNewAsDates }}
                modifiersClassNames={{ booked: "bg-slate-100 text-slate-950", past: "text-gray-400 cursor-not-allowed" }}
                modifiersStyles={{
                  manualSaved: { backgroundColor: "#f0f9ff", color: "#0f172a" },
                  manualNew: { backgroundColor: "#fff7ed", color: "#0f172a" },
                  booked: { backgroundColor: "#f1f5f9", color: "#0f172a", opacity: 1 },
                }}
                components={{ DayContent: DayCell }}
                className="rdp w-full !m-0 text-slate-900"
                classNames={{
                  months: "w-full", month: "w-full", table: "w-full table-fixed",
                  caption: "relative mb-3 flex h-10 items-center justify-center",
                  caption_label: "text-base font-black capitalize text-slate-950 sm:text-lg",
                  nav: "absolute right-0 top-0 flex gap-2",
                  nav_button: "h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50",
                  head_row: "grid grid-cols-7 border-b border-slate-100",
                  head_cell: "py-2.5 text-center text-[10px] font-black uppercase text-slate-400 sm:text-[11px]",
                  row: "grid grid-cols-7 border-b border-slate-100 last:border-b-0",
                  cell: "relative h-16 border-r border-slate-100 last:border-r-0 sm:h-20",
                  day: "rdp-day relative h-full w-full text-sm font-bold transition hover:bg-orange-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500",
                }}
                styles={{
                  months: { width: "100%" },
                  month: { width: "100%" },
                  table: { width: "100%" },
                  day: { width: "100%", maxWidth: "100%", height: "100%", border: 0, borderRadius: 0 },
                }}
                onDayClick={(date) => setActiveYmd(toYMD(date))}
              />
            )}
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0 lg:p-6">
            {!activeYmd ? (
              <div className="flex min-h-44 flex-col items-center justify-center text-center lg:min-h-full">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200"><CalendarDays size={20} /></div>
                <div className="mt-3 text-sm font-black text-slate-800">{t("calendar.select_day_title")}</div>
                <div className="mt-1 max-w-52 text-xs leading-5 text-slate-500">{t("calendar.select_day_hint")}</div>
              </div>
            ) : (
              <div>
                <div className="text-[11px] font-black uppercase text-slate-400">{t("calendar.selected_day")}</div>
                <div className="mt-1 text-lg font-black capitalize text-slate-950">{activeDateLabel}</div>
                <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-black ${activeIsBooked ? "bg-slate-200 text-slate-800" : activeIsChanged ? "bg-orange-100 text-orange-800" : activeIsManual ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}>
                  <span className={`h-2 w-2 rounded-full ${activeIsBooked ? "bg-slate-700" : activeIsChanged ? "bg-orange-600" : activeIsManual ? "bg-sky-600" : "bg-emerald-600"}`} />
                  {activeIsBooked ? t("calendar.booked") : activeIsChanged ? t("calendar.unsaved") : activeIsManual ? t("calendar.closed_by_you") : t("calendar.available")}
                </div>
                {activeIsBooked && (
                  <div className="mt-5 space-y-3">
                    <div className="text-xs font-black uppercase text-slate-400">{t("calendar.booking_details")}</div>
                    {activeBookedDetails.length ? activeBookedDetails.map((item, index) => (
                      <div key={index} className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-900"><UserRound size={15} className="text-slate-400" />{item.name || t("calendar.unknown_name")}</div>
                        {item.phone ? <a className="mt-2 block text-sm font-bold text-slate-600 hover:text-orange-600" href={`tel:${item.phone}`}>{item.phone}</a> : null}
                        {item.telegram ? <a className="mt-1 block text-sm font-bold text-slate-600 hover:text-orange-600" href={`https://t.me/${String(item.telegram).replace(/^@/, "")}`} target="_blank" rel="noreferrer">@{String(item.telegram).replace(/^@/, "")}</a> : null}
                      </div>
                    )) : <div className="flex items-center gap-2 text-sm text-slate-500"><MapPin size={15} />{t("calendar.booking_without_contacts")}</div>}
                  </div>
                )}
                {!activeIsBooked && !activeIsPast && (
                  <button type="button" onClick={toggleActiveDate} className={`mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-black transition ${activeIsManual ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100" : "bg-slate-950 text-white hover:bg-slate-800"}`}>
                    <LockKeyhole size={15} />{activeIsManual ? t("calendar.open_day") : t("calendar.close_day")}
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>

        <footer className="flex flex-col gap-4 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className={`flex items-center gap-2 text-sm font-bold ${hasChanges ? "text-orange-700" : "text-emerald-700"}`}>
            {hasChanges ? <CircleAlert size={17} /> : <Check size={17} />}
            {hasChanges ? t("calendar.unsaved_changes", { count: changedDatesCount }) : t("calendar.all_saved")}
          </div>
          <button type="button" onClick={handleSave} disabled={!hasChanges || saving} className="flex h-11 items-center justify-center gap-2 rounded-md bg-orange-600 px-6 text-sm font-black text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            <Save size={17} />{saving ? t("calendar.saving") : t("calendar.save_blocked_dates")}
          </button>
        </footer>
      </section>
    </main>
  );
};

export default ProviderCalendar;
