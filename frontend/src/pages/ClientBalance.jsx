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

const PRESETS = [25000, 50000, 100000, 200000];

export default function ClientBalance() {
  const { t, i18n } = useTranslation();

  const [balance, setBalance] = useState(0);
  const [unlockPrice, setUnlockPrice] = useState(10000);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState("");

  // 🔥 ВАЖНО: service_id из URL
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
      console.error(e);
      tError(t("balance.load_error"));
    } finally {
      setLoading(false);
    }
  }

  async function doTopup(amount) {
    const sum = Math.trunc(Number(amount || 0));
    if (!Number.isFinite(sum) || sum <= 0) {
      return tError(t("balance.invalid_amount"));
    }

    setTopupLoading(true);
    try {
      const payload = {
        amount: sum,
      };

      // 🔥 если есть service_id — добавляем
      if (serviceId) {
        payload.service_id = serviceId;
      }

      const data = await apiPost(
        "/api/client/balance/topup-order",
        payload,
        "client"
      );

      if (!data?.pay_url) {
        throw new Error("pay_url not returned");
      }

      tSuccess(
        t("balance.topup_created", { amount: formatMoney(sum, i18n.language) })
      );

      window.location.href = data.pay_url;
    } catch (e) {
      console.error(e);
      tError(e?.message || t("balance.payme_error"));
    } finally {
      setTopupLoading(false);
    }
  }

  useEffect(() => {
    // 🔥 достаём service_id из URL
    const params = new URLSearchParams(window.location.search);
    const sid = Number(params.get("service_id"));

    if (sid && Number.isFinite(sid)) {
      setServiceId(sid);
      console.log("[ClientBalance] service_id from URL =", sid);
    }

    loadAll();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {t("balance.title")}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {t("balance.subtitle")}
            </p>
          </div>

          <button
            className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
            onClick={loadAll}
            disabled={loading}
          >
            {loading ? t("common.loading") : t("common.refresh")}
          </button>
        </div>

        {/* 🔥 показываем контекст */}
        {serviceId && (
          <div className="mt-4 text-sm text-blue-600">
            {t("balance.context_unlock")}: #{serviceId}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div className="rounded-2xl bg-gray-50 border p-5">
            <div className="text-sm text-gray-500">
              {t("balance.current")}
            </div>
            <div className="mt-2 text-3xl font-semibold">
              {formatMoney(balance, i18n.language)}
            </div>
          </div>

          <div className="rounded-2xl bg-gray-50 border p-5">
            <div className="text-sm text-gray-500">
              {t("balance.unlock_price")}
            </div>
            <div className="mt-2 text-3xl font-semibold">
              {formatMoney(unlockPrice, i18n.language, true)}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">
            {t("balance.topup")}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("balance.choose_amount")}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {PRESETS.map((v) => (
            <button
              key={v}
              className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-60"
              onClick={() => doTopup(v)}
              disabled={topupLoading}
            >
              {formatMoney(v, i18n.language)}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 border rounded-xl px-4 py-3"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder={t("balance.custom_placeholder")}
          />
          <button
            className="px-5 py-3 rounded-xl bg-black text-white disabled:opacity-60"
            onClick={() => doTopup(customAmount)}
            disabled={topupLoading}
          >
            {topupLoading
              ? t("balance.creating")
              : t("balance.pay")}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {t("balance.history")}
          </h2>
          <div className="text-sm text-gray-500">
            {ledger.length} {t("balance.records")}
          </div>
        </div>

        {!ledger.length ? (
          <div className="text-sm text-gray-400">
            {t("balance.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">{t("balance.date")}</th>
                  <th className="py-2 pr-4">{t("balance.amount")}</th>
                  <th className="py-2 pr-4">{t("balance.reason")}</th>
                  <th className="py-2 pr-4">{t("balance.source")}</th>
                  <th className="py-2 pr-4">Service ID</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="py-3 pr-4">
                      {fmtTs(row.created_at)}
                    </td>

                    <td
                      className={`py-3 pr-4 font-medium ${
                        Number(row.amount) < 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {Number(row.amount) > 0 ? "+" : ""}
                      {formatMoney(row.amount, i18n.language)}
                    </td>

                    <td className="py-3 pr-4">
                      {row.reason || "—"}
                    </td>

                    <td className="py-3 pr-4">
                      {row.source || "—"}
                    </td>

                    <td className="py-3 pr-4">
                      {row.service_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
