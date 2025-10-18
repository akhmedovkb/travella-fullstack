// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError } from "../shared/toast";
import ConfirmModal from "../components/ConfirmModal";

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
function PriceAgreementCard({ booking, onSent }) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const last = useMemo(() => {
    if (!isFiniteNum(Number(booking?.provider_price))) return null;
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
    <div className="mt-4 rounded-xl border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="font-semibold text-gray-900">{t("bookings.price_agreement", { defaultValue: "Согласование цены" })}</div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
          {t("status.pending", { defaultValue: "ожидает" })}
        </span>
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
        <div className="grid gap-3 md:grid-cols-[240px,110px,1fr,170px]">
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.price", { defaultValue: "Цена" })}</span>
            <div className="flex h-11 items-center rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <div className="px-3 text-gray-500">💵</div>
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", { defaultValue: "Напр. 120" })}
                className="h-full w-full flex-1 bg-transparent px-0 pr-3 outline-none placeholder:text-gray-400"
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
              {t("bookings.comment_optional", { defaultValue: "Комментарий (необязательно)" })}
            </span>
            <input
              className="h-11 w-full rounded-xl border bg-white px-3 outline-none focus:ring-2 focus:ring-orange-400 placeholder:text-gray-400"
              placeholder={t("bookings.comment_placeholder", { defaultValue: "Например: парковки и ожидание включены" })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!canSend}
              className="h-11 w-full rounded-xl bg-orange-600 px-4 font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60"
            >
              {busy ? t("common.sending", { defaultValue: "Отправка…" }) : t("bookings.send_price", { defaultValue: "Отправить цену" })}
            </button>
          </div>
        </div>

        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}

/* ================= page ================= */
export default function ProviderBookings() {
  const { t } = useTranslation();

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

  const hasQuotedPrice = (b) => isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;

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

  const baseList = tab === "incoming" ? incoming : outSubTab === "rest" ? outgoingRest : outgoingTB;

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


  const isPending = (b) => ["pending", "quoted"].includes(String(b.status));
  const isConfirmedLike = (b) => ["confirmed", "active"].includes(String(b.status));
  const isRejectedLike = (b) => ["rejected", "cancelled"].includes(String(b.status));
  const isUpcoming = (b) => Number.isFinite(lastDateTs(b)) && isConfirmedLike(b) && lastDateTs(b) >= todayStart;

  // счётчики (для «остальных исходящих» и любых плоских списков)
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

  // контент для «остальных исходящих» или для «входящих»
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
                needPriceForAccept={isIncoming} // скрыть «Подтвердить» без цены
                hideAcceptIfQuoted={awaitingRequester}
                hideClientCancel={!isIncoming}
                rejectedByLabel={rejectedByLabel}
                cancelledByLabel={cancelledByLabel}
                onAccept={accept}
                onReject={reject}
                onCancel={cancelOutgoing}
                onCancelByProvider={openCancelIncoming}
              />

              {/* Входящие: форма согласования цены (прячем после отправки предложения) */}
              {isIncoming && String(b.status) === "pending" && !awaitingRequester && (
                <PriceAgreementCard booking={b} onSent={load} />
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
              {isIncoming && String(b.status) === "confirmed" && (
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

    // Для вкладки ВХОДЯЩИЕ — старый список без группировки
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
                  <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
                    <div className="font-medium">
                      Пакет&nbsp;<span className="font-semibold">{g.group_id}</span>
                    </div>
                    <span className="text-xs text-gray-500">бронирований: {g.items.length}</span>
                  </div>
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
          <div key={g.group_id} className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm text-gray-700">
                {t("bookings.tb_package", { defaultValue: "Пакет" })}{" "}
                <span className="font-mono text-gray-900">{g.group_id}</span>
              </div>
              <div className="text-xs text-gray-500">
                {t("bookings.count", { defaultValue: "бронирований" })}: {g.items.length}
              </div>
            </div>
            <div className="divide-y">
              {g.items.map((b) => (
                <div key={b.id} className="p-4">
                  <BookingRow
                    booking={b}
                    viewerRole="client" // исходящие — я заявитель
                    hideClientCancel={false}
                    onCancel={cancelOutgoing}
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

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("bookings.titles.provider", { defaultValue: "Бронирования (Поставщик)" })}</h1>
         <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          {t("actions.refresh", { defaultValue: "Обновить" })}
          
        </button>
      </div>

      {/* Вкладки */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => setTab("incoming")}
          className={"rounded-full px-4 py-2 ring-1 " + (tab === "incoming" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
        >
          {t("bookings.tabs.incoming", { defaultValue: "Бронирования моих услуг" })}
          <span className={"ml-2 inline-flex items-center rounded-full px-1.5 text-xs " + (tab === "incoming" ? "bg-white/20" : "bg-gray-100")}>
            {incoming.length}
          </span>
        </button>

        <button
          onClick={() => setTab("outgoing")}
          className={"rounded-full px-4 py-2 ring-1 " + (tab === "outgoing" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
        >
          {t("bookings.tabs.outgoing", { defaultValue: "Мои бронирования услуг" })}
          <span className={"ml-2 inline-flex items-center rounded-full px-1.5 text-xs " + (tab === "outgoing" ? "bg-white/20" : "bg-gray-100")}>
            {outgoing.length}
          </span>
        </button>
      </div>

      {/* Под-вкладки для исходящих */}
      {tab === "outgoing" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => setOutSubTab("tb")}
            className={"rounded-full px-3 py-1.5 ring-1 " + (outSubTab === "tb" ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
          >
            {t("bookings.tb_tab", { defaultValue: "Пакеты TourBuilder" })}
            <span className={"ml-2 inline-flex items-center rounded-full px-1 text-xs " + (outSubTab === "tb" ? "bg-white/20" : "bg-gray-100")}>
              {tbGroups.length}
            </span>
          </button>
          <button
            onClick={() => setOutSubTab("rest")}
            className={"rounded-full px-3 py-1.5 ring-1 " + (outSubTab === "rest" ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
          >
            {t("bookings.rest_tab", { defaultValue: "Остальные исходящие" })}
            <span className={"ml-2 inline-flex items-center rounded-full px-1 text-xs " + (outSubTab === "rest" ? "bg-white/20" : "bg-gray-100")}>
              {outgoingRest.length}
            </span>
          </button>
        </div>
      )}

      {/* Фильтры статуса — только для плоских списков (входящие + остальные исходящие) */}
      {(tab === "incoming" || (tab === "outgoing" && outSubTab === "rest")) && (
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
      {tab === "outgoing" && outSubTab === "tb" ? tbPackagesContent : flatListContent}
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
