// frontend/src/pages/ClientBalance.jsx

import { useEffect, useMemo, useState } from "react";
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

function fmtTs(x, lang = "ru") {
  if (!x) return "—";
  try {
    const locale =
      lang === "uz" ? "uz-UZ" :
      lang === "en" ? "en-US" :
      "ru-RU";

    return new Date(x).toLocaleString(locale, { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

const PRESET_AMOUNTS_SUM = [10000, 25000, 50000, 100000];

export default function ClientBalance() {
  const { t, i18n } = useTranslation();

  const [balance, setBalance] = useState(0); // tiyin
  const [unlockPrice, setUnlockPrice] = useState(10000); // tiyin
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [serviceId, setServiceId] = useState(null);

  const [showAutoPayModal, setShowAutoPayModal] = useState(false);
  const [autoPayPromptSeen, setAutoPayPromptSeen] = useState(false);

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
      console.error("[ClientBalance] loadAll error:", e);
      tError(
        t("balance.load_error", {
          defaultValue: "Не удалось загрузить баланс",
        })
      );
    } finally {
      setLoading(false);
    }
  }

  async function doTopup(amountSumInput) {
    const sum = Math.trunc(Number(amountSumInput || 0));
    if (!Number.isFinite(sum) || sum <= 0) {
      return tError(
        t("balance.invalid_amount", {
          defaultValue: "Укажи корректную сумму",
        })
      );
    }

    setTopupLoading(true);
    try {
      const payload = { amount: sum };
      if (serviceId) payload.service_id = serviceId;

      const data = await apiPost(
        "/api/client/balance/topup-order",
        payload,
        "client"
      );

      if (!data?.pay_url) {
        throw new Error("pay_url not returned");
      }

      tSuccess(
        t("balance.topup_created", {
          amount: formatMoney(sum, i18n.language),
          defaultValue: `Заказ на пополнение создан: ${formatMoney(sum, i18n.language)}`,
        })
      );

      window.location.href = data.pay_url;
    } catch (e) {
      console.error("[ClientBalance] doTopup error:", e);
      tError(
        e?.message ||
          t("balance.payme_error", {
            defaultValue: "Ошибка Payme",
          })
      );
    } finally {
      setTopupLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = Number(params.get("service_id"));
    const orderId = params.get("order_id");

    if (sid && Number.isFinite(sid)) {
      setServiceId(sid);
    }

    loadAll().then(() => {
      if (sid && orderId) {
        setTimeout(() => {
          localStorage.setItem(`marketplace:unlocked:${sid}`, "1");

          tSuccess(
            t("balance.unlocked_success", {
              defaultValue: "Контакты открыты 🎉",
            })
          );
          window.dispatchEvent(new Event("client:balance:changed"));

          setTimeout(() => {
            window.location.href = `/marketplace?opened=${sid}`;
          }, 800);
        }, 700);
      }
    });
  }, [t]);

  const {
    balanceTiyin,
    unlockPriceTiyin,
    unlockPriceSum,
    needTiyin,
    needSum,
    recommendedAmount,
  } = useMemo(() => {
    const balanceTiyinLocal = Number(balance || 0);
    const unlockPriceTiyinLocal = Number(unlockPrice || 0);

    const unlockPriceSumLocal = Math.round(unlockPriceTiyinLocal / 100);

    const needTiyinLocal = Math.max(unlockPriceTiyinLocal - balanceTiyinLocal, 0);
    const needSumLocal = Math.round(needTiyinLocal / 100);

    const recommendedAmountLocal =
      needSumLocal > 0
        ? Math.ceil(needSumLocal / 10000) * 10000
        : unlockPriceSumLocal;

    return {
      balanceTiyin: balanceTiyinLocal,
      unlockPriceTiyin: unlockPriceTiyinLocal,
      unlockPriceSum: unlockPriceSumLocal,
      needTiyin: needTiyinLocal,
      needSum: needSumLocal,
      recommendedAmount: recommendedAmountLocal,
    };
  }, [balance, unlockPrice]);

  useEffect(() => {
    if (!serviceId) return;
    if (topupLoading) return;
    if (needTiyin <= 0) return;
    if (autoPayPromptSeen) return;

    setCustomAmount(String(recommendedAmount));
    setShowAutoPayModal(true);
    setAutoPayPromptSeen(true);
  }, [serviceId, needTiyin, recommendedAmount, topupLoading, autoPayPromptSeen]);

  const effectivePayAmount =
    Math.trunc(Number(customAmount || 0)) > 0
      ? Math.trunc(Number(customAmount || 0))
      : recommendedAmount;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6 pb-24">
      <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 text-white p-5">
        <div className="text-lg font-bold">
          {t("balance.hero_title", {
            defaultValue: "🔓 Открой контакты поставщика",
          })}
        </div>

        <div className="text-sm mt-1 opacity-90">
          {t("balance.hero_subtitle", {
            defaultValue: "Свяжись напрямую и забронируй быстрее других",
          })}
        </div>

        {serviceId && (
          <div className="mt-3 bg-white/20 px-3 py-2 rounded-xl text-sm">
            {t("balance.hero_context", {
              defaultValue: "Вы почти открыли контакты",
            })}{" "}
            #{serviceId}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-50 border rounded-xl p-4">
          <div className="text-sm text-gray-500">
            {t("balance.current", {
              defaultValue: "Текущий баланс",
            })}
          </div>
          <div className="text-2xl font-bold">
            {formatMoney(balanceTiyin, i18n.language, true)}
          </div>
        </div>

        <div className="bg-gray-50 border rounded-xl p-4">
          <div className="text-sm text-gray-500">
            {t("balance.unlock_price", {
              defaultValue: "Цена открытия контактов",
            })}
          </div>
          <div className="text-2xl font-bold">
            {formatMoney(unlockPriceTiyin, i18n.language, true)}
          </div>
        </div>
      </div>

      {needTiyin > 0 && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl">
          <b>
            {t("balance.not_enough", {
              defaultValue: "Недостаточно средств",
            })}
          </b>
          <div>
            {t("balance.need_more", {
              defaultValue: "Не хватает",
            })}
            : {formatMoney(needSum, i18n.language)}
          </div>
        </div>
      )}

      {balanceTiyin > 0 && unlockPriceTiyin > 0 && (
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl">
          {t("balance.can_open", {
            defaultValue: "Можно открыть контактов",
          })}
          : {Math.floor(balanceTiyin / unlockPriceTiyin)}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {PRESET_AMOUNTS_SUM.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setCustomAmount(String(v))}
            className={`p-4 rounded-xl border transition ${
              v === recommendedAmount
                ? "border-orange-500 bg-orange-50"
                : "border-gray-200 bg-white hover:border-orange-300"
            }`}
          >
            <div className="font-bold">
              {formatMoney(v, i18n.language)}
            </div>

            <div className="text-xs">
              {unlockPriceSum > 0 ? Math.floor(v / unlockPriceSum) : 0}{" "}
              {t("balance.contacts", {
                defaultValue: "контактов",
              })}
            </div>

            {v === recommendedAmount && (
              <div className="text-[10px] text-orange-600">
                {t("balance.recommended", {
                  defaultValue: "Рекомендуем",
                })}
              </div>
            )}
          </button>
        ))}
      </div>

      <input
        className="w-full border rounded-xl px-4 py-3"
        value={customAmount}
        onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={t("balance.custom_placeholder", {
          defaultValue: "Своя сумма, например 75000",
        })}
        inputMode="numeric"
      />

      <button
        type="button"
        onClick={() => doTopup(effectivePayAmount)}
        disabled={topupLoading}
        className="w-full py-4 bg-black text-white rounded-xl font-semibold text-lg disabled:opacity-60"
      >
        {topupLoading
          ? t("balance.creating", {
              defaultValue: "Создание…",
            })
          : t("balance.pay_cta", {
              defaultValue: "🚀 Пополнить и открыть",
            })}
      </button>

      <div className="text-xs text-gray-500 text-center">
        {t("balance.instant_unlock", {
          defaultValue: "Контакты откроются автоматически после оплаты",
        })}
      </div>

      {serviceId && (
        <div className="text-xs text-red-500 text-center">
          {t("balance.urgency_real", {
            defaultValue:
              "После оплаты контакты откроются именно для этого предложения",
          })}
        </div>
      )}

      <div className="bg-white rounded-xl p-4">
        <h3 className="font-semibold mb-2">
          {t("balance.history", {
            defaultValue: "История операций",
          })}
        </h3>

        {!ledger.length ? (
          <div className="text-sm text-gray-400">
            {t("balance.empty", {
              defaultValue: "Операций пока нет",
            })}
          </div>
        ) : (
          <div className="space-y-0">
            {ledger.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 text-sm border-b py-2"
              >
                <div className="min-w-0 text-gray-600">
                  {fmtTs(row.created_at, i18n.language)}
                </div>

                <div
                  className={
                    Number(row.amount) > 0
                      ? "text-green-600 font-medium"
                      : "text-red-600 font-medium"
                  }
                >
                  {Number(row.amount) > 0 ? "+" : ""}
                  {formatMoney(row.amount, i18n.language, true)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAutoPayModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowAutoPayModal(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-orange-500 to-amber-400 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-bold leading-tight">
                    {t("balance.autopay_title", {
                      defaultValue: "Вы почти открыли контакты",
                    })}
                  </h3>
                  <p className="text-sm text-white/90">
                    {t("balance.autopay_subtitle", {
                      defaultValue: "Остался один шаг до прямого контакта",
                    })}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
                <div className="text-sm text-gray-700">
                  {t("balance.autopay_amount_label", {
                    defaultValue: "Рекомендуем пополнить",
                  })}
                </div>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {formatMoney(recommendedAmount, i18n.language)}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {unlockPriceSum > 0
                    ? `${Math.floor(recommendedAmount / unlockPriceSum)} ${t("balance.contacts", {
                        defaultValue: "контактов",
                      })}`
                    : null}
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 text-gray-600">
                {t("balance.autopay_text", {
                  defaultValue:
                    "После оплаты контакты откроются автоматически, и вы вернётесь к объявлению.",
                })}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowAutoPayModal(false)}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  {t("balance.autopay_later", {
                    defaultValue: "Позже",
                  })}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAutoPayModal(false);
                    doTopup(recommendedAmount);
                  }}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
                >
                  {t("balance.autopay_cta", {
                    defaultValue: "Перейти к оплате",
                  })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
