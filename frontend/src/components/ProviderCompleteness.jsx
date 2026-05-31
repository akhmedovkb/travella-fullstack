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
    profile.telegramChatId,
    profile.social
  );

  const contactsOk = hasAny(profile.phone) && tgOk;
  const locationOk = hasAny(profile.location);

  const providerType = String(profile?.type || "").toLowerCase();
  const isAgent = providerType.includes("agent");
  const isGuide = providerType.includes("guide");
  const isTransportProvider = providerType.includes("transport");

  const items = useMemo(() => {
    const arr = [];

    arr.push(
      {
        key: "contacts",
        label: t("profile.completeness.contacts", "Контакты для клиентов"),
        ok: contactsOk,
        required: true,
        points: 20,
      },
      {
        key: "logo",
        label: t("profile.completeness.logo", "Логотип / фото"),
        ok: logoOk,
        required: true,
        points: 15,
      },
      {
        key: "certificate",
        label: t("profile.completeness.certificate", "Сертификат"),
        ok: certificateOk,
        required: true,
        points: 20,
      },
      {
        key: "telegram",
        label: t("profile.completeness.telegram", "Telegram подключён"),
        ok: tgOk,
        required: true,
        points: 15,
      },
      {
        key: "fallback",
        label: t("profile.completeness.location", "География работы"),
        ok: locationOk,
        required: true,
        points: 10,
      }
    );

    if (!isAgent) {
      arr.push({
        key: "languages",
        label: t("profile.completeness.languages", "Владение языками"),
        ok: languagesOk,
        required: true,
        points: 10,
      });
    }

    if (isTransportProvider || isGuide) {
      arr.push({
        key: "transport",
        label: t("profile.completeness.transport", "Транспорт в наличии"),
        ok: transportOk,
        required: isTransportProvider,
        points: 10,
      });
    }

    return arr;
  }, [
    certificateOk,
    contactsOk,
    isAgent,
    isGuide,
    isTransportProvider,
    languagesOk,
    locationOk,
    logoOk,
    tgOk,
    transportOk,
    t,
  ]);

  const totalPoints = items.reduce((sum, item) => sum + (item.required ? item.points : 0), 0);
  const donePoints = items.reduce(
    (sum, item) => sum + (item.required && item.ok ? item.points : 0),
    0
  );
  const percent = Math.round((donePoints / Math.max(1, totalPoints)) * 100);
  const missing = items.filter((item) => item.required && !item.ok);

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
              <span aria-hidden>{it.ok ? "✅" : "⚪"}</span>
              <span className="truncate text-sm font-bold text-slate-700">
                {it.label}
                {!it.required ? <span className="ml-1 text-xs font-semibold text-slate-400">optional</span> : null}
              </span>
            </div>
            {!it.ok ? (
              <button
                type="button"
                onClick={() => onFix?.(it.key)}
                className="shrink-0 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-black text-orange-700 transition hover:bg-orange-50"
              >
                {t("profile.completeness.fill", "Заполнить")}
              </button>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
                +{it.points}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
