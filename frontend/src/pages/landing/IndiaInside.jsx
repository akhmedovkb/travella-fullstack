// frontend/src/pages/landing/IndiaInside.jsx
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// Простой модал для трейлера (опционально)
function TrailerModal({ open, onClose, videoId = "dQw4w9WgXcQ" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[999] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-black rounded-2xl overflow-hidden shadow-2xl max-w-3xl w-full">
        <div className="relative pt-[56.25%]">
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title="Trailer"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <div className="p-3 bg-neutral-900 text-right">
          <button
            onClick={onClose}
            className="inline-flex items-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IndiaInside({ onLeadOpen }) {
  const { t } = useTranslation("landing");
  const [showTrailer, setShowTrailer] = useState(false);

  // фиксированный список глав — КАРТИНКИ И ДАННЫЕ НЕ МЕНЯЕМ
  const steps = useMemo(
    () => [
      {
        key: "royal",
        image:
          "https://images.unsplash.com/photo-1578925993061-28e5c6f16de1?q=80&w=1600&auto=format&fit=crop", // Jaipur/royal
        price: "from $890",
        duration: "8–9 days",
      },
      {
        key: "silence",
        image:
          "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=1600&auto=format&fit=crop", // Himalayas
        price: "from $620",
        duration: "7–8 days",
      },
      {
        key: "modern",
        image:
          "https://images.unsplash.com/photo-1483721310020-03333e577078?q=80&w=1600&auto=format&fit=crop", // modern vibes
        price: "from $740",
        duration: "7 days",
      },
      {
        key: "kerala",
        image:
          "https://images.unsplash.com/photo-1564501049412-61c2a3083791?q=80&w=1600&auto=format&fit=crop", // Taj/backwaters vibe
        price: "from $690",
        duration: "8–9 days",
      },
    ],
    []
  );

  const stepsI18n = steps.map((s) => ({
    ...s,
    title: t(`inside.chapters.${s.key}.title`),
    blurb: t(`inside.chapters.${s.key}.desc`),
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* HERO */}
      <section className="rounded-3xl bg-black text-white p-8 md:p-12 mb-10">
        <div className="text-[11px] tracking-widest uppercase opacity-70 mb-2">
          {t("inside.badge")}
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold mb-4">
          {t("inside.title")}
        </h1>
        <p className="text-lg md:text-xl opacity-80 max-w-3xl mb-8">
          {t("inside.sub")}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            className="px-5 py-3 rounded-xl bg-white text-black font-medium"
            onClick={() => setShowTrailer(true)}
          >
            {t("inside.cta_trailer")}
          </button>
          <button
            className="px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium"
            onClick={() => onLeadOpen?.()}
          >
            {t("inside.cta_join")}
          </button>
        </div>
      </section>

      {/* CHAPTERS */}
      <section id="chapters" className="mb-14">
        <h2 className="text-2xl md:text-3xl font-bold">
          {t("inside.steps_title")}
        </h2>
        <p className="text-gray-500 mt-1 mb-6">{t("inside.steps_sub")}</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {stepsI18n.map((s) => (
            <article
              key={s.key}
              className="rounded-2xl overflow-hidden border bg-white hover:shadow-xl transition-shadow"
            >
              <div
                className="aspect-[4/3] bg-cover bg-center"
                style={{ backgroundImage: `url(${s.image})` }}
                aria-label={s.title}
              />
              <div className="p-4">
                <div className="text-xs text-gray-500 mb-1">India Inside</div>
                <h3 className="font-semibold text-lg mb-1">{s.title}</h3>
                <p className="text-sm text-gray-600 mb-3">{s.blurb}</p>
                <div className="text-xs text-gray-500 mb-3">
                  {s.duration} • {s.price}
                </div>
                <button
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 rounded-xl"
                  onClick={() => onLeadOpen?.()}
                >
                  {t("inside.view")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* GURU */}
      <section className="rounded-3xl p-8 md:p-12 bg-gradient-to-b from-neutral-900 to-black text-white mb-12">
        <div className="text-[11px] tracking-widest uppercase opacity-70 mb-2">
          {t("inside.badge")}
        </div>
        <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
          {t("inside.guru.title")}
        </h2>
        <p className="opacity-90 mb-6">{t("inside.guru.lead")}</p>
        <ul className="space-y-2 mb-8 list-disc pl-5">
          <li>{t("inside.guru.bullets.one")}</li>
          <li>{t("inside.guru.bullets.two")}</li>
          <li>{t("inside.guru.bullets.three")}</li>
          <li>{t("inside.guru.bullets.four")}</li>
        </ul>
        <div className="flex gap-3">
          <button
            className="px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium"
            onClick={() => onLeadOpen?.()}
          >
            {t("inside.guru.cta_apply")}
          </button>
          <a
            href="#chapters"
            className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 font-medium"
          >
            {t("inside.guru.cta_chapters")}
          </a>
        </div>
      </section>

      <TrailerModal open={showTrailer} onClose={() => setShowTrailer(false)} />
    </div>
  );
}
