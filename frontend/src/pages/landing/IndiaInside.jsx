import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function IndiaInside() {
  const { t } = useTranslation();

  // настроим, какие изображения использовать (ты писал: Hero Desktop: 5, Hero Mobile: 2)
  // просто положи файлы в /public/india/inside/ с этими именами
  const heroDesktop = "/india/inside/hero-desktop-5.jpg";
  const heroMobile  = "/india/inside/hero-mobile-2.jpg";

  const steps = [
    {
      key: "gt",
      title: t("landing.inside.steps.gt.title"),
      desc: t("landing.inside.steps.gt.desc"),
      img: "/india/tours/golden-triangle.jpg",
      to: "/india/tours#golden-triangle",
      badge: t("landing.inside.levels.start"),
    },
    {
      key: "raj",
      title: t("landing.inside.steps.raj.title"),
      desc: t("landing.inside.steps.raj.desc"),
      img: "/india/tours/rajasthan.jpg", // РАДЖАСТАН (без «х») — проверь картинку и подпись в ru.json
      to: "/india/tours#rajasthan",
      badge: t("landing.inside.levels.levelup"),
    },
    {
      key: "mmg",
      title: t("landing.inside.steps.mmg.title"),
      desc: t("landing.inside.steps.mmg.desc"),
      img: "/india/tours/mumbai-goa.jpg",
      to: "/india/tours#mumbai-goa",
      badge: t("landing.inside.levels.vibes"),
    },
    {
      key: "ker",
      title: t("landing.inside.steps.ker.title"),
      desc: t("landing.inside.steps.ker.desc"),
      img: "/india/tours/kerala.jpg",
      to: "/india/tours#kerala",
      badge: t("landing.inside.levels.mastery"),
    },
  ];

  return (
    <main className="w-full">
      {/* HERO */}
      <section className="relative h-[56vw] max-h-[640px] min-h-[420px] overflow-hidden">
        <picture>
          {/* mobile first */}
          <source media="(max-width: 767px)" srcSet={heroMobile} />
          <img
            src={heroDesktop}
            alt="India Inside — Luxury journey"
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
          />
        </picture>

        {/* luxury-вуаль + золотой градиент */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-black/35 to-transparent" />
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: "radial-gradient(60% 60% at 80% 10%, rgba(197,157,95,0.25) 0%, rgba(197,157,95,0.00) 70%)" }} />

        <div className="relative z-10 h-full flex items-end">
          <div className="max-w-7xl mx-auto w-full px-4 pb-8 md:pb-12">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold"
                 style={{ backgroundColor: "rgba(197,157,95,0.15)", color: "#C59D5F", border: "1px solid rgba(197,157,95,0.35)" }}>
              Travella · India Inside
            </div>

            <h1 className="mt-3 text-3xl md:text-5xl font-bold text-white leading-tight">
              {t("landing.inside.title")}
            </h1>
            <p className="mt-2 text-white/85 max-w-2xl">
              {t("landing.inside.sub")}
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/india/inside#trailer"
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white ring-1 ring-white/30 backdrop-blur transition flex items-center gap-2"
              >
                <span>▶</span> {t("landing.inside.cta_trailer")}
              </Link>

              <button
                onClick={() => window.dispatchEvent(new CustomEvent("lead:open", { detail: { context: "india_inside" } }))}
                className="px-5 py-2.5 rounded-xl text-white shadow hover:brightness-95 active:scale-[0.99] transition"
                style={{ backgroundImage: "linear-gradient(90deg,#C59D5F,#E8C78F)" }}
              >
                {t("landing.inside.cta_join")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ШАГИ / 4 тура */}
      <section className="max-w-7xl mx-auto px-4 py-10">
        <h2 className="text-2xl md:text-3xl font-bold">{t("landing.inside.steps_title")}</h2>
        <p className="mt-2 text-gray-600">{t("landing.inside.steps_sub")}</p>

        <div className="grid md:grid-cols-4 gap-5 mt-6">
          {steps.map(s => (
            <article
              key={s.key}
              className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 hover:ring-[#C59D5F]/40 transition"
            >
              <Link to={s.to} className="block aspect-[5/4] overflow-hidden bg-gray-100">
                <img
                  src={s.img}
                  alt={s.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  loading="lazy"
                />
              </Link>

              <div className="p-4">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: "rgba(197,157,95,0.12)", color: "#8A6E3A" }}>
                  {s.badge}
                </span>

                <h3 className="mt-2 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{s.desc}</p>

                <div className="mt-3">
                  <Link
                    to={s.to}
                    className="inline-flex items-center gap-2 rounded-xl text-white px-3 py-2 shadow hover:brightness-95 transition"
                    style={{ backgroundImage: "linear-gradient(90deg,#C59D5F,#E8C78F)" }}
                  >
                    {t("landing.inside.view")}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Trailer */}
      <section id="trailer" className="max-w-7xl mx-auto px-4 pb-14">
        <div className="rounded-2xl overflow-hidden ring-1 ring-gray-200 bg-white">
          <div className="aspect-video relative bg-black">
            {/* заглушка до реального видео */}
            <button
              onClick={() => window.alert(t("landing.inside.trailer_coming"))}
              className="absolute inset-0 m-auto h-16 w-16 rounded-full flex items-center justify-center text-white hover:scale-105 transition"
              style={{ backgroundImage: "linear-gradient(90deg,#C59D5F,#E8C78F)" }}
              aria-label="Play trailer"
              title="Play trailer"
            >
              ▶
            </button>
          </div>
          <div className="p-5 flex items-center justify-between">
            <div>
              <div className="text-sm uppercase tracking-wide text-[#8A6E3A] font-semibold">
                India Inside
              </div>
              <div className="text-lg font-medium">{t("landing.inside.trailer_title")}</div>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("lead:open", { detail: { context: "india_inside_trailer" } }))}
              className="px-4 py-2 rounded-xl text-white shadow hover:brightness-95 transition"
              style={{ backgroundImage: "linear-gradient(90deg,#C59D5F,#E8C78F)" }}
            >
              {t("landing.inside.cta_join")}
            </button>
          </div>
        </div>
      </section>

      {/* CTA footer */}
      <section className="px-4 pb-16">
        <div className="max-w-5xl mx-auto rounded-2xl p-6 md:p-10 text-center text-white"
             style={{
               background: "linear-gradient(135deg, rgba(0,0,0,0.88), rgba(0,0,0,0.80)), url('/india/inside/pattern.jpg') center/cover"
             }}>
          <h3 className="text-2xl md:text-3xl font-bold">{t("landing.inside.footer_title")}</h3>
          <p className="mt-2 text-white/85">{t("landing.inside.footer_sub")}</p>
          <div className="mt-5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("lead:open", { detail: { context: "india_inside_footer" } }))}
              className="px-6 py-3 rounded-xl text-white shadow hover:brightness-95 transition"
              style={{ backgroundImage: "linear-gradient(90deg,#C59D5F,#E8C78F)" }}
            >
              {t("landing.inside.cta_join")}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
