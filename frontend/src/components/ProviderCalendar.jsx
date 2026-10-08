// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { enUS, ru, uz } from "date-fns/locale";

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

  // для tooltip
  const [hoveredYmd, setHoveredYmd] = useState(null);

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

  // показывать подсказку только гиду/транспортнику
  const isGuideOrTransport = useMemo(() => {
    const tp = (providerType || "").toLowerCase();
    return tp === "guide" || tp === "transport";
  }, [providerType]);

  const hasChanges = useMemo(() => {
    const current = [...new Set(manual)].sort().join(",");
    const saved = [...new Set(manualInitial)].sort().join(",");
    return current !== saved;
  }, [manual, manualInitial]);

  const typeLabel = String(providerType || "").toLowerCase() === "guide" ? "Гид" : "Транспорт";

  // Кастомный контент ячейки дня с tooltip
    const DayCell = (dayProps) => {
    const dateYmd = toYMD(dayProps.date);
    const infoList = bookedDetails[dateYmd] || [];
    const isBookedDay = booked.includes(dateYmd);
    const showTooltip = isGuideOrTransport && isBookedDay && hoveredYmd === dateYmd;

    const dayNum = dayProps.date.getDate();

    return (
      <div className="relative flex items-center justify-center w-full h-full">
        <span>{dayNum}</span>

        {showTooltip && (
          <div
            role="tooltip"
            className="absolute z-50 -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-white border border-gray-200 rounded-lg shadow-xl p-2 w-64 text-xs text-gray-800"
            onMouseEnter={() => setHoveredYmd(dateYmd)}
            onMouseLeave={() => setHoveredYmd(null)}
          >
            <div className="max-h-48 overflow-auto space-y-2">
              {infoList.length ? (
                infoList.map((it, idx) => {
                  const profileHref =
                    it?.profileUrl ||
                    (it?.profileId ? `/profile/${it.profileId}` : null);
                  const name =
                    it?.name ||
                    t("calendar.unknown_name", { defaultValue: "Noma'lum foydalanuvchi" });

                  return (
                    <div key={idx} className="border-b last:border-b-0 pb-2 last:pb-0">
                      <div className="font-semibold truncate">
                        {profileHref ? (
                          <a href={profileHref} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {name}
                          </a>
                        ) : (
                          <span>{name}</span>
                        )}
                      </div>

                      {it?.phone && (
                        <div className="mt-1">
                          {t("calendar.phone", { defaultValue: "Telefon" })}:{" "}
                          <a href={`tel:${it.phone}`} className="text-blue-600 hover:underline">
                            {it.phone}
                          </a>
                        </div>
                      )}

                      {it?.telegram && (
                        <div className="mt-1">
                          Telegram:{" "}
                          <a
                            href={`https://t.me/${String(it.telegram).replace(/^@/, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            @{String(it.telegram).replace(/^@/, "")}
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-gray-600">
                  {t("calendar.booked", { defaultValue: "Забронировано" })}
                </div>
              )}
            </div>
            <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white border-r border-b border-gray-200" />
          </div>
        )}
      </div>
    );
  };

  if (!profileResolved) {
    return <div className="mx-auto mt-6 max-w-6xl px-4 py-16 text-center text-sm font-semibold text-slate-500">Загружаем календарь...</div>;
  }

  if (!calendarEnabled) {
    return (
      <div className="mx-auto mt-6 max-w-4xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <div className="text-xs font-black uppercase text-orange-600">Календарь занятости</div>
        <h1 className="mt-3 text-2xl font-black text-slate-950">Этот раздел доступен гидам и транспортникам</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Отели управляют остатками и stop-sale внутри «Мои отели», а турагенты работают с созданными бронированиями в разделе «Активность».
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto mt-6 max-w-6xl px-3 pb-10 sm:px-5">
      <section className="overflow-visible border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-5 py-5 sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase text-orange-600">{typeLabel} · доступность</div>
              <h1 className="mt-1 text-2xl font-black text-slate-950">Календарь занятости</h1>
              <p className="mt-1 text-sm text-slate-600">Отметьте дни, когда вы не принимаете новые заказы. Дни с бронями изменять нельзя.</p>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden border border-slate-200 bg-slate-200 text-center">
              <div className="bg-white px-4 py-2"><div className="text-xl font-black text-slate-950">{booked.length}</div><div className="text-xs font-bold text-slate-500">по броням</div></div>
              <div className="bg-white px-4 py-2"><div className="text-xl font-black text-sky-600">{manualSavedYmd.length}</div><div className="text-xs font-bold text-slate-500">закрыто вами</div></div>
              <div className="bg-white px-4 py-2"><div className="text-xl font-black text-orange-600">{manualNewYmd.length}</div><div className="text-xs font-bold text-slate-500">новых</div></div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-5 py-3 text-xs font-bold text-slate-600 sm:px-7">
          <span className="flex items-center gap-2"><span className="h-3 w-3 bg-slate-300" /> Бронь</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 bg-sky-500" /> Закрыто вами</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 bg-orange-500" /> Не сохранено</span>
          <span className="ml-auto text-slate-400">Нажмите дату, чтобы закрыть или открыть её</span>
        </div>

      {/* overflow-visible + сброс hover */}
      <div className="relative overflow-visible px-3 py-5 sm:px-7" onMouseLeave={() => setHoveredYmd(null)}>
        {calendarLoading ? <div className="py-20 text-center text-sm font-semibold text-slate-500">Загружаем занятость...</div> : (
        <DayPicker
            locale={dpLocale}
            weekStartsOn={weekStartsOn}
            mode="multiple"
            selected={manualAsDates}
            onSelect={handleSelect}
            disabled={disabledMatchers} // только прошлое запрещаем
            modifiers={{
              past: pastMatcher,
              booked: bookedAsDates,
              manualSaved: manualSavedAsDates, // сохранённые с бэка
              manualNew: manualNewAsDates,     // новые, ещё не сохранённые
            }}
            /* ВАЖНО: НЕТ stylings для "selected", чтобы не красить всё в оранжевый */
            modifiersClassNames={{
              booked: "bg-gray-300 text-white cursor-help",
              past: "text-gray-400 cursor-not-allowed",
            }}
            modifiersStyles={{
              manualSaved: { backgroundColor: "#0ea5e9", color: "#fff" }, // синие — сохранено
              manualNew:   { backgroundColor: "#f97316", color: "#fff" }, // оранжевые — черновик
              booked:      { backgroundColor: "#d1d5db", color: "#fff", opacity: 1 },
            }}
            components={{ DayContent: DayCell }}
            /* Растянуть календарь и зафиксировать сетку таблицы */
            className="rdp w-full !m-0 text-slate-900"
            classNames={{
              months: "w-full",
              month: "w-full",
              table: "w-full table-fixed",
              caption: "relative mb-5 flex h-10 items-center justify-center",
              caption_label: "text-lg font-black capitalize text-slate-950",
              nav: "absolute right-0 top-0 flex gap-2",
              nav_button: "h-9 w-9 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              head_row: "grid grid-cols-7 border-b border-slate-100",
              head_cell: "py-3 text-center text-xs font-black uppercase text-slate-400",
              row: "grid grid-cols-7 border-b border-slate-100 last:border-b-0",
              cell: "overflow-visible relative h-16 border-r border-slate-100 last:border-r-0 sm:h-20",
              day: "rdp-day overflow-visible relative h-full w-full flex items-center justify-center text-sm font-bold transition hover:bg-orange-50",
            }}
            styles={{
              months: { width: "100%" },
              month: { width: "100%" },
              table: { width: "100%" },
              cell: { overflow: "visible" },
              day: { overflow: "visible" },
            }}
            onDayMouseEnter={(date) => {
              const ymd = toYMD(date);
              if (isGuideOrTransport && (bookedDetails[ymd]?.length || 0) > 0) {
                setHoveredYmd(ymd);
              }
            }}
          />
        )}

      </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className={`text-sm font-bold ${hasChanges ? "text-orange-700" : "text-slate-500"}`}>
            {hasChanges ? `Есть несохранённые изменения: ${manualNewYmd.length || "изменён список дат"}` : "Все изменения сохранены"}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="h-11 bg-orange-600 px-6 text-sm font-black text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Сохраняем..." : (t("calendar.save_blocked_dates") || "Сохранить занятые даты")}
          </button>
        </footer>
      </section>
    </main>
  );
};

export default ProviderCalendar;
