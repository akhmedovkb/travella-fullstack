// frontend/src/components/PriceAgreementCard.jsx
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const CURRENCIES = ["USD", "EUR", "UZS"];
const onlyDigitsDot = (s) => String(s || "").replace(/[^\d.]/g, "");
const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

export default function PriceAgreementCard({
  booking,                 // { id, provider_price, provider_note, updated_at, status, currency }
  onSendPrice,             // async (bookingId, { price, currency, note }) => void
  onSent,                  // (legacy) optional
  disabled = false,
}) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const bookCurrency = booking?.currency || "USD";

  const lastReply = useMemo(() => {
    const p = Number(booking?.provider_price);
    if (!isFiniteNum(p)) return null;
    const at = booking?.updated_at ? new Date(booking.updated_at) : null;
    return {
      price: p,
      note: booking?.provider_note,
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
  }, [booking?.provider_price, booking?.provider_note, booking?.updated_at]);

  const priceNumber = useMemo(() => {
    const n = Number(onlyDigitsDot(priceRaw));
    return isFiniteNum(n) ? n : NaN;
  }, [priceRaw]);

  const canSend =
    !disabled &&
    !busy &&
    String(booking?.status) === "pending" &&
    isFiniteNum(priceNumber) &&
    priceNumber > 0 &&
    CURRENCIES.includes(currency);

  const submit = async () => {
    setErr("");
    if (!canSend) {
      setErr(t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" }));
      return;
    }
    try {
      setBusy(true);
      if (onSendPrice) {
        await onSendPrice(booking.id, {
          price: priceNumber,
          currency,
          note: note.trim(),
        });
      } else {
        onSent?.();
      }
      setPriceRaw("");
      setNote("");
    } catch (e) {
      setErr(
        e?.response?.data?.message ||
          t("bookings.price_send_error", { defaultValue: "Ошибка отправки цены" })
      );
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

      {/* last offer */}
      {lastReply && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">
              {t("bookings.last_offer", { defaultValue: "Последнее предложение" })}:
            </span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(lastReply.price)} {bookCurrency}
            </span>
            {lastReply.note ? <span>· {lastReply.note}</span> : null}
            {lastReply.at ? <span className="text-gray-500">· {lastReply.at}</span> : null}
          </div>
        </div>
      )}

      {/* form */}
      <div className="px-4 pb-4 pt-3">
        {/* На десктопе 4 колонки: Цена | Валюта | Комментарий | Кнопка */}
        <div className="grid gap-3 md:grid-cols-[220px,110px,1fr,170px]">
          {/* price */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.price", { defaultValue: "Цена" })}
            </span>
            <div className="flex h-11 items-center rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <div className="px-3 text-gray-500">💵</div>
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", { defaultValue: "Напр. 120" })}
                className="w-full h-full flex-1 bg-transparent px-0 pr-3 outline-none"
                value={priceRaw}
                onChange={(e) => setPriceRaw(onlyDigitsDot(e.target.value))}
              />
            </div>
          </label>

          {/* currency — отдельная колонка */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.currency", { defaultValue: "Валюта" })}
            </span>
            <select
              className="w-full h-11 rounded-xl border bg-gray-50 px-3 outline-none"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {/* note */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.comment_optional", { defaultValue: "Комментарий (необязательно)" })}
            </span>
            <input
              className="w-full h-11 rounded-xl border bg-white px-3 outline-none focus:ring-2 focus:ring-orange-400 placeholder:text-gray-400"
              placeholder={t("bookings.comment_placeholder", {
                defaultValue: "Например: парковки и ожидание включены",
              })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {/* button */}
          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!canSend}
              className="w-full h-11 rounded-xl bg-orange-600 px-4 font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
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
