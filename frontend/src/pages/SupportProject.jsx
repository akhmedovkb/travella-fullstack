// frontend/src/pages/SupportProject.jsx

import React, { useMemo, useState } from "react";
import { apiPost } from "../api";
import { redirectToPaymeGuide } from "../utils/paymeGuide";

const PRESETS = [20000, 50000, 100000, 200000];

function formatSum(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(n);
}

export default function SupportProject() {
  const [amount, setAmount] = useState(50000);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const finalAmount = useMemo(() => {
    const n = Number(String(custom || "").replace(/\D/g, ""));
    return n > 0 ? n : amount;
  }, [amount, custom]);

  async function startPayment() {
    setLoading(true);
    setError("");

    try {
      const res = await apiPost(
        "/api/provider-support/create",
        { amount_sum: finalAmount, note: "Web provider support" },
        "provider"
      );

      if (res?.pay_url) {
        redirectToPaymeGuide(res.pay_url, {
          purpose: "provider_support",
          amount: finalAmount,
          orderId: res?.order_id || res?.order?.id || null,
        });
        return;
      }

      throw new Error("Payme ссылка не создана");
    } catch (e) {
      setError(e?.message || "Не удалось создать оплату Payme.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-3 py-8">
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-orange-500 px-6 py-8 text-white">
          <div className="inline-flex rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ring-1 ring-white/20">
            Поддержка проекта
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">
            Поддержать Travella / Bot Otkaznyx Turov
          </h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/85">
            Добровольная поддержка помогает развивать сервис отказных туров. Для поставщика это также дополнительный сигнал активности и доверия внутри экосистемы.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PRESETS.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => {
                  setAmount(x);
                  setCustom("");
                }}
                className={`rounded-2xl px-4 py-3 text-sm font-black ring-1 transition ${
                  finalAmount === x && !custom
                    ? "bg-orange-500 text-white ring-orange-500"
                    : "bg-slate-50 text-slate-800 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {formatSum(x)} сум
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-sm font-black text-slate-700">Своя сумма, сум</span>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              inputMode="numeric"
              placeholder="Например: 75000"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
            />
          </label>

          {error && (
            <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700 ring-1 ring-red-100">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={loading || finalAmount <= 0}
            onClick={startPayment}
            className="w-full rounded-2xl bg-orange-500 px-5 py-4 text-base font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {loading ? "Создаём Payme ссылку..." : `Поддержать на ${formatSum(finalAmount)} сум`}
          </button>

          <p className="text-center text-xs font-semibold leading-5 text-slate-500">
            Оплата проходит через Payme. После оплаты вы вернётесь на страницу подтверждения.
          </p>
        </div>
      </div>
    </div>
  );
}
