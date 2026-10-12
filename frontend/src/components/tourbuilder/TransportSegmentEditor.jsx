import React, { useEffect, useMemo, useRef, useState } from "react";
import { Car, Check, Loader2, Plane, Search, Train, Trash2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function authHeaders() {
  const token = localStorage.getItem("token") || localStorage.getItem("providerToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path, params = {}) {
  const url = new URL(path, API_BASE || window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value != null) url.searchParams.set(key, value);
  });
  const response = await fetch(url, { credentials: "include", headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

const copy = {
  ru: {
    car: "Автомобиль", train: "Поезд", air: "Самолёт", from: "Откуда", to: "Куда",
    price: "Цена", perPax: "за пассажира", carrier: "Перевозчик", number: "Номер",
    departure: "Отправление", arrival: "Прибытие", class: "Класс", search: "Найти рейсы",
    searching: "Ищем", choose: "Выбрать", selected: "Выбрано", noOffers: "Предложений не найдено",
    manualAir: "Можно заполнить рейс вручную", iata: "Код IATA", remove: "Удалить сегмент",
  },
  en: {
    car: "Car", train: "Train", air: "Flight", from: "From", to: "To", price: "Price",
    perPax: "per passenger", carrier: "Carrier", number: "Number", departure: "Departure",
    arrival: "Arrival", class: "Class", search: "Search flights", searching: "Searching",
    choose: "Select", selected: "Selected", noOffers: "No offers found", manualAir: "You can enter the flight manually",
    iata: "IATA code", remove: "Remove segment",
  },
  uz: {
    car: "Avtomobil", train: "Poyezd", air: "Samolyot", from: "Qayerdan", to: "Qayerga",
    price: "Narx", perPax: "har bir yo'lovchi uchun", carrier: "Tashuvchi", number: "Raqam",
    departure: "Jo'nash", arrival: "Yetib kelish", class: "Klass", search: "Reyslarni topish",
    searching: "Qidirilmoqda", choose: "Tanlash", selected: "Tanlandi", noOffers: "Taklif topilmadi",
    manualAir: "Reysni qo'lda kiritish mumkin", iata: "IATA kodi", remove: "Segmentni o'chirish",
  },
};

function AirportInput({ label, value, onChange, lang }) {
  const [query, setQuery] = useState(value || "");
  const [items, setItems] = useState([]);
  const timer = useRef(null);

  useEffect(() => setQuery(value || ""), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (next) => {
    setQuery(next);
    const code = next.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) onChange(code);
    clearTimeout(timer.current);
    if (next.trim().length < 2) return setItems([]);
    timer.current = setTimeout(async () => {
      try {
        const data = await getJson("/api/airports/search", { q: next, lang, limit: 7 });
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        setItems([]);
      }
    }, 250);
  };

  return (
    <label className="relative block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        value={query}
        placeholder={copy[lang].iata}
        onChange={(event) => search(event.target.value)}
        onBlur={() => setTimeout(() => setItems([]), 150)}
      />
      {items.length > 0 ? (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {items.flatMap((item) => (item.iata_codes || []).slice(0, 2).map((iata) => (
            <button
              type="button"
              key={`${item.geoname_id}-${iata}`}
              className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-orange-50"
              onMouseDown={() => {
                const name = item[`name_${lang}`] || item.name_en || "";
                setQuery(`${iata} · ${name}`);
                onChange(iata);
                setItems([]);
              }}
            >
              <span className="truncate">{item[`name_${lang}`] || item.name_en}</span>
              <strong className="ml-2 text-slate-900">{iata}</strong>
            </button>
          )))}
        </div>
      ) : null}
    </label>
  );
}

function formatDateTime(value, lang) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "uz" ? "uz-UZ" : lang === "en" ? "en-GB" : "ru-RU", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function TransportSegmentEditor({ value, date, adults, children, lang = "ru", onChange, onRemove }) {
  const locale = copy[lang] ? lang : "ru";
  const text = copy[locale];
  const type = value.type || "car";
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const patch = (next) => onChange({ ...value, ...next });
  const routeReady = /^[A-Z]{3}$/.test(value.from || "") && /^[A-Z]{3}$/.test(value.to || "");

  const selectedId = value.raw_offer_id || "";
  const selectedSummary = useMemo(() => {
    if (type !== "air" || !value.segments?.length) return "";
    return value.segments.map((segment) => `${segment.carrier_code}${segment.number} ${segment.from}–${segment.to}`).join(" · ");
  }, [type, value.segments]);

  const searchFlights = async () => {
    setLoading(true);
    setError("");
    setOffers([]);
    try {
      const data = await getJson("/api/travel-search/flights", {
        origin: value.from,
        destination: value.to,
        departure_date: value.departure_date || date,
        adults,
        children,
        currency: value.currency === "UZS" ? "USD" : value.currency || "USD",
        lang: locale,
        max: 8,
      });
      setOffers(data.offers || []);
      if (!data.offers?.length) setError(text.noOffers);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const selectOffer = (offer) => {
    const first = offer.segments?.[0] || {};
    const last = offer.segments?.[offer.segments.length - 1] || {};
    patch({
      provider: offer.provider,
      raw_offer_id: offer.raw_offer_id,
      from: first.from || value.from,
      to: last.to || value.to,
      departure_at: first.departure_at,
      arrival_at: last.arrival_at,
      carrier: first.carrier_name || first.carrier_code,
      number: first.number,
      cabin_class: offer.cabin,
      baggage: offer.baggage,
      price: offer.price,
      currency: offer.currency,
      perPax: false,
      offer_expires_at: offer.offer_expires_at,
      segments: offer.segments,
    });
  };

  const TypeIcon = type === "air" ? Plane : type === "train" ? Train : Car;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-white text-slate-700 ring-1 ring-slate-200"><TypeIcon size={17} /></span>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold" value={type} onChange={(event) => patch({ type: event.target.value, provider: event.target.value === "air" ? value.provider : "manual", raw_offer_id: "", segments: [] })}>
            <option value="car">{text.car}</option>
            <option value="train">{text.train}</option>
            <option value="air">{text.air}</option>
          </select>
        </div>
        <button type="button" title={text.remove} aria-label={text.remove} className="grid h-9 w-9 place-items-center rounded-md text-rose-600 hover:bg-rose-50" onClick={onRemove}><Trash2 size={17} /></button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {type === "air" ? (
          <>
            <AirportInput label={text.from} value={value.from} lang={locale} onChange={(from) => patch({ from, raw_offer_id: "", segments: [] })} />
            <AirportInput label={text.to} value={value.to} lang={locale} onChange={(to) => patch({ to, raw_offer_id: "", segments: [] })} />
          </>
        ) : (
          <>
            <Field label={text.from} value={value.from} onChange={(from) => patch({ from })} />
            <Field label={text.to} value={value.to} onChange={(to) => patch({ to })} />
          </>
        )}
        {type !== "car" ? <Field label={text.carrier} value={value.carrier} onChange={(carrier) => patch({ carrier })} /> : null}
        {type !== "car" ? <Field label={text.number} value={value.number} onChange={(number) => patch({ number })} /> : null}
        {type !== "car" ? <Field type="datetime-local" label={text.departure} value={value.departure_at || ""} onChange={(departure_at) => patch({ departure_at })} /> : null}
        {type !== "car" ? <Field type="datetime-local" label={text.arrival} value={value.arrival_at || ""} onChange={(arrival_at) => patch({ arrival_at })} /> : null}
        {type !== "car" ? <Field label={text.class} value={value.cabin_class} onChange={(cabin_class) => patch({ cabin_class })} /> : null}
        <Field type="number" label={text.price} value={value.price ?? 0} onChange={(price) => patch({ price: Number(price) || 0, raw_offer_id: type === "air" ? "" : value.raw_offer_id })} />
        <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Currency</span><select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={value.currency || "UZS"} onChange={(event) => patch({ currency: event.target.value })}><option>UZS</option><option>USD</option></select></label>
        <label className="flex items-end pb-2"><span className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(value.perPax)} onChange={(event) => patch({ perPax: event.target.checked })} />{text.perPax}</span></label>
      </div>

      {type === "air" ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!routeReady || loading} onClick={searchFlights} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}{loading ? text.searching : text.search}
            </button>
            <span className="text-xs text-slate-500">{text.manualAir}</span>
            {selectedSummary ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"><Check size={13} />{selectedSummary}</span> : null}
          </div>
          {error ? <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div> : null}
          {offers.length ? <div className="mt-3 grid gap-2 lg:grid-cols-2">{offers.map((offer) => {
            const first = offer.segments?.[0] || {};
            const last = offer.segments?.[offer.segments.length - 1] || {};
            const active = selectedId === offer.raw_offer_id;
            return <button key={offer.raw_offer_id} type="button" onClick={() => selectOffer(offer)} className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:border-orange-300"}`}>
              <span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{first.carrier_name || first.carrier_code} {first.number}</strong><span className="mt-1 block text-xs text-slate-500">{formatDateTime(first.departure_at, locale)} → {formatDateTime(last.arrival_at, locale)} · {offer.segments.length - 1} stops · {offer.baggage || "—"}</span></span>
              <span className="shrink-0 text-right"><strong className="block text-sm">{offer.price.toLocaleString()} {offer.currency}</strong><span className="text-xs text-slate-500">{active ? text.selected : text.choose}</span></span>
            </button>;
          })}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value = "", onChange, type = "text" }) {
  return <label className="block min-w-0"><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span><input type={type} min={type === "number" ? 0 : undefined} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>;
}
