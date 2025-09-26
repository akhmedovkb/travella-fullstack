// frontend/src/components/ProviderCompleteness.jsx

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

const hasAny = (...vals) =>
  vals.some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

export default function ProviderCompleteness({ profile = {}, onFix }) {
  const { t } = useTranslation();

  const languagesOk = hasAny(
    profile.languages,
    profile.langs,
    profile.languageSkills
  );
  const transportOk = hasAny(
    profile.transport,
    profile.hasTransport,
    profile.transportAvailable,
    profile.transport_name
  );
  const certificateOk = hasAny(
    profile.certificate,
    profile.certificateUrl,
    profile.certificate_url,
    profile.certUrl
  );
  const logoOk = hasAny(
    profile.logo,
    profile.logoUrl,
    profile.avatar,
    profile.photoUrl,
    profile.imageUrl
  );
  const tgOk = hasAny(
    profile.telegram_username,
    profile.telegramUsername,
    profile.telegram_user,
    profile.telegram_connected,
    profile.telegramLinked
  );

  const isTransportProvider = String(profile?.type || "")
    .toLowerCase()
    .includes("transport");

  const items = useMemo(
    () => [
      {
        key: "languages",
        label: t("profile.completeness.languages", "Владение языками"),
        ok: languagesOk,
        required: true,
      },
      {
        key: "transport",
        label: t("profile.completeness.transport", "Транспорт в наличии"),
        ok: transportOk,
        required: isTransportProvider,
      },
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
      },
    ],
    [languagesOk, transportOk, certificateOk, logoOk, tgOk, isTransportProvider, t]
  );

  const totalRequired = items.filter((i) => i.required).length;
  const doneRequired = items.filter((i) => i.required && i.ok).length;
  const percent = Math.round((doneRequired / Math.max(1, totalRequired)) * 100);

  const showHint = percent < 100;

  return (
    <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-base font-semibold">
          {t("profile.completeness.title", "Заполненность профиля")}
        </div>
        <div className="text-sm text-gray-500">{percent}%</div>
      </div>

      {/* progress bar */}
      <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${percent}%` }}
          aria-label={t(
            "profile.completeness.progress",
            "{{percent}}% заполнено",
            { percent }
          )}
        />
      </div>

      {showHint && (
        <div className="mb-3 text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          {t(
            "profile.completeness.hint",
            "Вы не заполнили свой профиль на 100%. Заполните, чтобы ваши услуги были опубликованы в Marketplace и TourBuilder."
          )}
        </div>
      )}

      {/* checklist */}
      <ul className="space-y-2">
        {items.map((it) => {
          const icon = it.ok ? "✅" : "⚪";
          const reqBadge = it.required
            ? ""
            : t("profile.completeness.optional", "(необязательно)");
          return (
            <li key={it.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden>{icon}</span>
                <span className={it.ok ? "text-gray-700" : "text-gray-600"}>
                  {it.label}{" "}
                  {reqBadge && (
                    <span className="text-xs text-gray-400">{reqBadge}</span>
                  )}
                </span>
              </div>
              {!it.ok && (
                <button
                  type="button"
                  onClick={() => onFix?.(it.key)}
                  className="text-sm px-2.5 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  {t("profile.completeness.fill", "Заполнить")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
