// frontend/src/pages/landing/IndiaInside.jsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

export default function IndiaInside({ onLeadOpen }) {
  const { t } = useTranslation();
  const [showTrailer, setShowTrailer] = useState(false);

  // карточки «глав» теперь читают заголовок/описание из i18n
  const steps = [
    {
      key: "royal",
      order: "I",
      title: t("landing.inside.chapters.royal.title"),
      tag: "India Inside",
      price: "from $890", // при необходимости тоже унесите в i18n
      duration: "8–9 days",
      blurb: t("landing.inside.chapters.royal.desc"),
      image:
        "https://images.unsplash.com/photo-1603262110263-fb0112e7cc33?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "silence",
      order: "II",
      title: t("landing.inside.chapters.silence.title"),
      tag: "India Inside",
      price: "from $620",
      duration: "7–8 days",
      blurb: t("landing.inside.chapters.silence.desc"),
      image:
        "https://images.unsplash.com/photo-1518684079-3c830dcef090?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "modern",
      order: "III",
      title: t("landing.inside.chapters.modern.title"),
      tag: "India Inside",
      price: "from $740",
      duration: "7 days",
      blurb: t("landing.inside.chapters.modern.desc"),
      image:
        "https://images.unsplash.com/photo-1508057198894-247b23fe5ade?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "kerala",
      order: "IV",
      title: t("landing.inside.chapters.kerala.title"),
      tag: "India Inside",
      price: "from $690",
      duration: "8–9 days",
      blurb: t("landing.inside.chapters.kerala.desc"),
      image:
        "https://images.unsplash.com/photo-1548013146-72479768bada?q=80&w=1600&auto=format&fit=crop",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero */}
      <section className="rounded-2xl bg-black text-white p-10 md:p-14 mb-10">
        <div className="text-xs tracking-widest opacity-70 mb-3">
          {t("landing.inside.badge")}
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold mb-4">
          {t("landing.inside.title")}
        </h1>
        <p className="text-lg md:text-xl opacity-80 max-w-3xl mb-8">
          {t("landing.inside.sub")}
        </p>
        <div className="flex gap-3">
          <button
            className="px-5 py-3 rounded-xl bg-white text-black font-medium"
            onClick={() => setShowTrailer(true)}
          >
            {t("landing.inside.cta_trailer")}
          </button>
          <button
            className="px-5 py-3 rounded-xl bg-orange-500 text-white font-medium"
            onClick={() => (onLeadOpen ? onLeadOpen() : null)}
          >
            {t("landing.inside.cta_join")}
          </button>
        </div>
      </section>

      {/* Steps */}
      <section className="mb-14">
        <h2 className="text-2xl md:text-3xl font-bold">
          {t("landing.inside.steps_title")}
        </h2>
        <p className="text-gray-500 mt-1 mb-6">
          {t("landing.inside.steps_sub")}
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s) => (
            <article
              key={s.key}
              className="rounded-2xl overflow-hidden border bg-white"
            >
              <div
                className="aspect-[4/3] bg-cover bg-center"
                style={{ backgroundImage: `url(${s.image})` }}
                aria-label={s.title}
              />
              <div className="p-4">
                <div className="text-xs text-gray-500 mb-1">{s.tag}</div>
                <h3 className="font-semibold text-lg mb-1">{s.title}</h3>
                <p className="text-sm text-gray-600 mb-3">{s.blurb}</p>
                <div className="text-xs text-gray-500 mb-3">
                  {s.duration} • {s.price}
                </div>
                <button
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 rounded-xl"
                  onClick={() => (onLeadOpen ? onLeadOpen() : null)}
                >
                  {t("landing.inside.view")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* GURU */}
      <section className="rounded-2xl bg-gradient-to-b from-neutral-900 to-neutral-800 text-white p-8 md:p-12">
        <div className="max-w-3xl">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-3">
            {t("landing.inside.guru.title")}
          </h2>
          <p className="opacity-80 mb-6">{t("landing.inside.guru.lead")}</p>
          <ul className="space-y-2 mb-8 list-disc list-inside opacity-90">
            <li>{t("landing.inside.guru.bullets.one")}</li>
            <li>{t("landing.inside.guru.bullets.two")}</li>
            <li>{t("landing.inside.guru.bullets.three")}</li>
            <li>{t("landing.inside.guru.bullets.four")}</li>
          </ul>
          <div className="flex gap-3">
            <button
              className="px-5 py-3 rounded-xl bg-orange-500 text-white font-medium"
              onClick={() => (onLeadOpen ? onLeadOpen() : null)}
            >
              {t("landing.inside.guru.cta_apply")}
            </button>
            <a href="#chapters" className="px-5 py-3 rounded-xl bg-white text-black font-medium">
              {t("landing.inside.guru.cta_chapters")}
            </a>
          </div>
        </div>
      </section>

      {/* Трейлер — опционально */}
      {showTrailer && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-black rounded-2xl overflow-hidden w-[90vw] max-w-3xl">
            <div className="aspect-video">
              <iframe
                className="w-full h-full"
                src="https://www.youtube.com/embed/dQw4w9WgXcQ"
                title="Trailer"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <button
              className="w-full py-3 bg-neutral-900 text-white"
              onClick={() => setShowTrailer(false)}
            >
              {t("actions.ok")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
