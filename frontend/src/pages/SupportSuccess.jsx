// frontend/src/pages/SupportSuccess.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet } from "../api";

function formatSum(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(n);
}

function normalizeStatus(donationStatus, orderStatus, paymeState) {
  const d = String(donationStatus || "").toLowerCase();
  const o = String(orderStatus || "").toLowerCase();

  if (d === "paid" || o === "paid" || Number(paymeState) === 2) return "paid";
  if (["canceled", "cancelled", "failed", "expired"].includes(d)) return "failed";
  if (["canceled", "cancelled", "failed", "expired"].includes(o)) return "failed";
  return "pending";
}

export default function SupportSuccess() {
  const [params] = useSearchParams();
  const donationId = params.get("donation_id") || params.get("donationId") || "";
  const orderId = params.get("order_id") || params.get("orderId") || "";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const status = useMemo(() => {
    return normalizeStatus(
      data?.donation?.status,
      data?.order?.status,
      data?.payme?.state
    );
  }, [data]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    let attempts = 0;

    async function load() {
      if (!donationId && !orderId) {
        if (!alive) return;
        setError("Не найден номер платежа поддержки проекта.");
        setLoading(false);
        return;
      }

      attempts += 1;

      try {
        const query = new URLSearchParams();
        if (donationId) query.set("donation_id", donationId);
        if (orderId) query.set("order_id", orderId);

        const res = await apiGet(`/api/provider-support/status?${query.toString()}`, false);
        if (!alive) return;

        setData(res);
        setError("");
        setLoading(false);

        const currentStatus = normalizeStatus(
          res?.donation?.status,
          res?.order?.status,
          res?.payme?.state
        );

        if (currentStatus === "pending" && attempts < 8) {
          timer = window.setTimeout(load, 2500);
        }
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Не удалось проверить статус платежа.");
        setLoading(false);

        if (attempts < 5) {
          timer = window.setTimeout(load, 2500);
        }
      }
    }

    load();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [donationId, orderId]);

  const amount = data?.donation?.amount_sum || 0;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center px-3 py-8">
      <div className="w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400 px-6 py-7 text-white">
          <div className="inline-flex rounded-full bg-white/18 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ring-1 ring-white/30">
            Travella / Bot Otkaznyx Turov
          </div>
          <h1 className="mt-4 text-2xl font-black leading-tight tracking-[-0.03em]">
            Поддержка проекта
          </h1>
          <p className="mt-2 text-sm font-semibold text-white/90">
            Проверяем статус платежа Payme и фиксируем поддержку в системе.
          </p>
        </div>

        <div className="space-y-5 p-6">
          {loading ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-700 ring-1 ring-slate-100">
              Проверяем оплату...
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700 ring-1 ring-red-100">
              {error}
            </div>
          ) : status === "paid" ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-100">
              <div className="text-xl font-black">Спасибо! Оплата прошла успешно.</div>
              <p className="mt-2 text-sm font-semibold leading-6">
                Ваша поддержка проекта зафиксирована. Это помогает развивать экосистему отказных туров и повышает доверие к активным поставщикам.
              </p>
            </div>
          ) : status === "failed" ? (
            <div className="rounded-2xl bg-red-50 p-5 text-red-800 ring-1 ring-red-100">
              <div className="text-xl font-black">Платёж не завершён.</div>
              <p className="mt-2 text-sm font-semibold leading-6">
                Payme вернул статус отмены, ошибки или истечения времени. Можно создать новую ссылку поддержки в боте.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 p-5 text-amber-800 ring-1 ring-amber-100">
              <div className="text-xl font-black">Платёж ещё обрабатывается.</div>
              <p className="mt-2 text-sm font-semibold leading-6">
                Иногда Payme callback приходит с задержкой. Страница проверяет статус автоматически.
              </p>
            </div>
          )}

          <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-100">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Сумма</span>
              <span className="font-black text-slate-950">{formatSum(amount)} сум</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Donation ID</span>
              <span className="font-black text-slate-950">{data?.donation?.id || donationId || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Order ID</span>
              <span className="font-black text-slate-950">{data?.order?.id || orderId || "—"}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              to="/marketplace"
              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
            >
              На маркетплейс
            </Link>
            <a
              href="https://t.me/OTKAZNYX_TUROV_UZB_BOT"
              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-orange-600"
            >
              Открыть бот
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
