//frontend/src/pages/landing/IndiaInside.jsx

import React, { useState } from "react";
// Cinematic landing section for the program "India Inside"
// Style C: Cinematic bold serif, documentary vibes
// Tailwind only. Drop-in component for your Vite + React app.
// Props: onLeadOpen?(): open your LeadModal; default scroll CTA to #program

export default function IndiaInside({ onLeadOpen }) {
  const [showTrailer, setShowTrailer] = useState(false);

  const steps = [
    {
      key: "seeker",
      order: "I",
      title: "Seeker of India",
      tag: "Golden Triangle",
      price: "from $699",
      duration: "7–8 days",
      blurb:
        "Delhi’s pulse, Agra’s wonder, Jaipur’s colors. The essential first lens to see India as a seeker.",
      image:
        "https://images.unsplash.com/photo-1564501049412-61c2a3083791?q=80&w=1600&auto=format&fit=crop", // Taj Mahal
    },
    {
      key: "explorer",
      order: "II",
      title: "Explorer of India",
      tag: "Rajasthan Adventures",
      price: "from $890",
      duration: "8–10 days",
      blurb:
        "Forts, deserts, palaces. Legends in the golden light of Jaisalmer and the blues of Jodhpur.",
      image:
        "https://images.unsplash.com/photo-1603262110263-fb0112e7cc33?q=80&w=1600&auto=format&fit=crop", // Rajasthan
    },
    {
      key: "soul",
      order: "III",
      title: "Soul of India",
      tag: "Mumbai + Goa",
      price: "from $790",
      duration: "7–9 days",
      blurb:
        "Modern rhythm, cinema spirit, spice markets — and ocean sunsets that slow down time.",
      image:
        "https://images.unsplash.com/photo-1548013146-72479768bada?q=80&w=1600&auto=format&fit=crop", // Goa coast
    },
    {
      key: "guru",
      order: "IV",
      title: "India Guru",
      tag: "Kerala Kaleidoscope",
      price: "from $920",
      duration: "8–10 days",
      blurb:
        "Backwaters, tea hills, ayurveda rituals. Silence, nature, inner alignment — graduation of the journey.",
      image:
        "https://images.unsplash.com/photo-1589308078054-832c1579d6ef?q=80&w=1600&auto=format&fit=crop", // Kerala backwaters
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* Video / Poster backdrop */}
        <div className="absolute inset-0 -z-10">
          <img
            src="https://images.unsplash.com/photo-1531986733711-de47431bbaa4?q=80&w=2400&auto=format&fit=crop"
            alt="India cinematic"
            className="h-full w-full object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black" />
        </div>

        <div className="max-w-7xl mx-auto px-4 pt-28 pb-24 md:pt-40 md:pb-40">
          <div className="max-w-3xl">
            <span className="inline-block uppercase tracking-[0.3em] text-xs md:text-sm text-white/70">
              Travella × India Inside™
            </span>
            <h1 className="mt-4 font-serif text-4xl leading-tight md:text-6xl md:leading-[1.05] font-extrabold">
              Become more than a traveler. <br />
              Become an <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-300 to-orange-500">India Guru</span>.
            </h1>
            <p className="mt-5 md:mt-6 text-base md:text-lg text-white/85 max-w-2xl">
              A transformational 4-journey program to truly understand India — through people, culture & spirit.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowTrailer(true)}
                className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-sm md:text-base backdrop-blur hover:bg-white/15 active:scale-[0.99] transition"
              >
                <span className="i-lucide:play mr-2 h-5 w-5" aria-hidden /> Watch Trailer
              </button>
              <a
                href="#program"
                className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 text-black font-semibold px-6 py-3 text-sm md:text-base shadow-[0_6px_30px_-10px_rgba(255,165,0,0.8)] hover:brightness-95 active:scale-[0.99]"
              >
                Explore the Program
              </a>
              <button
                onClick={() => onLeadOpen?.()}
                className="inline-flex items-center justify-center rounded-2xl bg-white/90 text-black px-5 py-3 text-sm md:text-base font-semibold hover:bg-white active:scale-[0.99]"
              >
                Start from $699
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Program Steps ===== */}
      <section id="program" className="relative border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="font-serif text-3xl md:text-5xl font-extrabold">India Inside™ — 4 Journeys</h2>
              <p className="mt-3 text-white/70 max-w-2xl">
                Complete all four to unlock your **India Guru** badge in Travella. Mix & match, or go in order.
              </p>
            </div>
            <div className="hidden md:block text-right text-sm text-white/60">
              <div>Music: Indian + atmospheric</div>
              <div>Visuals: people • culture • nature • emotions</div>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {steps.map((s) => (
              <article key={s.key} className="group relative overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/10 hover:ring-white/20 transition">
                {/* Image */}
                <div className="h-48 md:h-40 relative overflow-hidden">
                  <img src={s.image} alt={s.tag} className="h-full w-full object-cover group-hover:scale-105 transition duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                  <div className="absolute left-4 top-3 inline-flex items-center rounded-full bg-black/60 px-3 py-1 text-[11px] uppercase tracking-wider text-white/85">
                    {s.order}
                  </div>
                </div>

                {/* Body */}
                <div className="p-5">
                  <div className="text-xs uppercase tracking-wide text-white/60">{s.tag} • {s.duration}</div>
                  <h3 className="mt-1 font-serif text-2xl font-extrabold leading-snug">{s.title}</h3>
                  <p className="mt-2 text-sm text-white/80 min-h-[56px]">{s.blurb}</p>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-amber-300 font-semibold">{s.price}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onLeadOpen?.()}
                        className="inline-flex items-center rounded-xl bg-white text-black text-sm font-semibold px-3 py-2 hover:bg-white/90 active:scale-[0.99]"
                      >
                        Book interest
                      </button>
                      <a
                        href={`#${s.key}-itinerary`}
                        className="text-sm text-white/70 hover:text-white/90"
                      >
                        Itinerary →
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Mini itineraries (anchors) */}
          <div className="mt-16 space-y-16">
            {steps.map((s) => (
              <div key={s.key} id={`${s.key}-itinerary`} className="rounded-3xl ring-1 ring-white/10 bg-white/5 p-6 md:p-10">
                <div className="flex items-start justify-between gap-6 flex-wrap">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-white/60">{s.tag} • {s.duration}</div>
                    <h4 className="mt-1 font-serif text-3xl md:text-4xl font-extrabold">{s.title}</h4>
                  </div>
                  <div className="text-right min-w-[160px]">
                    <div className="text-amber-300 font-semibold">{s.price}</div>
                    <button
                      onClick={() => onLeadOpen?.()}
                      className="mt-2 inline-flex items-center rounded-xl bg-white text-black text-sm font-semibold px-3 py-2 hover:bg-white/90 active:scale-[0.99]"
                    >
                      Ask for details
                    </button>
                  </div>
                </div>
                <ul className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-2 text-white/85 text-sm">
                  <li>• Immersive local walks, street food tastings, chai breaks</li>
                  <li>• Boutique hotels / curated stays</li>
                  <li>• Meaningful human encounters & rituals</li>
                  <li>• Optional sunrise/sunset sets for photography</li>
                  <li>• Private transfers, licensed guides</li>
                  <li>• Add-ons: yoga, ayurveda, heritage shows</li>
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Closing CTA ===== */}
      <section className="relative">
        <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">
          <div className="rounded-3xl overflow-hidden ring-1 ring-white/10">
            <div className="relative p-8 md:p-14 bg-gradient-to-r from-black via-black to-zinc-900">
              <div className="absolute inset-0 -z-10 opacity-40" style={{backgroundImage: "radial-gradient(800px 300px at 20% 120%, rgba(255,200,100,.25), transparent), radial-gradient(700px 300px at 100% -10%, rgba(255,150,50,.18), transparent)"}} />
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div>
                  <h3 className="font-serif text-3xl md:text-4xl font-extrabold">Graduate as an <span className="text-amber-300">India Guru</span></h3>
                  <p className="mt-2 text-white/80 max-w-2xl">Complete all 4 journeys and receive your digital badge in Travella. Unlock special pricing & early access drops.</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowTrailer(true)} className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-sm md:text-base backdrop-blur hover:bg-white/15 active:scale-[0.99]">Watch Trailer</button>
                  <button onClick={() => onLeadOpen?.()} className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 text-black font-semibold px-6 py-3 text-sm md:text-base shadow-[0_6px_30px_-10px_rgba(255,165,0,0.8)] hover:brightness-95 active:scale-[0.99]">Start from $699</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Trailer Modal (stock placeholder) ===== */}
      {showTrailer && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80" onClick={() => setShowTrailer(false)} />
          <div className="relative z-10 w-full max-w-4xl aspect-video rounded-2xl overflow-hidden ring-1 ring-white/20 shadow-2xl">
            <video
              className="h-full w-full object-cover"
              src="https://cdn.coverr.co/videos/coverr-temple-prayer-people-1600?token=eyJhbGciOiJIUzI1NiJ9"
              poster="https://images.unsplash.com/photo-1507149833265-60c372daea22?q=80&w=1600&auto=format&fit=crop"
              controls
              autoPlay
            />
            <button
              onClick={() => setShowTrailer(false)}
              className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm hover:bg-black/80"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

этот мы делали. ингорируем его?
