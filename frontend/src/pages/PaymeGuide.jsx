// frontend/src/pages/PaymeGuide.jsx

import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

function formatAmount(value) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Intl.NumberFormat("ru-RU").format(Math.trunc(n));
}

function purposeText(purpose) {
  const key = String(purpose || "").trim();
  if (key === "unlock_contact") return "Открытие контактов поставщика";
  if (key === "provider_support") return "Поддержка проекта";
  if (key === "balance_topup") return "Пополнение баланса";
  return "Оплата через Payme";
}

function isProbablyPaymeUrl(value) {
  try {
    const u = new URL(String(value || ""));
    const host = u.hostname.toLowerCase();
    return host === "checkout.paycom.uz" || host.endsWith(".paycom.uz");
  } catch {
    return false;
  }
}

export default function PaymeGuide() {
  const [params] = useSearchParams();

  const payUrl = String(params.get("pay_url") || "").trim();
  const purpose = String(params.get("purpose") || "").trim();
  const amount = formatAmount(params.get("amount"));
  const orderId = String(params.get("order_id") || "").trim();
  const serviceId = String(params.get("service_id") || "").trim();

  const safePayUrl = useMemo(() => {
    return isProbablyPaymeUrl(payUrl) ? payUrl : "";
  }, [payUrl]);

  const title = purposeText(purpose);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-3xl items-center justify-center px-3 py-8">
      <div className="w-full overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-orange-500 px-6 py-7 text-white">
          <div className="inline-flex rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ring-1 ring-white/20">
            Payme
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">
            Перед оплатой — важная подсказка
          </h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/85">
            {title}
            {amount ? ` · ${amount} сум` : ""}
            {orderId ? ` · заказ #${orderId}` : ""}
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-2xl text-white shadow-lg shadow-orange-200">
                ⚠️
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-black text-slate-950">
                  Не вводите телефон для авторизации в Payme
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                  На странице Payme может быть блок входа по номеру телефона. Для обычной оплаты картой он не нужен. Если начать авторизацию по телефону, SMS может идти долго или не прийти, и оплата сорвётся.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">
                Нужно сделать
              </div>
              <div className="mt-4 space-y-3 text-sm font-bold text-slate-800">
                <div className="flex gap-3"><span>1.</span><span>Введите номер банковской карты</span></div>
                <div className="flex gap-3"><span>2.</span><span>Введите срок действия карты</span></div>
                <div className="flex gap-3"><span>3.</span><span>Нажмите кнопку оплаты</span></div>
              </div>
            </div>

            <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
              <div className="text-sm font-black uppercase tracking-[0.16em] text-red-700">
                Не нужно делать
              </div>
              <div className="mt-4 space-y-3 text-sm font-bold text-slate-800">
                <div className="flex gap-3"><span>×</span><span>Не входите в Payme по телефону</span></div>
                <div className="flex gap-3"><span>×</span><span>Не ждите SMS для авторизации Payme</span></div>
                <div className="flex gap-3"><span>×</span><span>Не закрывайте оплату после ввода карты</span></div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm font-semibold leading-6 text-slate-700">
            <b className="text-slate-950">Главное:</b> поле телефона в Payme — это вход в аккаунт Payme, а не обязательная часть оплаты. Для оплаты Travella достаточно карты и срока действия карты.
          </div>

          {!safePayUrl ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              Ссылка Payme не найдена или некорректна. Вернитесь назад и создайте оплату заново.
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to={serviceId ? `/marketplace?opened=${encodeURIComponent(serviceId)}` : "/"}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Назад
            </Link>

            <button
              type="button"
              disabled={!safePayUrl}
              onClick={() => {
                if (safePayUrl) window.location.href = safePayUrl;
              }}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(249,115,22,0.32)] ring-1 ring-orange-200/70 transition hover:-translate-y-0.5 hover:shadow-[0_24px_54px_rgba(249,115,22,0.44)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Понятно, перейти к Payme
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
