// frontend/src/pages/ClientBalance.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../api";
import { tError, tSuccess } from "../shared/toast";
import { redirectToPaymeGuide } from "../utils/paymeGuide";
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

    return new Date(x).toLocaleString(locale, {
      timeZone: "Asia/Tashkent",
    });
  } catch {
    return String(x);
  }
}

function getLedgerRows(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.ledger)) return payload.ledger;
  return [];
}

function getBalanceTiyin(payload) {
  return Number(
    payload?.balance_tiyin ??
      payload?.balance ??
      0
  );
}

function getUnlockPriceTiyin(payload) {
  return Number(
    payload?.unlock_price_tiyin ??
      payload?.unlock_price ??
      payload?.unlockPriceTiyin ??
      10000
  );
}

function cleanNumericInput(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

const PRESET_AMOUNTS_SUM = [10000, 25000, 50000, 100000];

export default function ClientBalance() {
  const { t, i18n } = useTranslation();

  const didInitialFlowRef = useRef(false);
  const redirectTimerRef = useRef(null);

  const [balance, setBalance] = useState(0);
  const [unlockPrice, setUnlockPrice] = useState(10000);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [serviceId, setServiceId] = useState(null);

  const [showAutoPayModal, setShowAutoPayModal] = useState(false);
  const [autoPayPromptSeen, setAutoPayPromptSeen] = useState(false);
  const [returnUnlockLoading, setReturnUnlockLoading] = useState(false);
  const [returnStatus, setReturnStatus] = useState("");

  async function loadAll() {
    setLoading(true);

    try {
      const [bal, led] = await Promise.all([
        apiGet("/api/client/balance", "client"),
        apiGet("/api/client/balance/ledger?limit=50", "client"),
      ]);

      setBalance(getBalanceTiyin(bal));
      setUnlockPrice(getUnlockPriceTiyin(bal));
      setLedger(getLedgerRows(led));

      window.dispatchEvent(new Event("client:balance:changed"));

      return { balancePayload: bal, ledgerPayload: led };
    } catch (e) {
      console.error("[ClientBalance] loadAll error:", e);

      tError(
        t("balance.load_error", {
          defaultValue: "Не удалось загрузить баланс",
        })
      );

      return null;
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
      const payload = {
        amount: sum,
      };

      if (serviceId) {
        payload.service_id = serviceId;
        payload.redirect_url = `${window.location.origin}/client/balance?service_id=${serviceId}`;
      } else {
        payload.redirect_url = `${window.location.origin}/client/balance`;
      }

      const endpoint = serviceId
        ? "/api/client/unlock-auto"
        : "/api/client/balance/topup-order";

      const data = await apiPost(endpoint, payload, "client");

      if (data?.ok && (data?.unlocked || data?.already_unlocked || data?.alreadyUnlocked)) {
        localStorage.setItem(`marketplace:unlocked:${serviceId}`, "1");
        window.dispatchEvent(new Event("client:balance:changed"));

        tSuccess(
          t("balance.unlocked_success", {
            defaultValue: "Контакты открыты 🎉",
          })
        );

        window.location.href = `/marketplace?opened=${serviceId}`;
        return;
      }

      if (!data?.pay_url) {
        throw new Error("pay_url not returned");
      }

      tSuccess(
        t("balance.topup_created", {
          amount: formatMoney(sum, i18n.language),
          defaultValue: `Заказ на оплату создан: ${formatMoney(sum, i18n.language)}`,
        })
      );

      redirectToPaymeGuide(data.pay_url, {
        purpose: serviceId ? "unlock_contact" : "balance_topup",
        amount: sum,
        orderId: data?.order_id || data?.order?.id || null,
        serviceId: serviceId || null,
      });
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

  async function tryUnlockAfterReturn(serviceIdFromUrl, orderIdFromUrl) {
    if (!serviceIdFromUrl) return false;

    const returnKey = `client_balance:return_unlock:${serviceIdFromUrl}:${orderIdFromUrl || "no_order"}`;

    if (sessionStorage.getItem(returnKey) === "done") {
      return true;
    }

    setReturnUnlockLoading(true);
    setReturnStatus(
      t("balance.return_checking", {
        defaultValue: "Проверяем оплату и открываем контакты…",
      })
    );

try {
  await loadAll();

  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await apiPost(
      "/api/client/unlock-auto",
      {
        service_id: serviceIdFromUrl,
        order_id: orderIdFromUrl || undefined,
      },
      "client"
    );

    if (
      result?.ok &&
      (
        result?.unlocked ||
        result?.already ||
        result?.alreadyUnlocked ||
        result?.already_unlocked
      )
    ) {
      sessionStorage.setItem(returnKey, "done");

      localStorage.setItem(
        `marketplace:unlocked:${serviceIdFromUrl}`,
        "1"
      );

      tSuccess(
        t("balance.unlocked_success", {
          defaultValue: "Контакты открыты 🎉",
        })
      );

      window.dispatchEvent(
        new Event("client:balance:changed")
      );

      setReturnStatus(
        t("balance.return_success", {
          defaultValue:
            "Готово. Возвращаем вас к объявлению…",
        })
      );

      redirectTimerRef.current = window.setTimeout(() => {
        window.location.href =
          `/marketplace?opened=${serviceIdFromUrl}&unlock=success`;
      }, 700);

      return true;
    }

    if (attempt < maxAttempts) {
      setReturnStatus(
        t("balance.return_checking_attempt", {
          attempt,
          defaultValue:
            `Проверяем оплату… попытка ${attempt}/${maxAttempts}`,
        })
      );

      await new Promise((resolve) =>
        window.setTimeout(resolve, 1200)
      );
    }
  }

  setReturnStatus(
    t("balance.return_pending", {
      defaultValue:
        "Оплата ещё подтверждается. Обновите страницу через несколько секунд.",
    })
  );

  return false;
} catch (e) {
      console.error("[ClientBalance] tryUnlockAfterReturn error:", e);

      setReturnStatus(
        t("balance.return_failed", {
          defaultValue:
            "Не удалось автоматически открыть контакты. Если оплата прошла, попробуйте ещё раз через несколько секунд.",
        })
      );

      return false;
    } finally {
      setReturnUnlockLoading(false);
    }
  }

  useEffect(() => {
    if (didInitialFlowRef.current) return;
    didInitialFlowRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const sidRaw = params.get("service_id");
    const orderId = params.get("order_id");

    const sid = Number(sidRaw);

    if (sid && Number.isFinite(sid)) {
      setServiceId(sid);
    }

    loadAll().then(async () => {
      if (sid && Number.isFinite(sid) && orderId) {
        const unlocked = await tryUnlockAfterReturn(sid, orderId);

        if (!unlocked) {
          await loadAll();
        }
      }
    });

    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

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
        : unlockPriceSumLocal || PRESET_AMOUNTS_SUM[0];

    return {
      balanceTiyin: balanceTiyinLocal,
      unlockPriceTiyin: unlockPriceTiyinLocal,
      unlockPriceSum: unlockPriceSumLocal,
      needTiyin: needTiyinLocal,
      needSum: needSumLocal,
      recommendedAmount: recommendedAmountLocal,
    };
  }, [balance, unlockPrice]);

  const isServiceUnlockFlow = !!serviceId;
  const directUnlockAmount = unlockPriceSum || Math.round(Number(unlockPrice || 0) / 100) || 0;

  useEffect(() => {
    if (!serviceId) return;
    if (topupLoading) return;
    if (returnUnlockLoading) return;
    if (directUnlockAmount <= 0) return;
    if (autoPayPromptSeen) return;

    setShowAutoPayModal(true);
    setAutoPayPromptSeen(true);
  }, [
    serviceId,
    directUnlockAmount,
    topupLoading,
    returnUnlockLoading,
    autoPayPromptSeen,
  ]);

  const effectivePayAmount = isServiceUnlockFlow
    ? directUnlockAmount
    : Math.trunc(Number(customAmount || 0)) > 0
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

      {(loading || returnUnlockLoading || returnStatus) && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          {returnStatus || t("common.loading", { defaultValue: "Загрузка…" })}
        </div>
      )}

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

      {isServiceUnlockFlow && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl text-sm text-emerald-800">
          <b>
            {t("balance.direct_unlock_title", {
              defaultValue: "Прямая оплата открытия контактов",
            })}
          </b>

          <div className="mt-1">
            {t("balance.direct_unlock_text", {
              defaultValue:
                "Оплатите фиксированную стоимость открытия контактов. После оплаты контакты откроются автоматически, и вы вернётесь к карточке.",
            })}
          </div>
        </div>
      )}

      {!isServiceUnlockFlow && balanceTiyin > 0 && unlockPriceTiyin > 0 && (
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl">
          {t("balance.can_open", {
            defaultValue: "Можно открыть контактов",
          })}
          : {Math.floor(balanceTiyin / unlockPriceTiyin)}
        </div>
      )}

      {!isServiceUnlockFlow && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {PRESET_AMOUNTS_SUM.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setCustomAmount(String(v))}
            className={`p-4 rounded-xl border transition ${
              v === effectivePayAmount
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
      )}

      {!isServiceUnlockFlow && (
        <input
          className="w-full border rounded-xl px-4 py-3"
          value={customAmount}
          onChange={(e) => setCustomAmount(cleanNumericInput(e.target.value))}
          placeholder={t("balance.custom_placeholder", {
            defaultValue: "Своя сумма, например 75000",
          })}
          inputMode="numeric"
        />
      )}

      <button
        type="button"
        onClick={() => doTopup(effectivePayAmount)}
        disabled={topupLoading || returnUnlockLoading}
        className="w-full py-4 bg-black text-white rounded-xl font-semibold text-lg disabled:opacity-60"
      >
        {topupLoading
          ? t("balance.creating", {
              defaultValue: "Создание…",
            })
          : serviceId
          ? t("balance.pay_cta_unlock", {
              defaultValue: "🚀 Оплатить и открыть контакты",
            })
          : t("balance.pay_cta", {
              defaultValue: "🚀 Пополнить баланс",
            })}
      </button>

      <div className="text-xs text-gray-500 text-center">
        {serviceId
          ? t("balance.instant_unlock", {
              defaultValue: "Контакты откроются автоматически после оплаты",
            })
          : t("balance.instant_topup", {
              defaultValue: "Баланс обновится автоматически после оплаты",
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
                  <div>{fmtTs(row.created_at, i18n.language)}</div>

                  {(row.type || row.reason || row.note) && (
                    <div className="text-xs text-gray-400 truncate max-w-[220px]">
                      {row.note || row.type || row.reason}
                    </div>
                  )}
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
          onClick={() => setShowAutoPayModal(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden bg-gradient-to-r from-orange-500 via-orange-400 to-amber-400 px-6 py-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15" />
              <div className="pointer-events-none absolute -bottom-16 left-16 h-32 w-32 rounded-full bg-white/10" />

              <div className="relative flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl shadow-inner">
                  🔐
                </div>

                <div className="min-w-0">
                  <h3 className="text-lg font-extrabold leading-tight tracking-tight">
                    {t("balance.unlock_paywall_title_v2", {
                      defaultValue: "Открытие контактов поставщика",
                    })}
                  </h3>

                  <p className="mt-1 text-sm leading-5 text-white/95">
                    {t("balance.unlock_paywall_subtitle_v2", {
                      defaultValue: "Оплатите один раз — контакты откроются сразу и останутся доступны.",
                    })}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-orange-600">
                      {t("balance.unlock_paywall_amount_label_v2", {
                        defaultValue: "Стоимость доступа",
                      })}
                    </div>

                    <div className="mt-1 text-4xl font-black leading-none tracking-tight text-gray-950">
                      {formatMoney(effectivePayAmount, i18n.language)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-orange-100">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      {t("balance.unlock_paywall_order_label_v2", {
                        defaultValue: "Заказ",
                      })}
                    </div>
                    <div className="text-sm font-bold text-gray-800">
                      #{serviceId || "—"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-xs font-medium text-gray-500">
                  {t("balance.unlock_paywall_no_repeat_v2", {
                    defaultValue: "Без повторной оплаты за эту услугу",
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white text-base shadow-sm">
                    ✨
                  </span>
                  {t("balance.unlock_paywall_after_title_v2", {
                    defaultValue: "Что откроется после оплаты",
                  })}
                </div>

                <div className="grid grid-cols-1 gap-2 text-sm text-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    <span>
                      {t("balance.unlock_paywall_phone_v2", {
                        defaultValue: "Телефон поставщика",
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    <span>
                      {t("balance.unlock_paywall_messengers_v2", {
                        defaultValue: "Telegram / WhatsApp, если они указаны",
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    <span>
                      {t("balance.unlock_paywall_direct_v2", {
                        defaultValue: "Прямой контакт без посредников",
                      })}
                    </span>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs font-medium leading-5 text-gray-500 ring-1 ring-gray-100">
                  {t("balance.unlock_paywall_auto_v2", {
                    defaultValue: "Контакты откроются автоматически сразу после успешной оплаты.",
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowAutoPayModal(false)}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  {t("balance.unlock_paywall_cancel_v2", {
                    defaultValue: "Отмена",
                  })}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAutoPayModal(false);
                    doTopup(effectivePayAmount);
                  }}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-500/25 transition hover:from-orange-600 hover:to-orange-700 disabled:opacity-60"
                  disabled={topupLoading || returnUnlockLoading}
                >
                  {topupLoading
                    ? t("balance.creating", {
                        defaultValue: "Создание…",
                      })
                    : t("balance.unlock_paywall_cta_v2", {
                        defaultValue: "Оплатить и открыть",
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
