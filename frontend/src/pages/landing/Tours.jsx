// frontend/src/pages/landing/Tours.jsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

function pluralNights(t, n) {
  if (n == null) return "";
  // i18n-плюрали через ключи выше
  if (n % 10 === 1 && n % 100 !== 11) return t("landing.tours.nights", { count: n });
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return t("landing.tours.nights_plural_2", { count: n });
  return t("landing.tours.nights_plural_5", { count: n });
}

export default function Tours() {
  const { t } = useTranslation();
  const offers = t("landing.tours.offers", { returnObjects: true }) || [];

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.tours.h1")}</h1>
      <p className="mt-3 text-lg text-gray-700">{t("landing.tours.sub")}</p>

      <div className="grid md:grid-cols-3 gap-6 mt-8">
        {offers.map((o) => (
          <article
            key={o.id}
            className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 hover:ring-[#FF5722]/30 transition"
          >
            {o.image && (
              <Link to={o.slug || "#"} className="block aspect-[16/9] overflow-hidden">
                <img
                  src={o.image}
                  alt={o.title || o.city}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  loading="lazy"
                />
              </Link>
            )}

            <div className="p-5">
              {o.tag && (
                <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-[#FF5722]">
                  {o.tag}
                </span>
              )}
              <h3 className="mt-2 text-xl font-semibold tracking-tight">
                {o.title || o.city}
              </h3>

              <div className="mt-1 text-[#FF5722] font-bold">
                {t("landing.tours.from", { price: `${o.priceFrom} ${o.currency || "USD"}` })}
              </div>

              <p className="mt-2 text-sm text-gray-600">
                {o.desc}
                {o.nights ? ` · ${pluralNights(t, Number(o.nights))}` : ""}
              </p>

              <div className="mt-4 flex items-center justify-between">
                <Link
                  to={o.slug || "#"}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#FF5722] to-[#FF7A45] px-4 py-2 text-white shadow hover:brightness-95 active:scale-[0.99] transition"
                >
                  {t("landing.tours.cta")}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </Link>

                {o.priceFrom && (
                  <div className="text-sm text-gray-500">
                    {o.currency || "USD"}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
