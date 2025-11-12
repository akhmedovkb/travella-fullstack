// frontend/src/pages/landing/IndiaInside.jsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

// Cinematic landing section for the program "India Inside"
// Tailwind-only, drop-in. Все тексты -> i18n: landing.*

export default function IndiaInside({ onLeadOpen }) {
  const { t } = useTranslation();
  const [showTrailer, setShowTrailer] = useState(false);

  // Главный бэйдж/заголовки/кнопки — все из landing.inside.*
  const badge = t("landing.inside.badge");
  const title = t("landing.inside.title");
  const sub = t("landing.inside.sub");
  const ctaTrailer = t("landing.inside.cta_trailer");
  const ctaJoin = t("landing.inside.cta_join");

  // Четыре «главы» — используем landing.inside.chapters.*
  const chapters = [
    {
      key: "royal",
      order: "I",
      title: t("landing.inside.chapters.royal.title"),
      desc: t("landing.inside.chapters.royal.desc"),
      image:
        "https://images.unsplash.com/photo-1578926374373-0d9d211d56d7?q=80&w=1600&auto=format&fit=crop", // Udaipur/Jaipur vibes
    },
    {
      key: "silence",
      order: "II",
      title: t("landing.inside.chapters.silence.title"),
      desc: t("landing.inside.chapters.silence.desc"),
      image:
        "https://images.unsplash.com/photo-1593697820909-3dfeb4b1d0d4?q=80&w=1600&auto=format&fit=crop", // Himalayas
    },
    {
      key: "modern",
      order: "III",
      title: t("landing.inside.chapters.modern.title"),
      desc: t("landing.inside.chapters.modern.desc"),
      image:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop", // Mumbai
    },
    {
      key: "kerala",
      order: "IV",
      title: t("landing.inside.chapters.kerala.title"),
      desc: t("landing.inside.chapters.kerala.desc"),
      image:
        "https://images.unsplash.com/photo-1526318472351-c75fcf070305?q=80&w=1600&auto=format&fit=crop", // Kerala backwaters
    },
  ];

  // Для мини-карточек «примеров поездок» можно взять тексты из landing.tours.*
  // Пример цены — через landing.tours.from {{price}}, длительность через общий ключ days.
  const sampleTrips = [
    {
      id: "golden-triangle",
      tag: t("landing.tours.program.badge"),
      title: t("landing.tours.offers.0.title"),
      desc: t("landing.tours.offers.0.desc"),
      priceFrom: t("landing.tours.from", { price: 590 }),
      duration: `7–8 ${t("days")}`,
      image: "/gti.jpeg",
      href: "/india/tours/golden-triangle",
    },
    {
      id: "rajasthan",
      tag: t("landing.tours.program.badge"),
      title: t("landing.tours.offers.1.title"),
      desc: t("landing.tours.offers.1.desc"),
      priceFrom: t("landing.tours.from", { price: 790 }),
      duration: `8 ${t("days")}`,
      image: "/rj_01.jpg",
      href: "/india/tours/rajasthan",
    },
    {
      id: "mumbai-goa",
      tag: t("landing.tours.program.badge"),
      title: t("landing.tours.offers.2.title"),
      desc: t("landing.tours.offers.2.desc"),
      priceFrom: t("landing.tours.from", { price: 350 }),
      duration: `7 ${t("days")}`,
      image: "/mg.jpg",
      href: "/india/tours/mumbai-goa",
    },
    {
      id: "kerala",
      tag: t("landing.tours.program.badge"),
      title: t("landing.tours.offers.3.title"),
      desc: t("landing.tours.offers.3.desc"),
      priceFrom: t("landing.tours.from", { price: 690 }),
      duration: `9 ${t("days")}`,
      image: "/kerala_01.jpg",
      href: "/india/tours/kerala",
    },
  ];

  return (
    <section className="relative overflow-hidden">
      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
        <div className="text-center space-y-4">
          <span className="inline-block text-xs tracking-[0.28em] uppercase opacity-70">
            {badge}
          </span>
          <h1 className="text-3xl md:text-5xl font-serif">{title}</h1>
          <p className="max-w-3xl mx-auto text-base md:text-lg opacity-80">
            {sub}
          </p>

          <div className="flex gap-3 justify-center mt-6">
            <button
              className="px-5 py-2 rounded-2xl border hover:shadow"
              onClick={() => setShowTrailer(true)}
            >
              {ctaTrailer}
            </button>
            <button
              className="px-5 py-2 rounded-2xl bg-black text-white hover:opacity-90"
              onClick={onLeadOpen}
            >
              {ctaJoin}
            </button>
          </div>
        </div>

        {/* Chapters */}
        <div className="mt-14">
          <div className="text-center mb-6">
            <h2 className="text-xl md:text-2xl font-medium">
              {t("landing.inside.steps_title")}
            </h2>
            <p className="opacity-70">{t("landing.inside.steps_sub")}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {chapters.map((c) => (
              <article
                key={c.key}
                className="group overflow-hidden rounded-2xl border bg-white/60 hover:shadow-md transition"
              >
                <div
                  className="h-40 bg-cover bg-center"
                  style={{ backgroundImage: `url(${c.image})` }}
                  aria-label={c.title}
                />
                <div className="p-4">
                  <div className="text-xs opacity-50 mb-1">{c.order}</div>
                  <h3 className="text-lg font-medium">{c.title}</h3>
                  <p className="text-sm opacity-80 mt-1">{c.desc}</p>
                  <button
                    className="mt-3 text-sm underline underline-offset-4"
                    onClick={onLeadOpen}
                  >
                    {t("landing.inside.view")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Sample trips (optional showcase) */}
        <div className="mt-16">
          <div className="text-center mb-6">
            <h2 className="text-xl md:text-2xl font-medium">
              {t("landing.tours.h1")}
            </h2>
            <p className="opacity-70">{t("landing.tours.sub")}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {sampleTrips.map((s) => (
              <a
                key={s.id}
                href={s.href}
                className="group overflow-hidden rounded-2xl border bg-white/60 hover:shadow-md transition"
              >
                <div
                  className="h-40 bg-cover bg-center"
                  style={{ backgroundImage: `url(${s.image})` }}
                  aria-label={s.title}
                />
                <div className="p-4">
                  <div className="text-[10px] tracking-widest uppercase opacity-60 mb-1">
                    {s.tag}
                  </div>
                  <h3 className="text-lg font-medium">{s.title}</h3>
                  <p className="text-sm opacity-80">{s.desc}</p>
                  <div className="flex items-center gap-3 mt-3 text-sm">
                    <span className="font-medium">{s.priceFrom}</span>
                    <span className="opacity-60">•</span>
                    <span className="opacity-80">{s.duration}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Трейлер-модалка (простейший мок) */}
      {showTrailer && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowTrailer(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-3xl aspect-video"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Вставь сюда <iframe> с YouTube/Vimeo */}
          </div>
        </div>
      )}
    </section>
  );
}
