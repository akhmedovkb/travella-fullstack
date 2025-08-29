// components/PriceAgreementCard.jsx
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const CURRENCIES = ["USD", "EUR", "UZS"];

const onlyDigitsDot = (s) => s.replace(/[^\d.]/g, "");
const fmt = (n) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

export default function PriceAgreementCard({
  booking,                 // { id, provider_price, provider_note, updated_at, status }
  onSendPrice,             // async (bookingId, { price, currency, note }) => void
  disabled = false,
}) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const lastReply = useMemo(() => {
    if (!booking?.provider_price) return null;
    const at = booking?.updated_at ? new Date(booking.updated_at) : null;
    return {
      price: booking.provider_price,
      note: booking.provider_note,
      at: at
        ? at.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null,
    };
  }, [booking]);

  const priceNumber = useMemo(() => {
    const n = Number(onlyDigitsDot(priceRaw));
    return Number.isFinite(n) ? n : NaN;
  }, [priceRaw]);

  const canSend =
    !disabled &&
    !busy &&
    booking?.status === "pending" &&
    Number.isFinite(priceNumber) &&
    priceNumber > 0 &&
    CURRENCIES.includes(currency);

  const submit = async () => {
    setErr("");
    if (!canSend) {
      setErr(t("bookings.fill_price", { defaultValue: "Укажите корректную цену" }));
      return;
    }
    try {
      setBusy(true);
      await onSendPrice?.(booking.id, { price: priceNumber, currency, note: note.trim() });
      setPriceRaw("");
      setNote("");
    } catch (e) {
      setErr(e?.response?.data?.message || t("common.error", { defaultValue: "Ошибка" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border bg-white">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="font-semibold text-gray-900">
          {t("bookings.price_agreement", { defaultValue: "Согласование цены" })}
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
          {t("status.pending", { defaultValue: "ожидает" })}
        </span>
      </div>

      {/* last reply */}
      {lastReply && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">
              {t("bookings.last_offer", { defaultValue: "Последнее предложение" })}:
            </span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(Number(lastReply.price))} {currency}
            </span>
            {lastReply.note ? <span>· {lastReply.note}</span> : null}
            {lastReply.at ? (
              <span className="text-gray-500">· {lastReply.at}</span>
            ) : null}
          </div>
        </div>
      )}

      {/* form */}
      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-[220px,1fr,140px]">
          {/* price input */}
          <label className="relative">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.price", { defaultValue: "Цена" })}
            </span>
            <div className="flex rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <div className="flex items-center px-3 text-gray-500">💵</div>
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", { defaultValue: "Напр. 120" })}
                className="flex-1 rounded-xl px-0 py-2 outline-none"
                value={priceRaw}
                onChange={(e) => setPriceRaw(onlyDigitsDot(e.target.value))}
              />
              <select
                className="rounded-r-xl border-l bg-gray-50 px-3 py-2 text-sm outline-none"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </label>

          {/* note */}
          <label className="md:col-span-1">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.comment_optional", { defaultValue: "Комментарий (необязательно)" })}
            </span>
            <input
              className="w-full rounded-xl border bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400"
              placeholder={t("bookings.comment_placeholder", {
                defaultValue: "Например: в цену включены парковки",
              })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {/* send */}
          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!canSend}
              className="w-full rounded-xl bg-orange-600 px-4 py-2 font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? t("common.sending", { defaultValue: "Отправка…" })
                : t("bookings.send_price", { defaultValue: "Отправить цену" })}
            </button>
          </div>
        </div>

        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}
