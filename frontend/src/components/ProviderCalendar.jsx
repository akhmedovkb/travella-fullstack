// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, LockKeyhole, MessageCircle, Save, UserRound } from "lucide-react";

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
  const [calendarBookings, setCalendarBookings] = useState([]);

  // тип провайдера: guide / transport / ...
  const [providerType, setProviderType] = useState("");
  const [profileResolved, setProfileResolved] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [activeYmd, setActiveYmd] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const timelineRef = useRef(null);
  const dragSelectionRef = useRef({ active: false, mode: "add", touched: new Set() });

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
        setCalendarBookings(Array.isArray(data?.bookings) ? data.bookings : []);

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

  const manualSavedYmd = useMemo(
    () => manual.filter((d) => manualInitial.includes(d)),
    [manual, manualInitial]
  );

  const startOfToday = useMemo(() => getStartOfToday(), []);

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
  const normalizedBookings = useMemo(() => calendarBookings.map((booking) => ({
    ...booking,
    dates: (Array.isArray(booking?.dates) ? booking.dates : []).map(toYMD).filter(Boolean),
  })), [calendarBookings]);
  const bookingByDate = useMemo(() => {
    const map = {};
    normalizedBookings.forEach((booking) => booking.dates.forEach((date) => { if (!map[date]) map[date] = booking; }));
    return map;
  }, [normalizedBookings]);
  const activeBooking = activeYmd ? bookingByDate[activeYmd] || null : null;
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

  const monthDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => new Date(year, month, index + 1));
  }, [visibleMonth]);
  const monthInputValue = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthTitle = new Intl.DateTimeFormat(i18n.language || "en", { month: "long", year: "numeric" }).format(visibleMonth);

  const moveMonth = (delta) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  const goToday = () => {
    const today = getStartOfToday();
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setActiveYmd(toYMD(today));
  };
  const updateTimelineDate = (dateYmd, mode) => {
    setActiveYmd(dateYmd);
    const date = ymdToLocalDate(dateYmd);
    if (!date || date < startOfToday || booked.includes(dateYmd)) return;
    setManual((current) => {
      if (mode === "add") return current.includes(dateYmd) ? current : [...current, dateYmd];
      return current.filter((item) => item !== dateYmd);
    });
  };

  const startTimelineDrag = (event, dateYmd) => {
    if (event.button !== 0) return;
    const date = ymdToLocalDate(dateYmd);
    if (!date || date < startOfToday || booked.includes(dateYmd)) {
      setActiveYmd(dateYmd);
      return;
    }
    event.preventDefault();
    const mode = manual.includes(dateYmd) ? "remove" : "add";
    dragSelectionRef.current = { active: true, mode, touched: new Set([dateYmd]) };
    updateTimelineDate(dateYmd, mode);
  };

  const continueTimelineDrag = (dateYmd) => {
    const drag = dragSelectionRef.current;
    if (!drag.active || drag.touched.has(dateYmd)) return;
    drag.touched.add(dateYmd);
    updateTimelineDate(dateYmd, drag.mode);
  };

  useEffect(() => {
    const stopDrag = () => { dragSelectionRef.current.active = false; };
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, []);

  useEffect(() => {
    if (calendarLoading || !timelineRef.current) return undefined;
    const today = getStartOfToday();
    if (visibleMonth.getFullYear() !== today.getFullYear() || visibleMonth.getMonth() !== today.getMonth()) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const viewport = timelineRef.current;
      if (!viewport) return;
      const dayWidth = 64;
      const target = (today.getDate() - 1) * dayWidth;
      viewport.scrollTo({
        left: Math.max(0, target - (viewport.clientWidth / 2) + (dayWidth / 2)),
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendarLoading, visibleMonth]);

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
              <div className="min-w-0 px-3 py-2.5 sm:min-w-28 sm:px-4"><div className="text-lg font-black text-slate-700">{manualSavedYmd.length}</div><div className="truncate text-[11px] font-bold text-slate-500">{t("calendar.closed_by_you")}</div></div>
              <div className="min-w-0 px-3 py-2.5 sm:min-w-28 sm:px-4"><div className="text-lg font-black text-orange-700">{changedDatesCount}</div><div className="truncate text-[11px] font-bold text-slate-500">{t("calendar.unsaved")}</div></div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-600 sm:px-7">
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" />{t("calendar.booked")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-slate-700" />{t("calendar.closed_by_you")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-600" />{t("calendar.unsaved")}</span>
          <span className="ml-auto hidden items-center gap-2 text-slate-400 sm:flex"><LockKeyhole size={14} />{t("calendar.click_hint")}</span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="relative min-w-0 bg-slate-100/60">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
              <label className="relative flex h-10 min-w-48 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-black capitalize text-slate-800 transition hover:bg-slate-50 focus-within:border-orange-400">
                <span className="sr-only">{t("calendar.choose_month")}</span>
                <CalendarDays size={16} className="text-slate-400" />
                <span>{monthTitle}</span>
                <input
                  type="month"
                  value={monthInputValue}
                  onChange={(event) => {
                    const [year, month] = event.target.value.split("-").map(Number);
                    if (year && month) setVisibleMonth(new Date(year, month - 1, 1));
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <button type="button" onClick={goToday} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50">{t("calendar.today")}</button>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => moveMonth(-1)} aria-label={t("calendar.previous_month")} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"><ChevronLeft size={18} /></button>
                <button type="button" onClick={() => moveMonth(1)} aria-label={t("calendar.next_month")} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"><ChevronRight size={18} /></button>
              </div>
            </div>

            {calendarLoading ? <div className="bg-white py-24 text-center text-sm font-semibold text-slate-500">{t("calendar.loading_availability")}</div> : (
              <div className="flex min-h-[290px] border-b border-slate-200 bg-white">
                <div className="z-10 w-32 shrink-0 border-r border-slate-200 bg-white sm:w-44">
                  <div className="flex h-20 items-end border-b border-slate-200 px-3 pb-3 text-sm font-black capitalize text-slate-900 sm:px-4">{monthTitle}</div>
                  <div className="flex h-28 flex-col justify-center px-3 sm:px-4">
                    <div className="text-sm font-black text-slate-950">{t("calendar.my_availability")}</div>
                    <div className="mt-1 text-xs leading-4 text-slate-500">{typeLabel}</div>
                  </div>
                </div>

                <div
                  ref={timelineRef}
                  className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
                  style={{ scrollbarColor: "#cbd5e1 #f8fafc", scrollbarWidth: "thin" }}
                >
                  <div className="flex min-w-max">
                    {monthDays.map((date) => {
                      const ymd = toYMD(date);
                      const weekday = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" }).format(date);
                      const weekend = date.getDay() === 0 || date.getDay() === 6;
                      const isToday = ymd === toYMD(startOfToday);
                      const isPast = date < startOfToday;
                      const isManual = manual.includes(ymd);
                      const isChanged = isManual !== manualInitial.includes(ymd);
                      const booking = bookingByDate[ymd];
                      const previous = new Date(date); previous.setDate(date.getDate() - 1);
                      const next = new Date(date); next.setDate(date.getDate() + 1);
                      const continuesLeft = booking && bookingByDate[toYMD(previous)]?.id === booking.id;
                      const continuesRight = booking && bookingByDate[toYMD(next)]?.id === booking.id;
                      const manualContinuesLeft = isManual && !isChanged && manual.includes(toYMD(previous)) && manualInitial.includes(toYMD(previous));
                      const manualContinuesRight = isManual && !isChanged && manual.includes(toYMD(next)) && manualInitial.includes(toYMD(next));
                      const changedContinuesLeft = isManual && isChanged && manual.includes(toYMD(previous)) && !manualInitial.includes(toYMD(previous));
                      const changedContinuesRight = isManual && isChanged && manual.includes(toYMD(next)) && !manualInitial.includes(toYMD(next));
                      const selected = activeYmd === ymd;
                      return (
                        <div key={ymd} className="w-16 shrink-0 border-r border-slate-200 last:border-r-0">
                          <button type="button" onClick={() => setActiveYmd(ymd)} className={`flex h-20 w-full flex-col items-center justify-center border-b border-slate-200 transition ${selected ? "bg-orange-50 ring-2 ring-inset ring-orange-500" : "bg-white hover:bg-slate-50"}`}>
                            <span className={`text-[11px] font-bold uppercase ${weekend ? "text-rose-500" : "text-slate-400"}`}>{weekday}</span>
                            <span className={`mt-1 flex h-8 w-8 items-center justify-center rounded-md text-sm font-black ${isToday ? "bg-slate-950 text-white" : weekend ? "text-rose-600" : "text-slate-900"}`}>{date.getDate()}</span>
                          </button>
                          <button
                            type="button"
                            onPointerDown={(event) => startTimelineDrag(event, ymd)}
                            onPointerEnter={() => continueTimelineDrag(ymd)}
                            disabled={isPast}
                            className={`relative h-28 w-full touch-none select-none overflow-hidden transition disabled:cursor-not-allowed ${selected ? "ring-2 ring-inset ring-orange-500" : ""} ${isPast ? "bg-slate-50 opacity-45" : isChanged ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
                          >
                            {booking ? (
                              <span className={`absolute top-1/2 flex h-7 -translate-y-1/2 items-center bg-emerald-600 px-2 text-left text-[10px] font-black text-white ${continuesLeft ? "left-0" : "left-1 rounded-l-full"} ${continuesRight ? "right-0" : "right-1 rounded-r-full"}`}>
                                {!continuesLeft ? (booking.customer_name || `#${booking.id}`) : ""}
                              </span>
                            ) : null}
                            {isManual && !booking ? (
                              <span className={`absolute top-1/2 h-7 -translate-y-1/2 ${isChanged ? `bg-orange-600 ${changedContinuesLeft ? "left-0" : "left-1 rounded-l-full"} ${changedContinuesRight ? "right-0" : "right-1 rounded-r-full"}` : `bg-slate-700 ${manualContinuesLeft ? "left-0" : "left-1 rounded-l-full"} ${manualContinuesRight ? "right-0" : "right-1 rounded-r-full"}`}`} />
                            ) : null}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
                <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-black ${activeIsBooked ? "bg-emerald-100 text-emerald-800" : activeIsChanged ? "bg-orange-100 text-orange-800" : activeIsManual ? "bg-slate-200 text-slate-800" : "bg-slate-200 text-slate-800"}`}>
                  <span className={`h-2 w-2 rounded-full ${activeIsBooked ? "bg-emerald-600" : activeIsChanged ? "bg-orange-600" : activeIsManual ? "bg-slate-700" : "bg-slate-500"}`} />
                  {activeIsBooked ? t("calendar.booked") : activeIsChanged ? t("calendar.unsaved") : activeIsManual ? t("calendar.closed_by_you") : t("calendar.available")}
                </div>
                {activeIsBooked && (
                  <div className="mt-5 space-y-4">
                    {activeBooking ? (
                      <>
                        <div className="border-b border-slate-200 pb-4">
                          <div className="text-xs font-bold text-slate-400">{t("calendar.booking_number", { number: activeBooking.id })}</div>
                          <div className="mt-1 text-sm font-black text-slate-950">{activeBooking.service_title || t("calendar.service_booking")}</div>
                        </div>
                        <div>
                          <div className="text-xs font-black uppercase text-slate-400">{t("calendar.customer")}</div>
                          <div className="mt-2 flex items-center gap-2 text-sm font-black text-slate-900"><UserRound size={16} className="text-slate-400" />{activeBooking.customer_name || t("calendar.unknown_name")}</div>
                          {activeBooking.customer_phone ? <a className="mt-2 block text-sm font-bold text-slate-600 hover:text-orange-600" href={`tel:${activeBooking.customer_phone}`}>{activeBooking.customer_phone}</a> : null}
                          {activeBooking.customer_telegram ? <a className="mt-1 block text-sm font-bold text-slate-600 hover:text-orange-600" href={`https://t.me/${String(activeBooking.customer_telegram).replace(/^@/, "")}`} target="_blank" rel="noreferrer">@{String(activeBooking.customer_telegram).replace(/^@/, "")}</a> : null}
                        </div>
                        {activeBooking.provider_price ? (
                          <div className="border-t border-slate-200 pt-4">
                            <div className="text-xs font-black uppercase text-slate-400">{t("calendar.booking_price")}</div>
                            <div className="mt-1 text-lg font-black text-slate-950">{Number(activeBooking.provider_price).toLocaleString(i18n.language || "en")} {activeBooking.currency || "UZS"}</div>
                          </div>
                        ) : null}
                        {activeBooking.client_message ? (
                          <div className="border-t border-slate-200 pt-4">
                            <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-400"><MessageCircle size={14} />{t("calendar.customer_comment")}</div>
                            <div className="mt-2 text-sm leading-5 text-slate-600">{activeBooking.client_message}</div>
                          </div>
                        ) : null}
                        <a href="/dashboard/bookings" className="flex h-10 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-slate-100">{t("calendar.open_booking")}</a>
                      </>
                    ) : activeBookedDetails.length ? activeBookedDetails.map((item, index) => (
                      <div key={index} className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-900"><UserRound size={15} className="text-slate-400" />{item.name || t("calendar.unknown_name")}</div>
                        {item.phone ? <a className="mt-2 block text-sm font-bold text-slate-600 hover:text-orange-600" href={`tel:${item.phone}`}>{item.phone}</a> : null}
                      </div>
                    )) : <div className="text-sm text-slate-500">{t("calendar.booking_without_contacts")}</div>}
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
