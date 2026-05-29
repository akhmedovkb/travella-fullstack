// frontend/src/components/ProviderCompleteness.jsx

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

const hasAny = (...vals) =>
  vals.some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

export default function ProviderCompleteness({ profile = {}, onFix }) {
  const { t } = useTranslation();

  const languagesOk = hasAny(profile.languages, profile.langs, profile.languageSkills);

  const carFleetOk = Array.isArray(profile?.car_fleet)
    ? profile.car_fleet.some(
        (c) =>
          c &&
          c.is_active !== false &&
          (c.model || c.seats || (Array.isArray(c.images) && c.images.length > 0))
      )
    : false;

  const transportOk =
    hasAny(
      profile.transport,
      profile.hasTransport,
      profile.transportAvailable,
      profile.transport_name,
      profile.cars,
      profile.fleet,
      profile.vehicleFleet
    ) || carFleetOk;

  const certificateOk = hasAny(
    profile.certificate,
    profile.certificateUrl,
    profile.certificate_url,
    profile.certUrl
  );

  const logoOk = hasAny(
    profile.logo,
    profile.logoUrl,
    profile.logo_url,
    profile.avatar,
    profile.photo,
    profile.photoUrl,
    profile.image,
    profile.imageUrl,
    profile.image_url
  );

  const tgOk = hasAny(
    profile.telegram_username,
    profile.telegramUsername,
    profile.telegram_user,
    profile.telegram_connected,
    profile.telegramLinked,
    profile.telegram_chat_id,
    profile.tg_chat_id,
    profile.telegramChatId
  );

  const providerType = String(profile?.type || "").toLowerCase();
  const isAgent = providerType.includes("agent") || providerType.includes("турагент");
  const isGuide = providerType.includes("guide") || providerType.includes("гид");
  const isTransportProvider = providerType.includes("transport") || providerType.includes("транспорт");

  const items = useMemo(() => {
    const arr = [];

    if (!isAgent) {
      arr.push({
        key: "languages",
        label: t("profile.completeness.languages", "Владение языками"),
        ok: languagesOk,
        required: true,
      });
    }

    if (isTransportProvider || isGuide) {
      arr.push({
        key: "transport",
        label: t("profile.completeness.transport", "Транспорт в наличии"),
        ok: transportOk,
        required: isTransportProvider,
      });
    }

    arr.push(
      {
        key: "certificate",
        label: t("profile.completeness.certificate", "Загрузка сертификата"),
        ok: certificateOk,
        required: true,
      },
      {
        key: "logo",
        label: t("profile.completeness.logo", "Загрузка лого"),
        ok: logoOk,
        required: true,
      },
      {
        key: "telegram",
        label: t("profile.completeness.telegram", "Подключение Telegram"),
        ok: tgOk,
        required: true,
      }
    );

    return arr;
  }, [
    isAgent,
    isGuide,
    isTransportProvider,
    languagesOk,
    transportOk,
    certificateOk,
    logoOk,
    tgOk,
    t,
  ]);

  const totalRequired = items.filter((i) => i.required).length;
  const doneRequired = items.filter((i) => i.required && i.ok).length;
  const percent = Math.round((doneRequired / Math.max(1, totalRequired)) * 100);
  const nextItem = items.find((i) => i.required && !i.ok);

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <div className="bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_55%,#fb923c_160%)] p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/10">
              Trust score
            </div>
            <h2 className="mt-3 text-xl font-black tracking-[-0.03em]">
              {t("profile.completeness.title", "Заполненность профиля")}
            </h2>
            <p className="mt-1 text-sm font-medium text-white/70">
              Чем полнее профиль, тем выше доверие клиента к поставщику.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-3xl font-black leading-none">{percent}%</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/55">
              готово
            </div>
          </div>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-orange-400 transition-all duration-500"
            style={{ width: `${percent}%` }}
            aria-label={t("profile.completeness.progress", "{{percent}}% заполнено", { percent })}
          />
        </div>
      </div>

      <div className="p-5">
        {nextItem ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-black">Следующий шаг: {nextItem.label}</div>
            <div className="mt-1 font-medium text-amber-800/80">
              Заполните этот пункт, чтобы профиль выглядел надёжнее для клиентов.
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-black">Профиль готов к работе</div>
            <div className="mt-1 font-medium text-emerald-800/80">
              Основные элементы доверия заполнены.
            </div>
          </div>
        )}

        <ul className="space-y-2.5">
          {items.map((it) => {
            const reqBadge = it.required ? null : t("profile.completeness.optional", "необязательно");
            return (
              <li
                key={it.key}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={[
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black",
                      it.ok
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-white text-slate-400 ring-1 ring-slate-200",
                    ].join(" ")}
                    aria-hidden
                  >
                    {it.ok ? "✓" : "•"}
                  </span>
                  <div className="min-w-0">
                    <div className={it.ok ? "font-black text-slate-800" : "font-black text-slate-700"}>
                      {it.label}
                    </div>
                    {reqBadge ? <div className="text-xs font-semibold text-slate-400">{reqBadge}</div> : null}
                  </div>
                </div>

                {!it.ok && (
                  <button
                    type="button"
                    onClick={() => onFix?.(it.key)}
                    className="shrink-0 rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-black text-orange-700 transition hover:bg-orange-50"
                  >
                    {t("profile.completeness.fill", "Заполнить")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
