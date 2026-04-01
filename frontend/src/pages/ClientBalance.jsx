// frontend/src/pages/ClientBalance.jsx

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { tError, tSuccess } from "../shared/toast";
import { useTranslation } from "react-i18next";

function formatMoney(value, lang = "ru", fromTiyin = false) {
  const amount = Number(value || 0);
  const sumValue = fromTiyin ? amount / 100 : amount;

  const locale =
    lang === "uz" ? "uz-UZ" :
    lang === "en" ? "en-US" :
    "ru-RU";

  const currencyLabel =
    lang === "uz" ? "so'm" :
    lang === "en" ? "sum" :
    "сум";

  return `${Math.round(sumValue).toLocaleString(locale)} ${currencyLabel}`;
}

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

export default function ClientBalance() {
  const { t, i18n } = useTranslation();

  const [balance, setBalance] = useState(0);
  const [unlockPrice, setUnlockPrice] = useState(10000);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [serviceId, setServiceId] = useState(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [bal, led] = await Promise.all([
        apiGet("/api/client/balance", "client"),
        apiGet("/api/client/balance/ledger?limit=50", "client"),
      ]);

      setBalance(Number(bal?.balance || 0));
      setUnlockPrice(Number(bal?.unlock_price || 10000));
      setLedger(Array.isArray(led?.rows) ? led.rows : []);
      window.dispatchEvent(new Event("client:balance:changed"));
    } catch (e) {
      tError(t("balance.load_error"));
    } finally {
      setLoading(false);
    }
  }

  async function doTopup(amount) {
    const sum = Math.trunc(Number(amount || 0));
    if (!sum) return tError(t("balance.invalid_amount"));

    setTopupLoading(true);
    try {
      const payload = { amount: sum };
      if (serviceId) payload.service_id = serviceId;

      const data = await apiPost(
        "/api/client/balance/topup-order",
        payload,
        "client"
      );

      tSuccess(formatMoney(sum, i18n.language));
      window.location.href = data.pay_url;
    } catch (e) {
      tError(t("balance.payme_error"));
    } finally {
      setTopupLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = Number(params.get("service_id"));
    const orderId = params.get("order_id");

    if (sid) setServiceId(sid);

    loadAll().then(() => {
      if (sid && orderId) {
        setTimeout(() => {
          localStorage.setItem(`marketplace:unlocked:${sid}`, "1");

          tSuccess(t("balance.unlocked_success"));
          window.dispatchEvent(new Event("client:balance:changed"));

          setTimeout(() => {
            window.location.href = `/marketplace?opened=${sid}`;
          }, 800);
        }, 700);
      }
    });
  }, []);

  const need = Math.max(unlockPrice - balance, 0);

  const recommendedAmount =
    need > 0 ? Math.ceil(need / 10000) * 10000 : unlockPrice;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6 pb-24">

      {/* 🔥 HERO */}
      <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 text-white p-5">
        <div className="text-lg font-bold">
          {t("balance.hero_title")}
        </div>

        <div className="text-sm mt-1 opacity-90">
          {t("balance.hero_subtitle")}
        </div>

        {serviceId && (
          <div className="mt-3 bg-white/20 px-3 py-2 rounded-xl text-sm">
            {t("balance.hero_context")} #{serviceId}
          </div>
        )}
      </div>

      {/* 💰 BALANCE */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 border rounded-xl p-4">
          <div className="text-sm text-gray-500">
            {t("balance.current")}
          </div>
          <div className="text-2xl font-bold">
            {formatMoney(balance, i18n.language)}
          </div>
        </div>

        <div className="bg-gray-50 border rounded-xl p-4">
          <div className="text-sm text-gray-500">
            {t("balance.unlock_price")}
          </div>
          <div className="text-2xl font-bold">
            {formatMoney(unlockPrice, i18n.language, true)}
          </div>
        </div>
      </div>

      {/* 🚨 NOT ENOUGH */}
      {need > 0 && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl">
          <b>{t("balance.not_enough")}</b>
          <div>
            {t("balance.need_more")}: {formatMoney(need, i18n.language)}
          </div>
        </div>
      )}

      {/* 📊 CONTACT COUNT */}
      {balance > 0 && (
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl">
          {t("balance.can_open")}: {Math.floor(balance / unlockPrice)}
        </div>
      )}

      {/* 🎯 PACKAGES */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[10000, 25000, 50000, 100000].map((v) => (
          <button
            key={v}
            onClick={() => setCustomAmount(v)}
            className={`p-4 rounded-xl border ${
              v === recommendedAmount
                ? "border-orange-500 bg-orange-50"
                : "border-gray-200"
            }`}
          >
            <div className="font-bold">
              {formatMoney(v, i18n.language)}
            </div>
            <div className="text-xs">
              {Math.floor(v / unlockPrice)} {t("balance.contacts")}
            </div>
            {v === recommendedAmount && (
              <div className="text-[10px] text-orange-600">
                {t("balance.recommended")}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* ✍️ CUSTOM */}
      <input
        className="w-full border rounded-xl px-4 py-3"
        value={customAmount}
        onChange={(e) => setCustomAmount(e.target.value)}
        placeholder={t("balance.custom_placeholder")}
      />

      {/* 🔥 CTA */}
      <button
        onClick={() => doTopup(customAmount || recommendedAmount)}
        className="w-full py-4 bg-black text-white rounded-xl font-semibold text-lg"
      >
        {topupLoading
          ? t("balance.creating")
          : t("balance.pay_cta")}
      </button>

      <div className="text-xs text-gray-500 text-center">
        {t("balance.instant_unlock")}
      </div>

      {serviceId && (
        <div className="text-xs text-red-500 text-center">
          {t("balance.urgency")}
        </div>
      )}

      {/* 📜 HISTORY */}
      <div className="bg-white rounded-xl p-4">
        <h3 className="font-semibold mb-2">{t("balance.history")}</h3>

        {ledger.map((row) => (
          <div key={row.id} className="flex justify-between text-sm border-b py-2">
            <div>{fmtTs(row.created_at)}</div>
            <div className={row.amount > 0 ? "text-green-600" : "text-red-600"}>
              {formatMoney(row.amount, i18n.language)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
