// frontend/src/components/IndiaCurator.jsx
import React from "react";
import { useTranslation } from "react-i18next";

export default function IndiaCurator({ photo, onOpenLead }) {
  const { t } = useTranslation();

  return (
    <section
      id="curator"
      className="mt-16 rounded-3xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden"
    >
      {/* Мобильный hero: полноширинная фотка + оверлей */}
      <div className="block md:hidden relative">
        <img
          src={photo}
          alt={t("landing.inside.curator.photo_alt")}
          className="h-[320px] w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 text-white">
          <h3 className="text-xl font-semibold">
            {t("landing.inside.curator.title")}
          </h3>
          <div className="mt-1 h-[2px] w-14 bg-[#DAA520] rounded" />
          <p className="mt-2 text-sm opacity-90">
            {t("landing.inside.curator.subtitle")}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-0">
        {/* Фото — на десктопе слева */}
        <div className="hidden md:block">
          <img
            src={photo}
            alt={t("landing.inside.curator.photo_alt")}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>

        {/* Текст */}
        <div className="p-6 sm:p-10">
          {/* Заголовок + золотая линия (п.2) */}
          <div className="hidden md:block">
            <h3 className="text-2xl font-semibold">
              {t("landing.inside.curator.title")}
            </h3>
            <div className="mt-1 h-[2px] w-14 bg-[#DAA520] rounded" />
            <p className="mt-3 text-sm text-gray-600">
              {t("landing.inside.curator.subtitle")}
            </p>
          </div>

          {/* Описание */}
          <div className="mt-4 space-y-3 text-[15px] leading-6 text-gray-800">
            <p>{t("landing.inside.curator.p1")}</p>
            <p>{t("landing.inside.curator.p2")}</p>

            <ul className="mt-2 grid gap-2 text-gray-800 sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <span className="mt-1 size-2 rounded-full bg-emerald-500" />
                <span>{t("landing.inside.curator.bullets.one")}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 size-2 rounded-full bg-amber-500" />
                <span>{t("landing.inside.curator.bullets.two")}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 size-2 rounded-full bg-sky-500" />
                <span>{t("landing.inside.curator.bullets.three")}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 size-2 rounded-full bg-fuchsia-500" />
                <span>{t("landing.inside.curator.bullets.four")}</span>
              </li>
            </ul>
          </div>

          {/* Бейдж под дисклеймером (п.1) */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-500">
              {t("landing.inside.curator.disclaimer")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs ring-1 ring-emerald-200">
              🌿 {t("landing.inside.curated_badge")}
            </span>
          </div>

          {/* CTA: «Получить программу» + «Задать вопрос» (п.3) */}
          <div className="mt-6 flex flex-col sm:flex-row items-start gap-3 relative z-10">
            <button
              type="button"
              onClick={() => onOpenLead?.("program")}
              className="inline-flex items-center justify-center rounded-xl bg-[#FF8A00] px-5 py-3 text-white font-medium shadow hover:brightness-95 active:brightness-90"
            >
              {t("landing.inside.cta_get_program")}
            </button>

            <button
              type="button"
              onClick={() => onOpenLead?.("question")}
              className="inline-flex items-center justify-center rounded-xl px-5 py-3 text-[#FF8A00] font-medium ring-1 ring-[#FF8A00]/30 hover:bg-[#FF8A00]/5"
            >
              {t("landing.inside.cta_ask")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
