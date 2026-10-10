// frontend/src/components/ProviderCompleteness.jsx

import React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle } from "lucide-react";
import { getProviderTrust } from "../utils/providerTrust";

export default function ProviderCompleteness({ profile = {}, stats = {}, trust, onFix }) {
  const { t } = useTranslation();
  const model = trust || getProviderTrust(profile, stats);
  const items = model.checks;
  const percent = model.score;
  const missing = items.filter((item) => !item.ok);

  const level = percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";
  const levelText =
    level === "high"
      ? t("profile.trust.high", "Высокое доверие")
      : level === "mid"
      ? t("profile.trust.mid", "Хорошая база")
      : t("profile.trust.low", "Нужно усилить");

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-orange-500">
            Travella trust
          </div>
          <h2 className="mt-2 text-xl font-black tracking-[-0.03em] text-slate-950">
            {t("profile.completeness.title", "Профиль доверия")}
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
            Чем выше доверие, тем увереннее клиент открывает контакты и отправляет запрос.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl font-black tracking-[-0.05em] text-slate-950">{percent}</div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">из 100</div>
        </div>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all"
          style={{ width: `${percent}%` }}
          aria-label={t("profile.completeness.progress", "{{percent}}% заполнено", { percent })}
        />
      </div>

      <div className="mt-3 inline-flex rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">
        {levelText}
      </div>

      {missing.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
          Осталось усилить: {missing.slice(0, 3).map((x) => x.label).join(", ")}
          {missing.length > 3 ? ` и ещё ${missing.length - 3}` : ""}.
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {it.ok ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300" />}
              <span className="truncate text-sm font-bold text-slate-700">
                {it.label}
              </span>
            </div>
            {!it.ok ? (
              <button
                type="button"
                onClick={() => onFix?.(it.fixKey || it.key)}
                className="shrink-0 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-black text-orange-700 transition hover:bg-orange-50"
              >
                {t("profile.completeness.fill", "Заполнить")}
              </button>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
                +{it.weight}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
