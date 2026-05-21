// frontend/src/pages/SupportProject.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api";

const FALLBACK_PRESETS = [10000, 25000, 50000, 100000];
const FALLBACK_MIN_AMOUNT = 1000;

function formatSum(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.trunc(n)));
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeAmounts(value) {
  const arr = Array.isArray(value) ? value : FALLBACK_PRESETS;
  const nums = arr
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, 8);
  return nums.length ? nums : FALLBACK_PRESETS;
}

export default function SupportProject() {
  const [settings, setSettings] = useState(null);
  const [amount, setAmount] = useState(FALLBACK_PRESETS[1]);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadConfig() {
      try {
        setConfigLoading(true);
        const res = await apiGet("/api/provider-support/config", false);
        if (!alive) return;

        const cfg = res?.settings || {};
        const presets = normalizeAmounts(cfg.suggested_amounts);
        setSettings({
          enabled: cfg.enabled !== false,
          title: cfg.title || "❤️ Поддержка проекта",
          message:
            cfg.message ||
            "Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.",
          suggested_amounts: presets,
          min_amount_sum: Number(cfg.min_amount_sum || FALLBACK_MIN_AMOUNT),
        });
        setAmount((current) => (presets.includes(current) ? current : presets[0]));
      } catch {
        if (!alive) return;
        setSettings({
          enabled: true,
          title: "❤️ Поддержка проекта",
          message:
            "Добровольная поддержка помогает развивать Bot Otkaznyx Turov и Travella. Для поставщика это дополнительный сигнал активности и доверия внутри экосистемы.",
          suggested_amounts: FALLBACK_PRESETS,
          min_amount_sum: FALLBACK_MIN_AMOUNT,
        });
      } finally {
        if (alive) setConfigLoading(false);
      }
    }

    loadConfig();

    return () => {
      alive = false;
    };
  }, []);

  const presets = useMemo(
    () => normalizeAmounts(settings?.suggested_amounts),
    [settings?.suggested_amounts]
  );

  const minAmount = Number(settings?.min_amount_sum || FALLBACK_MIN_AMOUNT);

  const finalAmount = useMemo(() => {
    const n = Number(onlyDigits(custom));
    return n > 0 ? n : amount;
  }, [amount, custom]);

  const amountError = useMemo(() => {
    if (!finalAmount) return "Укажите сумму поддержки.";
    if (finalAmount < minAmount) return `Минимальная сумма — ${formatSum(minAmount)} сум.`;
    return "";
  }, [finalAmount, minAmount]);

  async function startPayment() {
    if (loading || amountError || settings?.enabled === false) return;

    setLoading(true);
    setError("");

    try {
      const res = await apiPost(
        "/api/provider-support/create",
        {
          amount_sum: finalAmount,
          note: "Web provider support",
        },
        "provider"
      );

      if (res?.pay_url) {
        window.location.href = res.pay_url;
        return;
      }

      throw new Error("Payme ссылка не создана");
    } catch (e) {
      setError(e?.message || "Не удалось создать оплату Payme.");
      setLoading(false);
    }
  }

  if (configLoading) {
    return (
      <div className="mx-auto max-w-4xl px-3 py-8">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-4 h-9 w-2/3 animate-pulse rounded-2xl bg-slate-100" />
          <div className="mt-3 h-24 animate-pulse rounded-3xl bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-3 py-8">
      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-orange-500 px-6 py-8 text-white">
            <div className="inline-flex rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ring-1 ring-white/20">
              Travella support
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">
              {settings?.title || "❤️ Поддержка проекта"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/85">
              {settings?.message}
            </p>
          </div>

          <div className="space-y-5 p-6">
            {settings?.enabled === false ? (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800 ring-1 ring-amber-100">
                Поддержка проекта сейчас временно отключена администратором.
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">
                      Выберите сумму
                    </h2>
                    <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
                      от {formatSum(minAmount)} сум
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {presets.map((x) => (
                      <button
                        key={x}
                        type="button"
                        onClick={() => {
                          setAmount(x);
                          setCustom("");
                          setError("");
                        }}
                        className={`rounded-2xl px-4 py-3 text-sm font-black ring-1 transition ${
                          finalAmount === x && !custom
                            ? "bg-orange-500 text-white ring-orange-500 shadow-lg shadow-orange-100"
                            : "bg-slate-50 text-slate-800 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {formatSum(x)} сум
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Своя сумма, сум</span>
                  <input
                    value={custom}
                    onChange={(e) => {
                      setCustom(onlyDigits(e.target.value));
                      setError("");
                    }}
                    inputMode="numeric"
                    placeholder="Например: 75000"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                  />
                </label>

                {(amountError || error) && (
                  <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700 ring-1 ring-red-100">
                    {error || amountError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={loading || !!amountError}
                  onClick={startPayment}
                  className="w-full rounded-2xl bg-orange-500 px-5 py-4 text-base font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  {loading ? "Создаём Payme ссылку..." : `Поддержать на ${formatSum(finalAmount)} сум`}
                </button>

                <p className="text-center text-xs font-semibold leading-5 text-slate-500">
                  Оплата проходит через Payme. После оплаты вы вернётесь на страницу подтверждения, а донат появится в админке Finance → Support.
                </p>
              </>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
              Зачем это поставщику
            </div>
            <div className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                Поддержка фиксируется в системе и видна администратору как вклад поставщика в развитие экосистемы.
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                Это не комиссия и не обязательный платёж. Это добровольная поддержка проекта.
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                Деньги помогают развивать бот, маркетплейс, модерацию, доверие и поток клиентов.
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-orange-100 bg-orange-50 p-5 shadow-sm">
            <div className="text-lg font-black text-slate-950">После оплаты</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
              Payme вернёт вас на страницу подтверждения. Если callback задержится, страница несколько раз сама проверит статус платежа.
            </p>
            <Link
              to="/dashboard/profile"
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800"
            >
              Вернуться в кабинет
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
