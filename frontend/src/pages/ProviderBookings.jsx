// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError, tInfo } from "../shared/toast";
import ConfirmModal from "../components/ConfirmModal";
import { redirectToPaymeGuide } from "../utils/paymeGuide";

/* ================= helpers ================= */
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const getToken = () => localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const CURRENCIES = ["USD", "EUR", "UZS"];
const onlyDigitsDot = (s) =>
  String(s || "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1"); // вторую точку выкидываем

const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) => (isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "");

/* =============== Карточка согласования цены (входящие) =============== */
function PriceAgreementCard({ booking, onSent, onReject }) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const last = useMemo(() => {
    if (!isFiniteNum(Number(booking?.provider_price)) || Number(booking.provider_price) <= 0) return null;
    const at = booking?.updated_at ? new Date(booking.updated_at) : null;
    return {
      price: Number(booking.provider_price),
      note: booking.provider_note,
      at: at
        ? at.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : null,
    };
  }, [booking?.provider_price, booking?.provider_note, booking?.updated_at]);

  const priceNum = useMemo(() => {
    const n = Number(onlyDigitsDot(priceRaw));
    return isFiniteNum(n) ? n : NaN;
  }, [priceRaw]);

  const canSend =
    !busy && String(booking?.status) === "pending" && isFiniteNum(priceNum) && priceNum > 0 && CURRENCIES.includes(currency);

  const submit = async () => {
    setErr("");
    if (!canSend) {
      setErr(t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" }));
      return;
    }
    try {
      setBusy(true);
      await axios.post(`${API_BASE}/api/bookings/${booking.id}/quote`, { price: Number(priceNum), currency, note: note.trim() }, cfg());
      setPriceRaw("");
      setNote("");
      tSuccess(t("bookings.price_sent", { defaultValue: "Цена отправлена" }));
      onSent?.();
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.price_send_error", { defaultValue: "Ошибка отправки цены" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <div className="font-semibold text-gray-950">
        {t("bookings.offer_price", { defaultValue: "Предложить цену" })}
      </div>

      {last && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">{t("bookings.last_offer", { defaultValue: "Последнее предложение" })}:</span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(last.price)} {booking.currency || "USD"}
            </span>
            {last.note ? <span>· {last.note}</span> : null}
            {last.at ? <span className="text-gray-500">· {last.at}</span> : null}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-[220px,110px,minmax(240px,1fr)]">
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.price", { defaultValue: "Цена" })}</span>
            <div className="flex h-11 items-center rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", { defaultValue: "Напр. 120" })}
                className="h-full w-full flex-1 bg-transparent px-3 outline-none placeholder:text-gray-400"
                value={priceRaw}
                onChange={(e) => setPriceRaw(onlyDigitsDot(e.target.value))}
              />
            </div>
          </label>

          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.currency", { defaultValue: "Валюта" })}</span>
            <select className="h-11 w-full rounded-xl border bg-gray-50 px-3 outline-none" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.terms", { defaultValue: "Условия" })}
            </span>
            <input
              className="h-11 w-full rounded-xl border bg-white px-3 outline-none focus:ring-2 focus:ring-orange-400 placeholder:text-gray-400"
              placeholder={t("bookings.terms_placeholder", { defaultValue: "Что включено в цену (необязательно)" })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {onReject ? (
            <button
              type="button"
              onClick={() => onReject(booking)}
              disabled={busy}
              className="h-10 rounded-lg border border-rose-200 bg-white px-4 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              {t("actions.reject", { defaultValue: "Отклонить заявку" })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="h-10 rounded-lg bg-orange-600 px-5 font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
          >
            {busy ? t("common.sending", { defaultValue: "Отправка…" }) : t("bookings.offer_price", { defaultValue: "Предложить цену" })}
          </button>
        </div>

        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}

/* ================= page ================= */
export default function ProviderBookings() {
  const { t } = useTranslation();
  // под-вкладки
  const [inSubTab, setInSubTab] = useState("tb");  // tb | rest  (для входящих)
  const [tab, setTab] = useState("incoming"); // incoming | outgoing
  
  // под-вкладки только для исходящих
  const [outSubTab, setOutSubTab] = useState("tb"); // tb | rest
  const [filter, setFilter] = useState("all"); // all | pending | confirmed | upcoming | rejected
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
    // --- Модалка отмены поставщиком ---
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    setFilter("all");
  }, [tab]);
  useEffect(() => {
    // при переключении «исходящие» — по умолчанию показываем пакеты TB
    if (tab === "outgoing") setOutSubTab((v) => v || "tb");
    // при переключении «входящие» — по умолчанию тоже пакеты TB
    if (tab === "incoming") setInSubTab((v) => v || "tb");
  }, [tab]);

  const load = async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const [incRes, outRes] = await Promise.all([
        axios.get(`${API_BASE}/api/bookings/provider`, cfg()),
        axios.get(`${API_BASE}/api/bookings/provider/outgoing`, cfg()),
      ]);
      setIncoming(Array.isArray(incRes.data) ? incRes.data : []);
      setOutgoing(Array.isArray(outRes.data) ? outRes.data : []);
    } catch (e) {
      console.error("load provider bookings failed", e);
      setIncoming([]);
      setOutgoing([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const bookingId = Number(new URLSearchParams(window.location.search).get("payment_booking"));
    if (!Number.isInteger(bookingId) || bookingId <= 0) return undefined;
    let stopped = false;
    let timer = null;
    let attempts = 0;
    const check = async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/api/bookings/${bookingId}`, cfg());
        if (stopped) return;
        const status = String(data?.status || "").toLowerCase();
        if (["confirmed", "paid", "active"].includes(status)) {
          tSuccess(t("bookings.payment_confirmed", { defaultValue: "Оплата подтверждена. Бронирование оформлено." }));
          await load();
          const url = new URL(window.location.href);
          url.searchParams.delete("payment_booking");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          return;
        }
        if (["cancelled_unpaid", "cancelled", "expired"].includes(status)) {
          tError(t("bookings.payment_not_completed", { defaultValue: "Оплата не завершена, бронь отменена." }));
          await load();
          const url = new URL(window.location.href);
          url.searchParams.delete("payment_booking");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          return;
        }
      } catch (e) {
        console.error("booking payment status check failed", e);
      }
      attempts += 1;
      if (!stopped && attempts < 10) timer = window.setTimeout(check, 1500);
      else if (!stopped) tInfo(t("bookings.payment_processing", { defaultValue: "Платёж ещё обрабатывается. Статус обновится автоматически." }));
    };
    check();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [t]);

  const hasQuotedPrice = (b) => isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;

  const payBooking = async (b) => {
    try {
      const { data } = await axios.post(`${API_BASE}/api/bookings/${b.id}/payment-order`, {}, cfg());
      const redirected = redirectToPaymeGuide(data?.pay_url, {
        purpose: "hotel_booking",
        amount: data?.amount_sum,
        orderId: data?.order_id,
        returnTo: "/dashboard/bookings",
      });
      if (!redirected) throw new Error("payment_url_missing");
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.payment_error", { defaultValue: "Не удалось создать оплату" }));
    }
  };

  const accept = async (b) => {
    if (!hasQuotedPrice(b)) {
      tError(t("bookings.need_price_first", { defaultValue: "Сначала отправьте цену" }));
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/accept`, {}, cfg());
      tSuccess(t("bookings.accepted", { defaultValue: "Бронь подтверждена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };
  
  // входящие: отмена подтверждённой брони поставщиком (с причиной)
  const cancelIncomingConfirmed = async (b) => {
    const reason = window.prompt(
      t("bookings.provider_cancel_reason", { defaultValue: "Укажите причину отмены" })
    );
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/cancel-by-provider`, { reason }, cfg());
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const reject = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/reject`, {}, cfg());
      tSuccess(t("bookings.rejected", { defaultValue: "Бронь отклонена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.reject_error", { defaultValue: "Ошибка отклонения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };
  // входящие (я — поставщик): отмена подтверждённой/активной заявки
  const openCancelIncoming = (b) => {
    setCancelTarget(b);
    setCancelReason("");
    setShowCancelModal(true);
  };
  const submitCancelIncoming = async () => {
    if (!cancelTarget) return;
    try {
      setCancelBusy(true);
      await axios.post(
        `${API_BASE}/api/bookings/${cancelTarget.id}/cancel-by-provider`,
        { reason: cancelReason.trim() || null },
        cfg()
      );
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
      setShowCancelModal(false);
      setCancelTarget(null);
      setCancelReason("");
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
    } finally {
      setCancelBusy(false);
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  // исходящие (я как заказчик)
  const confirmOutgoing = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/confirm-by-requester`, {}, cfg());
      tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };
  const cancelOutgoing = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/cancel-by-requester`, {}, cfg());
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const requestRefund = async (b) => {
    const reason = window.prompt("Укажите причину возврата");
    if (reason == null) return;
    if (reason.trim().length < 5) return tError("Укажите причину возврата подробнее");
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/refund-request`, { reason: reason.trim() }, cfg());
      tSuccess("Запрос возврата отправлен администратору");
      await load();
    } catch (e) {
      tError(e?.response?.data?.message || "Не удалось запросить возврат");
    }
  };
  // разрез входящих
  const incomingTB = useMemo(
    () => incoming.filter((b) => String(b?.source) === "tour_builder" && !!b?.group_id),
    [incoming]
  );
  const incomingRest = useMemo(
    () => incoming.filter((b) => !(String(b?.source) === "tour_builder" && !!b?.group_id)),
    [incoming]
  );
  // сгруппировать входящие TB по group_id
  const incTbGroups = useMemo(() => {
    const map = new Map();
    for (const b of incomingTB) {
      const gid = b.group_id;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid).push(b);
    }
    return Array.from(map.entries())
      .map(([group_id, items]) => ({ group_id, items: items.sort((a, b) => (a.id > b.id ? -1 : 1)) }))
      .sort((a, b) => (a.items[0]?.id > b.items[0]?.id ? -1 : 1));
  }, [incomingTB]);

  // разрез исходящих
  const outgoingTB = useMemo(
    () => outgoing.filter((b) => String(b?.source) === "tour_builder" && !!b?.group_id),
    [outgoing]
  );
  const outgoingRest = useMemo(
    () => outgoing.filter((b) => !(String(b?.source) === "tour_builder" && !!b?.group_id)),
    [outgoing]
  );
  // сгруппировать TB по group_id
  const tbGroups = useMemo(() => {
    const map = new Map();
    for (const b of outgoingTB) {
      const gid = b.group_id;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid).push(b);
    }
    // по времени создания пакета — сперва новые
    return Array.from(map.entries())
      .map(([group_id, items]) => ({ group_id, items: items.sort((a, b) => (a.id > b.id ? -1 : 1)) }))
      .sort((a, b) => (a.items[0]?.id > b.items[0]?.id ? -1 : 1));
  }, [outgoingTB]);

  const baseList =
    tab === "incoming"
      ? (inSubTab === "rest" ? incomingRest : incomingTB)
      : (outSubTab === "rest" ? outgoingRest : outgoingTB);

  // helpers для дат
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const lastDateTs = (b) => {
  const arr = Array.isArray(b?.dates) ? b.dates : [];
  const ts = arr
    .map((d) => new Date(`${d}T00:00:00`).getTime())
    .filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : NaN;
};

  /* ===== helpers для отображения маршрута пакета (даты + города) ===== */
  const firstDateTs = (b) => {
    const arr = Array.isArray(b?.dates) ? b.dates : [];
    const ts = arr
      .map((d) => new Date(`${d}T00:00:00`).getTime())
      .filter(Number.isFinite);
    return ts.length ? Math.min(...ts) : NaN;
  };
  /* ===== TB: посуточный свод услуг для группы ===== */
  // Нормализуем дату к ISO YYYY-MM-DD
  const toISO = (v) => {
    if (!v) return null;
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    }
    const d2 = new Date(`${s}T00:00:00`);
    if (Number.isFinite(d2.getTime())) {
      const y = d2.getFullYear();
      const m = String(d2.getMonth() + 1).padStart(2, "0");
      const dd = String(d2.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    }
    return null;
  };

  // Вытащить город из брони
  const pickCity = (b) => {
    const v =
      cityFrom(b) ||
      cityTo(b) ||
      pickField(b?.attachments || {}, ["city", "cityName"]);
    return (v || "").toString();
  };
  // Вытаскиваем выбранный в TourBuilder тип услуги
  const tbKindFrom = (b) => {
    const tryVals = [
      b?.tb_type, b?.tb_kind, b?.tb_service,              // возможные поля от BE
      b?.details?.tb_type, b?.details?.tb_kind,
      b?.attachments?.tb_type, b?.attachments?.tb_kind,
    ].map(v => String(v || "").toLowerCase()).filter(Boolean);
    if (tryVals.length) return tryVals[0];
    // fallback: парсим из комментария вида "[TourBuilder] transport ..."
    const c = String(b?.comment || b?.provider_comment || "");
    const m = c.match(/\[TourBuilder\]\s*([a-zA-Z]+)/i);
    return m ? m[1].toLowerCase() : "";
  };

  // Класс услуги (раздел)
  const serviceClass = (b) => {
    const pt = String(b?.provider_type || "").toLowerCase();
    const st = String(b?.service_title || "").toLowerCase();
    const tb = String(tbKindFrom(b) || "").toLowerCase();

    // 0) Явный выбор заявителя в TourBuilder — ПРИОРИТЕТ
    if (tb === "guide")     return "GUIDE";
    if (tb === "transport") return "TRANSPORT";
    if (tb === "hotel")     return "HOTEL";
    if (tb === "entry" || tb === "entryfees" || tb === "entry_fee") return "ENTRY FEES";
    // 1) пробуем по названию услуги
    if (/\bhotel\b/.test(st)) return "HOTEL";
    if (/\bguide\b/.test(st)) return "GUIDE";
    if (/\b(transport|transfer|car|vehicle)\b/.test(st)) return "TRANSPORT";
    if (/\b(entry|ticket|fee|museum|monument)\b/.test(st)) return "ENTRY FEES";
    // 2) иначе — по типу поставщика
    if (pt === "hotel") return "HOTEL";
    if (pt === "guide") return "GUIDE";
    if (pt === "transport") return "TRANSPORT";
    if (pt === "agent") return "SERVICE"; // не считаем агентом ENTRY FEES по умолчанию
    return pt.toUpperCase() || "SERVICE";
  };

  // Какое имя показывать для класса услуги
  const displayNameFor = (klass, b) => {
    if (klass === "ENTRY FEES") {
      const name = (b?.service_title || "").toString().trim();
      return name || (b?.provider_name || "").toString().trim(); // fallback
    }
    if (klass === "HOTEL" || klass === "GUIDE" || klass === "TRANSPORT") {
      return (b?.provider_name || b?.service_title || "").toString().trim();
    }
    return (b?.provider_name || b?.service_title || "").toString().trim();
  };
  
  const fmtDay = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  // Собираем [{date,label,city,dateLabel,sections:[[klass,[names]]]}]
  const buildDailyMatrix = (items = []) => {
    const byDate = new Map(); // date -> {city, sections: Map<class, Set<name>>}
    for (const b of items) {
      const dates = Array.isArray(b?.dates) ? b.dates : [];
      const city = pickCity(b);
      const klass = serviceClass(b);
      for (const d of dates) {
       const iso = toISO(d);
        if (!iso) continue;
        if (!byDate.has(iso)) byDate.set(iso, { city, sections: new Map() });
        const cell = byDate.get(iso);
        if (!cell.city && city) cell.city = city;
        if (!cell.sections.has(klass)) cell.sections.set(klass, new Set());
        const name = displayNameFor(klass, b);
        if (name) cell.sections.get(klass).add(name);
      }
    }
    const rows = Array.from(byDate.entries())
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([date, { city, sections }], i) => ({
        date,
        label: `D${i + 1}`,
        city: (city || "").toUpperCase(),
        dateLabel: fmtDay(date),
        sections: Array.from(sections.entries()).map(([k, set]) => [k, Array.from(set.values())]),
      }));
    return rows;
  };

  const fmtShort = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  };

  const renderPackageOverview = (group) => {
    const rows = buildDailyMatrix(group.items);
    const reference = String(group.group_id || "").split("-")[0].toUpperCase();
    return (
      <div className="border-b border-gray-200 bg-gray-50/70 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-orange-600">Tour Builder</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-gray-950">
                {t("bookings.request", { defaultValue: "Заявка" })} {reference ? `№ ${reference}` : ""}
              </h2>
              <span className="rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                {group.items.length} {t("bookings.services_count", { defaultValue: "услуг" })}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>{t("bookings.full_reference", { defaultValue: "Номер пакета" })}</div>
            <div className="mt-0.5 font-mono">{group.group_id}</div>
          </div>
        </div>

        {rows.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.date} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-md bg-gray-950 px-2 py-1 text-xs font-bold text-white">{row.label}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-950">{row.city || t("bookings.city_unknown", { defaultValue: "Город не указан" })}</div>
                    <div className="text-sm text-gray-500">{row.dateLabel || fmtShort(row.date)}</div>
                    <div className="mt-2 space-y-1 text-sm text-gray-700">
                      {row.sections.map(([klass, names]) =>
                        names.length ? (
                          <div key={klass}>
                            <span className="font-semibold text-gray-500">{klass}:</span> {names.join(", ")}
                          </div>
                        ) : null
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const pickField = (obj, keys = []) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  const cityFrom = (b) => {
    // пробуем на верхнем уровне
    let v =
      pickField(b, ["from_city", "city_from", "origin", "from", "directionFrom"]) ||
      // в details (если есть)
      pickField(b?.details || {}, ["from_city", "city_from", "origin", "from", "directionFrom"]);
    return v;
  };
  const cityTo = (b) => {
    let v =
      pickField(b, ["to_city", "city_to", "destination", "to", "directionTo"]) ||
      pickField(b?.details || {}, ["to_city", "city_to", "destination", "to", "directionTo"]);
    return v;
  };

  const buildGroupSummary = (items = []) => {
    if (!items.length) return null;
    // упорядочим брони по первой дате
    const sorted = [...items].sort((a, b) => {
      const ta = firstDateTs(a), tb = firstDateTs(b);
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });

    // соберём список дат (первая/последняя) и цепочку городов
    const firstB = sorted.find((x) => Number.isFinite(firstDateTs(x)));
    const lastB  = [...sorted].reverse().find((x) => Number.isFinite(firstDateTs(x)));
    const firstIso = Array.isArray(firstB?.dates) ? firstB.dates[0] : null;
    const lastIso  = Array.isArray(lastB?.dates)  ? lastB.dates[lastB.dates.length - 1] : firstIso;
    const datesStr = firstIso && lastIso ? `${fmtShort(firstIso)} — ${fmtShort(lastIso)}` : null;

    // строим маршрут городов: from -> to для каждой брони, без дублей подряд
    const hops = [];
    for (const it of sorted) {
      const a = cityFrom(it), b = cityTo(it);
      if (a && !hops.length) hops.push(a);
      if (b && (!hops.length || hops[hops.length - 1] !== b)) hops.push(b);
    }
    const routeStr = hops.length ? hops.join(" → ") : null;
    return { datesStr, routeStr };
  };

  const isPending = (b) => ["pending", "quoted", "awaiting_payment"].includes(String(b.status));
  const isConfirmedLike = (b) => ["confirmed", "active", "paid"].includes(String(b.status));
  const isRejectedLike = (b) => ["rejected", "cancelled", "cancelled_unpaid", "expired"].includes(String(b.status));
  const isUpcoming = (b) => Number.isFinite(lastDateTs(b)) && isConfirmedLike(b) && lastDateTs(b) >= todayStart;

  // счётчики (для плоских списков — входящие/остальные исходящие)
  const counts = useMemo(() => {
    const c = { all: baseList.length, pending: 0, confirmed: 0, upcoming: 0, rejected: 0 };
    for (const b of baseList) {
      if (isPending(b)) c.pending++;
      if (isConfirmedLike(b)) c.confirmed++;
      if (isUpcoming(b)) c.upcoming++;
      if (isRejectedLike(b)) c.rejected++;
    }
    return c;
  }, [baseList]);

  // применяем выбранный фильтр
  const filtered = useMemo(() => {
    switch (filter) {
      case "pending":
        return baseList.filter(isPending);
      case "confirmed":
        return baseList.filter(isConfirmedLike);
      case "upcoming":
        return baseList.filter(isUpcoming);
      case "rejected":
        return baseList.filter(isRejectedLike);
      case "all":
      default:
        return baseList;
    }
  }, [baseList, filter]);

   // ==== NEW: группировка исходящих по group_id для заявок из TourBuilder ====
  const groupedOutgoing = useMemo(() => {
    if (tab !== "outgoing") return { groups: [], singles: [] };
    const map = new Map(); // group_id -> items[]
    const singles = [];
    for (const b of filtered) {
      const isTB = String(b?.source || "").toLowerCase() === "tour_builder";
      const gid = b?.group_id;
      if (isTB && gid) {
        if (!map.has(gid)) map.set(gid, []);
        map.get(gid).push(b);
      } else {
        singles.push(b);
      }
    }
    const groups = [...map.entries()].map(([group_id, items]) => {
      const firstTs = Math.min(
        ...items
          .map((x) => new Date(x?.created_at || x?.updated_at || 0).getTime())
          .filter(Number.isFinite)
      );
      return { group_id, items, firstTs: Number.isFinite(firstTs) ? firstTs : 0 };
    });
    groups.sort((a, b) => b.firstTs - a.firstTs); // новые сверху
    return { groups, singles };
  }, [filtered, tab]);

  // контент для «остальных исходящих» или для «входящих» (плоский список)
  const flatListContent = useMemo(() => {
    if (loading) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!filtered.length) return <div className="text-gray-500">{t("bookings.empty", { defaultValue: "Пока нет бронирований." })}</div>;

    // небольшая функция, чтобы не дублировать отрисовку строки
    const renderRow = (b) => {
          const isIncoming = tab === "incoming";
          const alreadyQuoted = Number(b?.provider_price) > 0;
          const awaitingRequester = isIncoming && String(b?.status) === "quoted";

          // подписи «кем отклонено/кем отменено»
          let rejectedByLabel = null;
          let cancelledByLabel = null;
          if (String(b.status) === "rejected") {
            rejectedByLabel = isIncoming
              ? t("bookings.rejected_by_you", { defaultValue: "вами (поставщиком услуги)" })
              : t("bookings.rejected_by_provider", { defaultValue: "поставщиком услуги" });
          } else if (String(b.status) === "cancelled") {
            cancelledByLabel = isIncoming
              ? t("bookings.cancelled_by_client", { defaultValue: "клиентом/заявителем" })
              : t("bookings.cancelled_by_you", { defaultValue: "вами (заявителем)" });
          }

          return (
            <div key={b.id}>
              <BookingRow
                booking={b}
                viewerRole={isIncoming ? "provider" : "client"}
                needPriceForAccept={!isIncoming} // у заявителя скрыть «Подтвердить» до предложения цены
                hideAcceptIfQuoted={awaitingRequester}
                hideClientCancel={!isIncoming}
                rejectedByLabel={rejectedByLabel}
                cancelledByLabel={cancelledByLabel}
                onAccept={accept}
                onReject={isIncoming && String(b.status) === "pending" ? undefined : reject}
                onCancel={cancelOutgoing}
                onCancelByProvider={openCancelIncoming}
                onHoldExpired={load}
                onPay={payBooking}
                onRefund={!isIncoming ? requestRefund : undefined}
              />

              {/* Входящие: форма согласования цены (прячем после отправки предложения) */}
              {isIncoming && String(b.status) === "pending" && !awaitingRequester && (
                <PriceAgreementCard booking={b} onSent={load} onReject={reject} />
              )}

              {/* Плашка «ожидание подтверждения» */}
              {awaitingRequester && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t("bookings.waiting_for_requester", {
                    defaultValue: "Предложение отправлено. Ожидаем подтверждения клиента/заявителя.",
                  })}
                </div>
              )}

              {/* Исходящие: действия подтверждения/отмены */}
              {!isIncoming && String(b.status) === "quoted" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => confirmOutgoing(b)}
                    disabled={!isFiniteNum(Number(b.provider_price))}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                  >
                    {t("actions.confirm", { defaultValue: "Подтвердить" })}
                  </button>
                  <button onClick={() => cancelOutgoing(b)} className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800">
                    {t("actions.cancel", { defaultValue: "Отмена" })}
                  </button>
                </div>
              )}             
              {/* Входящие подтверждённые: дать поставщику отменить с причиной */}
              {isIncoming && String(b.status) === "confirmed" && String(b.payment_status || "").toLowerCase() !== "paid" && (
                <div className="mt-3">
                  <button
                    onClick={() => cancelIncomingConfirmed(b)}
                    className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800"
                  >
                    {t("actions.cancel", { defaultValue: "Отменить" })}
                  </button>
                </div>
              )}
            </div>
          );
    };

    // Для вкладки ВХОДЯЩИЕ/ОСТАЛЬНЫЕ — плоский список
    if (tab === "incoming") {
      return <div className="space-y-4">{filtered.map((b) => renderRow(b))}</div>;
    }

    // Для ИСХОДЯЩИХ — сначала «Пакеты TourBuilder», затем «Остальные исходящие»
    return (
      <div className="space-y-8">
        {/* Пакеты TourBuilder */}
        {groupedOutgoing.groups.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xl font-semibold">Пакеты TourBuilder</h3>
              <span className="text-xs rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">
                {groupedOutgoing.groups.length}
              </span>
            </div>
            <div className="space-y-5">
              {groupedOutgoing.groups.map((g) => (
                <div key={g.group_id} className="overflow-hidden rounded-xl border bg-white">
                  <div className="border-b bg-gray-50 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        Пакет&nbsp;<span className="font-semibold">{g.group_id}</span>
                      </div>
                      <span className="text-xs text-gray-500">бронирований: {g.items.length}</span>
                    </div>
                  </div>
                  {/* Итерарий по дням — под шапкой пакета */}
                  {(() => {
                    const rows = buildDailyMatrix(g.items);
                    if (!rows.length) return null;
                    return (
                      <div className="px-4 pt-3">
                        <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                          {rows.map((r) => (
                            <div key={r.date} className="mb-3 last:mb-0">
                              {/* D1 → дата → город */}
                              <div className="font-semibold">
                                {r.label} → {r.dateLabel} → {r.city || fmtShort(r.date)}
                              </div>
                              {r.sections.map(([klass, names]) =>
                                names.length ? (
                                  <div key={klass} className="text-gray-700">
                                    <span className="font-medium">{klass}:</span> {names.join(", ")}
                                  </div>
                                ) : null
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-4 p-4">{g.items.map((b) => renderRow(b))}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Остальные исходящие */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xl font-semibold">Остальные исходящие</h3>
            <span className="text-xs rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-700">
              {groupedOutgoing.singles.length}
            </span>
          </div>
          {groupedOutgoing.singles.length === 0 ? (
            <div className="text-sm text-gray-500">Пусто</div>
          ) : (
            <div className="space-y-4">{groupedOutgoing.singles.map((b) => renderRow(b))}</div>
          )}
        </div>
      </div>
    );
  }, [filtered, loading, tab, t]);

  // контент для «Пакеты TourBuilder»
  const tbPackagesContent = useMemo(() => {
    if (loading) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!tbGroups.length)
      return <div className="text-gray-500">{t("bookings.tb_empty", { defaultValue: "Пакетов TourBuilder пока нет." })}</div>;
    return (
      <div className="space-y-6">
        {tbGroups.map((g) => (
          <div key={g.group_id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {renderPackageOverview(g)}
            <div className="divide-y">
              {g.items.map((b) => (
                <div key={b.id} className="p-4">
                  <BookingRow
                    booking={b}
                    embedded
                    viewerRole="client" // исходящие — я заявитель
                    /* не показывать «Подтвердить», пока нет цены от поставщика */
                    needPriceForAccept
                    hideClientCancel={false}
                    onCancel={cancelOutgoing}
                    onHoldExpired={load}
                    onPay={payBooking}
                    onRefund={requestRefund}
                  />
                  {String(b.status) === "quoted" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => confirmOutgoing(b)}
                        disabled={!isFiniteNum(Number(b.provider_price))}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                      >
                        {t("actions.confirm", { defaultValue: "Подтвердить" })}
                      </button>
                      <button
                        onClick={() => cancelOutgoing(b)}
                        className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800"
                      >
                        {t("actions.cancel", { defaultValue: "Отмена" })}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }, [tbGroups, loading, t]);
  // контент для «Пакеты TourBuilder» во ВХОДЯЩИХ
  const tbIncomingContent = useMemo(() => {
    if (loading) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!incTbGroups.length)
      return <div className="text-gray-500">{t("bookings.tb_empty", { defaultValue: "Пакетов TourBuilder пока нет." })}</div>;
    // используем тот же renderRow (он реагирует на tab === "incoming")
    const renderRow = (b) => (
      <div key={b.id} className="p-4">
        <BookingRow
          booking={b}
          embedded
          viewerRole="provider"
          needPriceForAccept
          hideClientCancel
          onAccept={accept}
          onHoldExpired={load}
          onPay={payBooking}
          onReject={String(b.status) === "pending" ? undefined : reject}
          onCancelByProvider={openCancelIncoming}
        />
        {String(b.status) === "pending" && <PriceAgreementCard booking={b} onSent={load} onReject={reject} />}
      </div>
    );
    return (
      <div className="space-y-6">
        {incTbGroups.map((g) => (
          <div key={g.group_id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {renderPackageOverview(g)}
            <div className="divide-y">{g.items.map(renderRow)}</div>
          </div>
        ))}
      </div>
    );
  }, [incTbGroups, loading, t]);

  const incomingAttention = useMemo(
    () => incoming.filter((b) => String(b?.status || "").toLowerCase() === "pending").length,
    [incoming]
  );
  const outgoingAttention = useMemo(
    () => outgoing.filter((b) => ["quoted", "awaiting_payment"].includes(String(b?.status || "").toLowerCase())).length,
    [outgoing]
  );
  const activeSubTab = tab === "incoming" ? inSubTab : outSubTab;
  const setActiveSubTab = tab === "incoming" ? setInSubTab : setOutSubTab;
  const tourBuilderCount = tab === "incoming" ? incTbGroups.length : tbGroups.length;
  const otherCount = tab === "incoming" ? incomingRest.length : outgoingRest.length;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-5 border-b border-gray-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-orange-600">
              {t("bookings.workspace", { defaultValue: "Управление заявками" })}
            </div>
            <h1 className="text-2xl font-bold text-gray-950 md:text-3xl">
              {t("bookings.title", { defaultValue: "Бронирования" })}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {tab === "incoming"
                ? t("bookings.incoming_help", { defaultValue: "Заявки клиентов и партнёров на ваши услуги." })
                : t("bookings.outgoing_help", { defaultValue: "Заявки, которые вы отправили другим поставщикам." })}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
          >
            <span aria-hidden="true">↻</span>
            {loading ? t("common.loading", { defaultValue: "Загрузка..." }) : t("actions.refresh", { defaultValue: "Обновить" })}
          </button>
        </div>
      </header>

      <div className="mb-5 grid gap-3 md:grid-cols-2" role="tablist" aria-label={t("bookings.direction", { defaultValue: "Направление бронирований" })}>
        {[
          {
            key: "incoming",
            title: t("bookings.incoming", { defaultValue: "Входящие" }),
            description: t("bookings.incoming_short", { defaultValue: "Брони ваших услуг" }),
            total: incoming.length,
            attention: incomingAttention,
          },
          {
            key: "outgoing",
            title: t("bookings.outgoing", { defaultValue: "Исходящие" }),
            description: t("bookings.outgoing_short", { defaultValue: "Брони, созданные вами" }),
            total: outgoing.length,
            attention: outgoingAttention,
          },
        ].map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={`min-h-[92px] rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? "border-gray-950 bg-gray-950 text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-950 hover:border-gray-400"
              }`}
            >
              <span className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-lg font-bold">{item.title}</span>
                  <span className={`mt-1 block text-sm ${active ? "text-white/70" : "text-gray-500"}`}>{item.description}</span>
                </span>
                <span className={`min-w-10 rounded-md px-2.5 py-1 text-center text-lg font-bold ${active ? "bg-white/10" : "bg-gray-100"}`}>
                  {item.total}
                </span>
              </span>
              <span className={`mt-2 block text-xs font-medium ${active ? "text-orange-300" : "text-orange-700"}`}>
                {item.attention > 0
                  ? t("bookings.need_action", { count: item.attention, defaultValue: `Требуют действия: ${item.attention}` })
                  : t("bookings.no_action", { defaultValue: "Нет заявок, требующих действия" })}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
        <span className="mr-2 text-xs font-semibold uppercase text-gray-500">
          {t("bookings.source", { defaultValue: "Источник" })}
        </span>
        <button
          type="button"
          onClick={() => setActiveSubTab("tb")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeSubTab === "tb" ? "bg-orange-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}
        >
          Tour Builder <span className="ml-1 opacity-75">{tourBuilderCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("rest")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeSubTab === "rest" ? "bg-orange-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}
        >
          {t("bookings.other", { defaultValue: "Другие бронирования" })} <span className="ml-1 opacity-75">{otherCount}</span>
        </button>
      </div>

      {/* Фильтры статуса — только для плоских списков (входящие/остальные и исходящие/остальные) */}
      {((tab === "incoming" && inSubTab === "rest") || (tab === "outgoing" && outSubTab === "rest")) && (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { key: "all", label: t("filter.all", { defaultValue: "Все" }), count: counts.all },
          { key: "pending", label: t("filter.pending", { defaultValue: "Ожидают" }), count: counts.pending },
          { key: "confirmed", label: t("filter.confirmed", { defaultValue: "Подтверждено" }), count: counts.confirmed },
          { key: "upcoming", label: t("filter.upcoming", { defaultValue: "Предстоящие" }), count: counts.upcoming },
          { key: "rejected", label: t("filter.rejected", { defaultValue: "Отклонено" }), count: counts.rejected },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={"rounded-full px-3 py-1.5 text-sm ring-1 " + (filter === key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
          >
            {label}
            <span className={"ml-2 inline-flex items-center rounded-full px-1 text-xs " + (filter === key ? "bg-white/20" : "bg-gray-100")}>
              {count}
            </span>
          </button>
        ))}
      </div>
     )}
      {/* Содержимое */}
      {tab === "outgoing" && outSubTab === "tb"
        ? tbPackagesContent
        : tab === "incoming" && inSubTab === "tb"
        ? tbIncomingContent
        : flatListContent}
            {/* Модалка отмены поставщиком — через общий ConfirmModal */}
      <ConfirmModal
        open={showCancelModal}
        danger
        title={t("bookings.provider_cancel_title", { defaultValue: "Отменить бронирование?" })}
        confirmLabel="OK"
        cancelLabel={t("actions.cancel", { defaultValue: "Отмена" })}
        busy={cancelBusy}
        onClose={() => { setShowCancelModal(false); setCancelTarget(null); }}
        onConfirm={submitCancelIncoming}
        message={
          <label className="block">
            <div className="mb-1 text-sm text-gray-600">
              {t("bookings.provider_cancel_reason", { defaultValue: "Укажите причину отмены" })}
            </div>
            <input
              autoFocus
              className="h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-orange-400"
              placeholder={t("bookings.provider_cancel_reason_ph", { defaultValue: "Например: внезапная поломка авто" })}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
        }
      />
    </div>
  );
}
