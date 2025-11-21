// frontend/src/pages/landing/B2B.jsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function B2B() {
  const { t } = useTranslation();

  const benefits = t("landing.b2b.benefits.items", { returnObjects: true });
  const steps = t("landing.b2b.steps.items", { returnObjects: true });
  const formats = t("landing.b2b.formats.items", { returnObjects: true });
  const faq = t("landing.b2b.faq.items", { returnObjects: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-sm">
        <div className="grid gap-8 md:grid-cols-2">

          <div className="p-6 sm:p-10 md:p-12">
            <span className="inline-flex items-center rounded-full bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-700 ring-1 ring-yellow-100">
              {t("landing.b2b.badge")}
            </span>

            <h1 className="mt-4 text-3xl md:text-5xl font-bold leading-tight">
              {t("landing.b2b.h1")}
            </h1>

            <p className="mt-4 text-lg text-gray-700">
              {t("landing.b2b.sub")}
            </p>

            <div className="mt-6">
              <Link
                to="/india/contacts"
                className="rounded-full bg-black px-7 py-3 text-white text-sm font-semibold hover:bg-black/90 transition"
              >
                {t("landing.b2b.cta")}
              </Link>
            </div>
          </div>

          <div className="relative min-h-[280px] md:min-h-[420px]">
            <img
              src="https://images.unsplash.com/photo-1553877522-43269d4ea984?q=80&w=1400&auto=format&fit=crop"
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              alt=""
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/30 via-black/5 to-transparent" />
          </div>

        </div>
      </section>

      {/* BENEFITS */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.b2b.benefits.title")}
        </h2>
        <p className="mt-2 text-gray-600">{t("landing.b2b.benefits.sub")}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((b, idx) => (
            <div key={idx} className="rounded-2xl bg-white p-5 ring-1 ring-black/5 shadow-sm">
              <div className="text-lg font-semibold">{b.title}</div>
              <div className="mt-1 text-sm text-gray-600">{b.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FORMATS */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.b2b.formats.title")}
        </h2>
        <p className="mt-2 text-gray-600">{t("landing.b2b.formats.sub")}</p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {formats.map((f, idx) => (
            <div
              key={idx}
              className="rounded-3xl bg-white p-6 ring-1 ring-black/5 shadow-sm flex flex-col"
            >
              <div className="text-lg font-semibold">{f.title}</div>
              <div className="mt-2 text-sm text-gray-600 flex-1">{f.text}</div>
              <div className="mt-4 text-xs text-gray-500">{f.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* STEPS */}
      <section className="mt-14 rounded-3xl bg-black text-white p-7 sm:p-10">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.b2b.steps.title")}
        </h2>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {steps.map((s, idx) => (
            <div key={idx} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm text-yellow-200 font-bold">
                {t("landing.b2b.steps.step", { num: idx + 1 })}
              </div>
              <div className="mt-1 font-semibold">{s.title}</div>
              <div className="mt-1 text-sm text-gray-200">{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">{t("landing.b2b.faq.title")}</h2>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {faq.map((f, idx) => (
            <details key={idx} className="group rounded-2xl bg-white p-5 ring-1 ring-black/5 shadow-sm">
              <summary className="cursor-pointer list-none font-semibold flex items-center justify-between">
                <span>{f.q}</span>
                <span className="ml-3 text-gray-400 group-open:rotate-45 transition">+</span>
              </summary>
              <div className="mt-2 text-sm text-gray-600">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mt-14 mb-6">
        <div className="rounded-3xl bg-yellow-50 p-7 sm:p-10 ring-1 ring-yellow-100 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <h3 className="text-xl md:text-2xl font-semibold">
              {t("landing.b2b.final.title")}
            </h3>
            <p className="mt-1 text-gray-700">{t("landing.b2b.final.sub")}</p>
          </div>

          <Link
            to="/india/contacts"
            className="rounded-full bg-black px-7 py-3 text-white text-sm font-semibold hover:bg-black/90 transition text-center"
          >
            {t("landing.b2b.final.btn")}
          </Link>
        </div>
      </section>

    </main>
  );
}
