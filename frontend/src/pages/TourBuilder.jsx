// frontend/src/pages/TourBuilder.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncSelect from "react-select/async";
import CreatableSelect from "react-select/creatable";
import { useTranslation } from "react-i18next";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

// date-fns locales (для DayPicker)
import { ru as dfnsRu, enUS as dfnsEn, uz as dfnsUz } from "date-fns/locale";

// Leaflet marker icons (Vite fix)
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

// -------- CONFIG --------
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const GEONAMES_USER = import.meta.env.VITE_GEONAMES_USERNAME || "";

// -------- UI helpers --------
// ЕДИНЫЙ класс для всех number-инпутов (ровная высота/фокус)
const INPUT_S =
  "h-9 px-3 py-1.5 border rounded focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400";

//для коррекции Переопредетеля по дням

const toYMDLocal = (d) => {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDaysLocal = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

const daysBetweenLocal = (a, b) => {
  if (!a || !b) return 0;
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((b0 - a0) / 86400000) + 1); // включительно
};

//

/* ===== Entry fees helpers (самодостаточно) ===== */
const entryAuthHeaders = () => {
  const tok =
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken");
  return tok ? { Authorization: `Bearer ${tok}` } : {};
};

// При желании отметь праздничные даты "YYYY-MM-DD"
const HOLIDAYS = []; // например: ["2025-01-01","2025-03-08"]

const dkey = (d) => new Date(d).toISOString().slice(0, 10);
const isWeekend = (d) => [0, 6].includes(new Date(d).getDay());
const isHoliday = (d) => HOLIDAYS.includes(dkey(d));
const dayKind = (d) => (isHoliday(d) ? "hd" : isWeekend(d) ? "we" : "wk");

/** /api/entry-fees — публичный справочник для турбилдера */
async function fetchEntryFees({ q = "", city = "", limit = 50 } = {}) {
  const base = API_BASE || window.frontend?.API_BASE || "";
  const u = new URL("/api/entry-fees", base);
  if (q) u.searchParams.set("q", q);
  if (city) u.searchParams.set("city", city);
  u.searchParams.set("limit", String(limit));
  const r = await fetch(u.toString(), {
    credentials: "include",
    headers: { ...entryAuthHeaders() },
  });
  if (!r.ok) throw new Error("entry-fees fetch failed");
  const d = await r.json();
  return Array.isArray(d?.items) ? d.items : [];
}


// -------- utils --------
const getLocalizedName = (g, lang) => {
  const alts = Array.isArray(g.alternateNames) ? g.alternateNames : [];
  const match = alts.find(a => a.lang?.toLowerCase() === lang?.toLowerCase()) || null;
  const base = match?.name || g.name || g.toponymName || "";
  const admin = g.adminName1 ? `, ${g.adminName1}` : "";
  const country = g.countryName ? `, ${g.countryName}` : "";
  return `${base}${admin}${country}`;
};

const DEFAULT_CENTER = [41.3111, 69.2797]; // Tashkent
const DEFAULT_ZOOM = 5;

const ROOMING_TYPES = [
  "SGL", "DBL", "TRPL",
  "Quadruple", "Quintuple",
  "Sextuple", "Septuple", "Octuple", "Nonuple", "Decuple",
];

const EXTRAS_OPTIONS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "masterclass", label: "Masterclass" },
  { value: "gala_dinner", label: "Gala dinner" },
];

const MONUMENTS_PRESET = [
  { value: "registan", label: "Registan" },
  { value: "bukhara_ark", label: "Ark (Bukhara)" },
  { value: "khiva_itchan_kala", label: "Itchan Kala (Khiva)" },
];

const toNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const fmtDate = toYMDLocal;
const addDays = addDaysLocal;
const daysBetween = daysBetweenLocal;

export default function TourBuilder() {
  const { i18n, t } = useTranslation();

  // локаль календаря
  const lang = (i18n.language || "ru").toLowerCase();
  const langBase = lang.startsWith("ru") ? "ru" : lang.startsWith("uz") ? "uz" : "en";
  const dfnsLocale = langBase === "ru" ? dfnsRu : langBase === "uz" ? dfnsUz : dfnsEn;

  // ===== базовые поля =====
  const [arrivalTimeDay1, setArrivalTimeDay1] = useState("");
  const [cities, setCities] = useState([]);
  const [rooming, setRooming] = useState(ROOMING_TYPES.reduce((a, k) => ((a[k] = 0), a), {}));
  const [guideNeeded, setGuideNeeded] = useState(true);
  const [transportNeeded, setTransportNeeded] = useState(true);
  const [monuments, setMonuments] = useState([]);

  // ===== даты тура =====
  const [range, setRange] = useState({ from: undefined, to: undefined });
  const dayCount = daysBetween(range.from, range.to);

  const days = useMemo(() => {
    if (!range.from || !range.to) return [];
    return Array.from({ length: dayCount }, (_, i) => ({
      idx: i + 1,
      date: fmtDate(addDays(range.from, i)),
    }));
  }, [range.from, range.to, dayCount]);


// ===== entry fees =====
const [entryQ, setEntryQ] = useState("");
const [entryOptions, setEntryOptions] = useState([]);   // варианты из API
const [entrySelected, setEntrySelected] = useState([]); // выбранные объекты (react-select опции)
const [residentType, setResidentType] = useState("nrs"); // "res" | "nrs"

  // ===== сегменты =====
  const segments = useMemo(() => {
    const res = [];
    for (let i = 0; i < cities.length - 1; i++) res.push({ idx: i, from: cities[i], to: cities[i + 1] });
    return res;
  }, [cities]);

  const mapCenter = useMemo(() => {
    const first = cities.find(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    return first ? [first.lat, first.lng] : DEFAULT_CENTER;
  }, [cities]);

 // Entry fees

 function entryCell(siteRaw, kind /* wk|we|hd */, pax /* adult|child */) {
  const key = `${kind}_${residentType}_${pax}`; // напр. "we_nrs_adult"
  const v = Number(siteRaw?.[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// ===== PAX =====
  const [adt, setAdt] = useState(2);
  const [chd, setChd] = useState(0);
  const [inf, setInf] = useState(0);

const tourDates = useMemo(() => {
  if (!range.from || !range.to) return [];
  const arr = [];
  const d = new Date(range.from);
  const end = new Date(range.to);
  while (d <= end) {
    arr.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return arr;
}, [range.from, range.to]);


const entryFeesNet = useMemo(() => {
  if (!entrySelected.length || !tourDates.length) return 0;
  const ad = toNum(adt, 0);
  const ch = toNum(chd, 0);
  let sum = 0;
  for (const day of tourDates) {
    const kind = dayKind(day); // wk | we | hd
    for (const opt of entrySelected) {
      const s = opt.raw;
      sum += ad * entryCell(s, kind, "adult");
      sum += ch * entryCell(s, kind, "child");
      // INF считаем бесплатно; добавишь senior при необходимости
    }
  }
  return sum;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [entrySelected, tourDates, residentType, adt, chd]);


  const [segmentTimes, setSegmentTimes] = useState({});
  const [segmentExtras, setSegmentExtras] = useState({});
  const onSegmentTimeChange = (idx, field, value) =>
    setSegmentTimes((p) => ({ ...p, [idx]: { ...(p[idx] || {}), [field]: value } }));
  const onSegmentExtrasChange = (idx, vals) =>
    setSegmentExtras((p) => ({ ...p, [idx]: vals || [] }));

  // ===== ночёвки / отели =====
  const [nights, setNights] = useState([]);
  useEffect(() => {
    if (!range.from || !range.to) { setNights([]); return; }
    const totalNights = Math.max(0, dayCount - 1);
    const next = [];
    for (let i = 0; i < totalNights; i++) {
      const date = fmtDate(addDays(range.from, i));
      const existing = nights.find(n => n.date === date);
      next.push(existing || { date, hotel: "", hotelId: null, net: 0, notes: "" });
    }
    setNights(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, dayCount]);

  const setNightField = (date, key, val) =>
    setNights((prev) => prev.map(n => n.date === date ? { ...n, [key]: key === "net" ? toNum(val, 0) : val } : n));

  // ===== api helpers =====
  const fetchJSON = async (url, params = {}) => {
    const base = API_BASE || window.frontend?.API_BASE || "";
    const u = new URL(url, base);
    Object.entries(params).forEach(([k, v]) => (v != null && v !== "") && u.searchParams.set(k, v));
    const r = await fetch(u.toString(), { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  };

  // отели: автокомплит
  const loadHotelOptions = useCallback(async (input, cb) => {
    const q = (input || "").trim();
    if (!q) return cb([]);
    try {
      const a = await fetchJSON("/api/hotels/search", { name: q, limit: 20 });
      const rows = Array.isArray(a?.items) ? a.items : Array.isArray(a) ? a : [];
      const opts = rows.map(h => ({
        value: String(h.id ?? h._id ?? h.hotel_id ?? Math.random()),
        label: `${h.name || h.title || "Hotel"}${h.city ? ", " + h.city : ""}`,
        city: h.city || "",
        price: toNum(h.price || h.net || 0, 0),
      }));
      return cb(opts);
    } catch {
      return cb([]);
    }
  }, []);

  // ===== доступные провайдеры =====
  const [suggestGuides, setSuggestGuides] = useState([]);
  const [suggestTransports, setSuggestTransports] = useState([]);
  const [guideId, setGuideId] = useState(null);
  const [transportId, setTransportId] = useState(null);
  const [guidePerDay, setGuidePerDay] = useState({});
  const [transportPerDay, setTransportPerDay] = useState({});

  const normalizeProvider = (x, kind) => ({
    id: x.id ?? x.provider_id ?? x._id ?? String(Math.random()),
    name: x.name ?? x.title ?? x.company ?? "—",
    kind,
    price_per_day: toNum(x.price_per_day ?? x.price ?? x.rate_day ?? 0, 0),
    currency: x.currency ?? "USD",
  });

  const loadAvailable = useCallback(async (kind) => {
    if (!range.from || !range.to) return [];
    const start = fmtDate(range.from), end = fmtDate(range.to);
    try {
      const a = await fetchJSON(`/api/${kind}s/available`, { start, end, limit: 50 });
      const items = (Array.isArray(a?.items) ? a.items : Array.isArray(a) ? a : []).map(x => normalizeProvider(x, kind));
      return items;
    } catch {}
    try {
      const a = await fetchJSON(`/api/providers/search`, { type: kind, start_date: start, end_date: end, limit: 50 });
      const items = (Array.isArray(a?.items) ? a.items : Array.isArray(a) ? a : []).map(x => normalizeProvider(x, kind));
      return items;
    } catch {}
    return [];
  }, [range.from, range.to]);

  useEffect(() => {
    (async () => {
      if (!range.from || !range.to) { setSuggestGuides([]); setSuggestTransports([]); return; }
      const [g, t] = await Promise.all([
        guideNeeded ? loadAvailable("guide") : [],
        transportNeeded ? loadAvailable("transport") : [],
      ]);
      setSuggestGuides(g || []);
      setSuggestTransports(t || []);
      if (g?.length && !guideId) setGuideId(g[0].id);
      if (t?.length && !transportId) setTransportId(t[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, guideNeeded, transportNeeded]);

// ===== Entry fees =====
useEffect(() => {
  // небольшой debounce
  const t = setTimeout(async () => {
    try {
      const items = await fetchEntryFees({ q: entryQ, limit: 50 });
      setEntryOptions(
        items.map((x) => ({
          value: x.id,
          label: `${x.name_ru || x.name_en || x.name_uz || "—"}${x.city ? " — " + x.city : ""} (${x.currency || "UZS"})`,
          raw: x,
        }))
      );
    } catch {
      setEntryOptions([]);
    }
  }, 250);
  return () => clearTimeout(t);
}, [entryQ]);


  // ===== города (GeoNames) =====
  const loadCityOptions = useCallback(async (input, cb) => {
    const q = (input || "").trim();
    if (!q || !GEONAMES_USER) {
      const injected = [];
      if (cities.length > 0) {
        const first = cities[0];
        injected.push({
          value: `${first.value}__loop_${cities.length}`,
          label: `↩︎ ${first.label}`,
          lat: first.lat, lng: first.lng, countryName: first.countryName,
          _loopOf: first.value,
        });
      }
      return cb(injected);
    }
    const langRaw = (typeof window !== "undefined" && window.i18next?.language) || (typeof navigator !== "undefined" && navigator.language) || "ru";
    const lang = /^uz/i.test(langRaw) ? "uz" : /^en/i.test(langRaw) ? "en" : "ru";

    try {
      const url =
        `https://secure.geonames.org/searchJSON` +
        `?name_startsWith=${encodeURIComponent(q)}` +
        `&maxRows=10&featureClass=P&orderby=relevance&username=${GEONAMES_USER}` +
        `&lang=${lang}`;

      const r = await fetch(url);
      const data = await r.json();
      const seen = new Set();
      const fromApi = (data?.geonames || []).map((g) => {
        const label = getLocalizedName(g, lang);
        const key = `${label}__${g.lat}_${g.lng}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          value: String(g.geonameId),
          label,
          lat: Number(g.lat),
          lng: Number(g.lng),
          countryName: g.countryName,
        };
      }).filter(Boolean);

      const injected = [];
      if (cities.length > 0) {
        const first = cities[0];
        const looksLikeFirst = first.label.toLowerCase().includes(q.toLowerCase());
        if (looksLikeFirst) {
          injected.push({
            value: `${first.value}__loop_${Date.now()}`,
            label: `↩︎ ${first.label} (${t("tb.loop_route", { defaultValue: "замкнуть маршрут" })})`,
            lat: first.lat, lng: first.lng, countryName: first.countryName,
            _loopOf: first.value,
          });
        }
      }
      cb([...injected, ...fromApi]);
    } catch {
      const injected = [];
      if (cities.length > 0) {
        const first = cities[0];
        injected.push({
          value: `${first.value}__loop_${Date.now()}`,
          label: `↩︎ ${first.label}`,
          lat: first.lat, lng: first.lng, countryName: first.countryName,
          _loopOf: first.value,
        });
      }
      cb(injected);
    }
  }, [cities, t]);

  // ===== DnD =====
  const onDragEnd = (result) => {
    if (!result.destination) return;
    const src = result.source.index, dst = result.destination.index;
    setCities((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(src, 1);
      copy.splice(dst, 0, moved);
      return copy;
    });
  };

  const onMarkerDrag = (index, e) => {
    const { lat, lng } = e.target.getLatLng();
    setCities((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], lat, lng };
      return copy;
    });
  };

  const onRoomingChange = (key, val) => setRooming((p) => ({ ...p, [key]: Math.max(0, toNum(val, 0)) }));

  // ===== прайсинг =====
  const [currency, setCurrency] = useState("USD");
  const [markupPct, setMarkupPct] = useState(0);
  const [vatPct, setVatPct] = useState(0);
  const [touristFeePerNight, setTouristFeePerNight] = useState(0);

  const providerById = useMemo(() => {
    const map = new Map();
    [...suggestGuides, ...suggestTransports].forEach(p => map.set(p.id, p));
    return map;
  }, [suggestGuides, suggestTransports]);

  const selectedGuide = providerById.get(guideId) || null;
  const selectedTransport = providerById.get(transportId) || null;

  const providersCostNet = useMemo(() => {
    let guideNet = 0, transportNet = 0;
    days.forEach(d => {
      const gid = guidePerDay[d.date] ?? guideId;
      const tid = transportPerDay[d.date] ?? transportId;
      const g = providerById.get(gid);
      const tr = providerById.get(tid);
      if (g && guideNeeded) guideNet += toNum(g.price_per_day, 0);
      if (tr && transportNeeded) transportNet += toNum(tr.price_per_day, 0);
    });
    return { guideNet, transportNet, total: guideNet + transportNet };
  }, [days, guidePerDay, transportPerDay, guideId, transportId, providerById, guideNeeded, transportNeeded]);

  const hotelsNet = useMemo(() => nights.reduce((s, n) => s + toNum(n.net, 0), 0), [nights]);
  const netTotal = useMemo(
  () => hotelsNet + providersCostNet.total + entryFeesNet,
  [hotelsNet, providersCostNet.total, entryFeesNet]
);
  const grossBeforeVat = useMemo(() => netTotal * (1 + toNum(markupPct, 0) / 100), [netTotal, markupPct]);
  const vatAmount = useMemo(() => grossBeforeVat * (toNum(vatPct, 0) / 100), [grossBeforeVat, vatPct]);
  const touristFees = useMemo(() => toNum(touristFeePerNight, 0) * Math.max(0, nights.length), [touristFeePerNight, nights.length]);
  const grandTotal = useMemo(() => grossBeforeVat + vatAmount + touristFees, [grossBeforeVat, vatAmount, touristFees]);
  const payingPax = useMemo(() => Math.max(1, toNum(adt, 0) + toNum(chd, 0)), [adt, chd]);
  const pricePerPax = useMemo(() => grandTotal / payingPax, [grandTotal, payingPax]);

  // ===== генерация программы =====
  const [programJSON, setProgramJSON] = useState(null);
  const [programText, setProgramText] = useState("");

  const generateProgram = () => {
    const program = {
      dates: { start: fmtDate(range.from), end: fmtDate(range.to), days: days.map(d => d.date) },
      arrivalTimeDay1,
      need: { guide: guideNeeded, transport: transportNeeded },
      rooming,
      monuments: (entrySelected || []).map(o => o.raw?.name_ru || o.raw?.name_en || o.label),
      pax: { adt: toNum(adt, 0), chd: toNum(chd, 0), inf: toNum(inf, 0) },
      cities: cities.map((c) => ({ id: c.value, name: c.label, lat: c.lat, lng: c.lng, country: c.countryName })),
      segments: segments.map((s) => ({
        from: { id: s.from.value, name: s.from.label, lat: s.from.lat, lng: s.from.lng },
        to:   { id: s.to.value,   name: s.to.label,   lat: s.to.lat,   lng: s.to.lng },
        time: segmentTimes[s.idx] || { dep: "", arr: "" },
        extras: (segmentExtras[s.idx] || []).map((x) => x.label),
      })),
      hotels: nights,
      providers: {
        guide: selectedGuide,
        transport: selectedTransport,
        overrides: { guidePerDay, transportPerDay },
      },
      pricing: {
        currency,
        netTotal,
        markupPct: toNum(markupPct, 0),
        grossBeforeVat,
        vatPct: toNum(vatPct, 0),
        vatAmount,
        touristFees,
        grandTotal,
        payingPax,
        pricePerPax,
      },
      createdAt: new Date().toISOString(),
    };

    const lines = [];
    lines.push(`Dates: ${fmtDate(range.from)} — ${fmtDate(range.to)} (${dayCount || 0} d)`);
    lines.push(`PAX: ADT ${adt}, CHD ${chd}, INF ${inf}`);
    lines.push(`Day 1 arrival: ${arrivalTimeDay1 || "-"}`);
    lines.push(`Guide: ${guideNeeded ? (selectedGuide ? selectedGuide.name : "yes") : "no"}; Transport: ${transportNeeded ? (selectedTransport ? selectedTransport.name : "yes") : "no"}`);
    const rm = ROOMING_TYPES.map((k) => `${k}:${rooming[k] || 0}`).filter((s) => !/:\s*0$/.test(s)).join(", ");
    if (rm) lines.push(`Rooming: ${rm}`);
    if (entrySelected?.length) {
  lines.push(
    `Monuments: ${entrySelected
      .map(o => o.raw?.name_ru || o.raw?.name_en || o.label)
      .join(", ")}`
  );
}
    if (cities.length) lines.push(`Cities: ${cities.map((c) => c.label).join(" → ")}`);
    if (segments.length) {
      lines.push("Segments:");
      segments.forEach((s, i) => {
        const tt = segmentTimes[s.idx] || {};
        const ex = (segmentExtras[s.idx] || []).map((x) => x.label).join(", ");
        lines.push(`  ${i + 1}) ${s.from.label} (${tt.dep || "—"}) → ${s.to.label} (${tt.arr || "—"})${ex ? ` [${ex}]` : ""}`);
      });
    }
    if (nights.length) {
      lines.push("Hotels:");
      nights.forEach((n, i) => lines.push(`  N${i + 1} ${n.date}: ${(n.hotel || "(hotel)")} — ${n.net || 0} ${currency}`));
    }
    lines.push(`Totals [${currency}]: NET=${netTotal.toFixed(2)}, +markup ${markupPct || 0}% → ${grossBeforeVat.toFixed(2)}, VAT ${vatPct || 0}% = ${vatAmount.toFixed(2)}, tourist fees=${touristFees.toFixed(2)}, GRAND=${grandTotal.toFixed(2)}; /pax=${pricePerPax.toFixed(2)} (${payingPax})`);

    setProgramJSON(program);
    setProgramText(lines.join("\n"));
    return program;
  };

  // ===== черновики =====
  const LS_KEY = "tourbuilder_draft_v1";

  const applyProgram = (p) => {
    if (!p) return;
    try {
      setRange({
        from: p?.dates?.start ? new Date(p.dates.start) : undefined,
        to:   p?.dates?.end   ? new Date(p.dates.end)   : undefined,
      });
      setArrivalTimeDay1(p.arrivalTimeDay1 || "");
      setGuideNeeded(!!p?.need?.guide);
      setTransportNeeded(!!p?.need?.transport);
      setRooming({ ...ROOMING_TYPES.reduce((a, k) => ((a[k] = 0), a), {}), ...(p.rooming || {}) });
      setMonuments((p.monuments || []).map(x => ({ value: String(x).toLowerCase().replace(/\s+/g, "_"), label: String(x) })));
      setCities((p.cities || []).map(c => ({ value: c.id, label: c.name, lat: c.lat, lng: c.lng, countryName: c.country })));
      setSegmentTimes(Object.fromEntries((p.segments || []).map((s, i) => [i, { dep: s?.time?.dep || "", arr: s?.time?.arr || "" }])));
      setSegmentExtras(Object.fromEntries((p.segments || []).map((s, i) => [i, (s.extras || []).map(x => ({ value: String(x), label: String(x) }))])));
      setNights((p.hotels || []).map(n => ({ date: n.date, hotel: n.hotel || "", hotelId: n.hotelId || null, net: toNum(n.net, 0), notes: n.notes || "" })));
      setGuideId(p?.providers?.guide?.id || null);
      setTransportId(p?.providers?.transport?.id || null);
      setGuidePerDay(p?.providers?.overrides?.guidePerDay || {});
      setTransportPerDay(p?.providers?.overrides?.transportPerDay || {});
      setCurrency(p?.pricing?.currency || "USD");
      setMarkupPct(toNum(p?.pricing?.markupPct, 0));
      setVatPct(toNum(p?.pricing?.vatPct, 0));
      setAdt(toNum(p?.pax?.adt, 2));
      setChd(toNum(p?.pax?.chd, 0));
      setInf(toNum(p?.pax?.inf, 0));
      setTouristFeePerNight(0);
      setProgramJSON(p);
      setProgramText(JSON.stringify(p, null, 2));
    } catch {}
  };

  const saveDraft = async () => {
    const payload = generateProgram();
    try {
      const base = API_BASE || window.frontend?.API_BASE || "";
      const r = await fetch(new URL("/api/tours/draft", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      alert(t("tb.draft_saved", { defaultValue: "Черновик сохранён" }));
    } catch {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      alert(t("tb.draft_saved_locally", { defaultValue: "Черновик сохранён локально" }));
    }
  };

  const loadDraft = async () => {
    try {
      const base = API_BASE || window.frontend?.API_BASE || "";
      const r = await fetch(new URL("/api/tours/draft/latest", base), { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const p = data?.data || data;
      applyProgram(p);
      alert(t("tb.draft_loaded", { defaultValue: "Черновик загружен" }));
      return;
    } catch {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { applyProgram(JSON.parse(raw)); alert(t("tb.draft_loaded_local", { defaultValue: "Черновик загружен из браузера" })); return; }
    }
    alert(t("tb.no_drafts", { defaultValue: "Черновиков не найдено" }));
  };

  // ===== экспорт в печать/PDF =====
  const exportPdf = () => {
    const payload = generateProgram();
    const html = `
<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<title>Tour Program</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color:#111; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 16px 0 8px; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; }
  .muted { color:#6b7280; font-size:12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .box { border:1px solid #e5e7eb; border-radius:8px; padding:10px; }
  @media print { .noprint { display:none; } }
</style>
</head>
<body>
  <div class="noprint" style="text-align:right;margin-bottom:8px">
    <button onclick="window.print()">Печать</button>
  </div>
  <h1>Программа тура</h1>
  <div class="grid">
    <div class="box">
      <h2>Даты</h2>
      <div>${payload.dates.start} — ${payload.dates.end} (${payload.dates.days.length} дн.)</div>
      <div class="muted">Прибытие D1: ${payload.arrivalTimeDay1 || "-"}</div>
    </div>
    <div class="box">
      <h2>PAX</h2>
      <div>ADT: ${payload.pax.adt} • CHD: ${payload.pax.chd} • INF: ${payload.pax.inf}</div>
    </div>
  </div>

  <h2>Маршрут</h2>
  <div>${payload.cities.map(c=>c.name).join(" → ") || "—"}</div>

  ${
    payload.segments.length
      ? `<table style="margin-top:8px">
           <thead><tr><th>#</th><th>Откуда</th><th>Куда</th><th>Выехали</th><th>Прибыли</th><th>Доп.</th></tr></thead>
           <tbody>
             ${payload.segments.map((s,i)=>`
               <tr>
                 <td>${i+1}</td>
                 <td>${s.from.name}</td>
                 <td>${s.to.name}</td>
                 <td>${s.time?.dep || "—"}</td>
                 <td>${s.time?.arr || "—"}</td>
                 <td>${(s.extras||[]).join(", ")}</td>
               </tr>
             `).join("")}
           </tbody>
         </table>`
      : ""
  }

  ${
    payload.hotels.length
      ? `<h2 style="margin-top:16px">Отели / Ночи</h2>
         <table>
           <thead><tr><th>Дата</th><th>Отель</th><th>Нетто</th><th>Примечание</th></tr></thead>
           <tbody>
             ${payload.hotels.map(n=>`
               <tr><td>${n.date}</td><td>${n.hotel || ""}</td><td>${n.net || 0} ${payload.pricing.currency}</td><td>${n.notes||""}</td></tr>
             `).join("")}
           </tbody>
         </table>`
      : ""
  }

  <h2 style="margin-top:16px">Стоимость</h2>
  <table>
    <tbody>
      <tr><td>Валюта</td><td>${payload.pricing.currency}</td></tr>
      <tr><td>NET</td><td>${payload.pricing.netTotal.toFixed(2)}</td></tr>
      <tr><td>Markup, %</td><td>${payload.pricing.markupPct}</td></tr>
      <tr><td>Subtotal</td><td>${payload.pricing.grossBeforeVat.toFixed(2)}</td></tr>
      <tr><td>VAT, %</td><td>${payload.pricing.vatPct} (=${payload.pricing.vatAmount.toFixed(2)})</td></tr>
      <tr><td>Tourist fees</td><td>${payload.pricing.touristFees.toFixed(2)}</td></tr>
      <tr><td><b>GRAND TOTAL</b></td><td><b>${payload.pricing.grandTotal.toFixed(2)}</b></td></tr>
      <tr><td>/ pax</td><td>${payload.pricing.pricePerPax.toFixed(2)}</td></tr>
    </tbody>
  </table>

  ${
    (payload.monuments||[]).length
      ? `<h2 style="margin-top:16px">Monuments</h2><div>${payload.monuments.join(", ")}</div>`
      : ""
  }

  <div class="muted" style="margin-top:12px">Сформировано: ${new Date().toLocaleString()}</div>
</body></html>
`.trim();

    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return alert("Разрешите всплывающие окна для экспорта в PDF.");
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 150);
  };

  // ===== render =====
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        {/* header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">
            {t("tourBuilder.title", { defaultValue: "Конструктор тура" })}
          </h1>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={loadDraft} className="px-3 py-2 rounded border">
              {t("tb.load_draft", { defaultValue: "Загрузить черновик" })}
            </button>
            <button type="button" onClick={saveDraft} className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
              {t("tb.save_draft", { defaultValue: "Сохранить черновик" })}
            </button>
            <button type="button" onClick={exportPdf} className="px-3 py-2 rounded border">
              {t("common.print_pdf", { defaultValue: "Печать / PDF" })}
            </button>
          </div>
        </div>

        {/* календарь + правая колонка */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 min-w-0">
            <label className="block text-sm font-medium mb-1">
              {t("tourBuilder.dates", { defaultValue: "Даты тура" })}
            </label>
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              ISOWeek
              numberOfMonths={2}
              disabled={{ before: new Date() }}
              className="text-sm"
              locale={dfnsLocale}
            />
            <p className="text-sm text-gray-600 mt-2">
              {range.from && range.to
                ? `${fmtDate(range.from)} — ${fmtDate(range.to)} • ${dayCount} ${t("days", { defaultValue: "дн." })}`
                : t("pick_dates", { defaultValue: "Выберите даты начала и конца" })}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("tourBuilder.arrivalDay1", { defaultValue: "Время прибытия первого дня" })}
              </label>
              <input
                type="time"
                value={arrivalTimeDay1}
                onChange={(e) => setArrivalTimeDay1(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="flex items-center gap-6">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={guideNeeded} onChange={(e)=>setGuideNeeded(e.target.checked)} />
                <span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={transportNeeded} onChange={(e)=>setTransportNeeded(e.target.checked)} />
                <span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span>
              </label>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">{t("tb.pax", { defaultValue: "Гости (PAX)" })}</div>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="sm:w-14">ADT</span>
                  <input type="number" min={0} value={adt} onChange={(e)=>setAdt(e.target.value)} className="h-9 w-full border rounded px-2 text-sm"/>
                </label>
                <label className="text-sm flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="sm:w-14">CHD</span>
                  <input type="number" min={0} value={chd} onChange={(e)=>setChd(e.target.value)} className="h-9 w-full border rounded px-2 text-sm"/>
                </label>
                <label className="text-sm flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="sm:w-14">INF</span>
                  <input type="number" min={0} value={inf} onChange={(e)=>setInf(e.target.value)} className="h-9 w-full border rounded px-2 text-sm"/>
                </label>
              </div>
            </div>

            <div>              
                <label className="block text-sm font-medium mb-1">
                  {t("tourBuilder.monuments", { defaultValue: "Monuments entry fees" })}
                </label>
              
                <input
                  className="w-full border rounded px-3 py-2 mb-2"
                  placeholder={t("tourBuilder.monuments_ph", { defaultValue: "Начните вводить объект/город…" })}
                  value={entryQ}
                  onChange={(e) => setEntryQ(e.target.value)}
                />
              
                <AsyncSelect
                  isMulti
                  cacheOptions
                  defaultOptions={entryOptions}
                  loadOptions={(input, cb) => cb(entryOptions)}
                  value={entrySelected}
                  onChange={(vals) => setEntrySelected(vals || [])}
                  classNamePrefix="select"
                  placeholder={t("tourBuilder.monuments_ph", { defaultValue: "Выберите объекты" })}
                  noOptionsMessage={() => t("common.nothing_found", { defaultValue: "Ничего не найдено" })}
                />
              
                <div className="flex items-center gap-3 text-sm mt-2">
                  <span className="text-gray-600">{t("tb.tariff_for", { defaultValue: "Тарифы для:" })}</span>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="resident_type"
                      value="nrs"
                      checked={residentType === "nrs"}
                      onChange={() => setResidentType("nrs")}
                    />
                    <span>{t("tb.nonresidents", { defaultValue: "Нерезиденты" })}</span>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="resident_type"
                      value="res"
                      checked={residentType === "res"}
                      onChange={() => setResidentType("res")}
                    />
                    <span>{t("tb.residents", { defaultValue: "Резиденты" })}</span>
                  </label>
                </div>
              </div>
          </div>
        </div>

        {/* города + dnd */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("tourBuilder.cities", { defaultValue: "Города (multiselect)" })}
          </label>
          <AsyncSelect
            cacheOptions
            defaultOptions
            isMulti
            classNamePrefix="select"
            placeholder={t("tourBuilder.cities_ph", { defaultValue: "Начните вводить город..." })}
            loadOptions={loadCityOptions}
            onChange={(vals) => setCities(vals || [])}
            value={cities}
          />
          {!!cities.length && (
            <div className="mt-3">
              <p className="text-sm text-gray-500 mb-2">
                {t("tourBuilder.dragToReorder", { defaultValue: "Перетащите для изменения порядка" })}
              </p>
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="citiesList">
                  {(provided) => (
                    <ul ref={provided.innerRef} {...provided.droppableProps} className="divide-y rounded border">
                      {cities.map((c, idx) => (
                        <Draggable key={c.value} draggableId={String(c.value)} index={idx}>
                          {(prov) => (
                            <li
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              className="px-3 py-2 bg-white flex items-center justify-between"
                            >
                              <span className="truncate">{idx + 1}. {c.label}</span>
                              <span className="text-xs text-gray-500">
                                {Number.isFinite(c.lat) && Number.isFinite(c.lng) ? `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}` : "—"}
                              </span>
                            </li>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          )}
        </div>

        {/* rooming */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("tourBuilder.rooming", { defaultValue: "Rooming (number of rooms)" })}
          </label>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] [grid-auto-flow:dense]">
            {ROOMING_TYPES.map((k) => (
              <label className="grid grid-cols-[120px_1fr] items-center gap-2 rounded border px-3 py-2 bg-white">
                <span className="text-sm text-gray-700 whitespace-nowrap">{k}</span>
                <input
                  type="number"
                  min={0}
                  value={rooming[k]}
                  onChange={(e) => onRoomingChange(k, e.target.value)}
                  className="h-9 w-full border rounded px-2 text-sm"   
                />
              </label>
            ))}
          </div>
        </div>

        {/* карта */}
        <div>
          <h2 className="text-lg font-semibold mb-2">
            {t("tourBuilder.map", { defaultValue: "Карта" })}
          </h2>
          <div className="h-[420px] w-full rounded overflow-hidden border">
            <MapContainer center={mapCenter} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {cities.map((c, idx) =>
                Number.isFinite(c.lat) && Number.isFinite(c.lng) ? (
                  <Marker
                    key={c.value}
                    position={[c.lat, c.lng]}
                    draggable
                    eventHandlers={{ dragend: (e) => onMarkerDrag(idx, e) }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <div className="font-semibold">{c.label}</div>
                        <div className="text-gray-600">
                          {t("tourBuilder.markerHint", { defaultValue: "Перетащите маркер для уточнения точки" })}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ) : null
              )}
              {cities.length >= 2 && (
                <Polyline
                  positions={cities
                    .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
                    .map(c => [c.lat, c.lng])}
                />
              )}
            </MapContainer>
          </div>
        </div>

        {/* сегменты */}
        {!!segments.length && (
          <div>
            <h2 className="text-lg font-semibold mb-2">
              {t("tourBuilder.segments", { defaultValue: "Сегменты маршрута" })}
            </h2>
            <div className="space-y-3">
              {segments.map((s) => {
                const times = segmentTimes[s.idx] || {};
                const extras = segmentExtras[s.idx] || [];
                return (
                  <div key={s.idx} className="border rounded p-3">
                    <div className="font-medium mb-2">{s.from.label} → {s.to.label}</div>
                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          {t("tourBuilder.dep", { defaultValue: "Время выезда" })}
                        </label>
                        <input
                          type="time"
                          value={times.dep || ""}
                          onChange={(e) => onSegmentTimeChange(s.idx, "dep", e.target.value)}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          {t("tourBuilder.arr", { defaultValue: "Время приезда" })}
                        </label>
                        <input
                          type="time"
                          value={times.arr || ""}
                          onChange={(e) => onSegmentTimeChange(s.idx, "arr", e.target.value)}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          {t("tourBuilder.extras", { defaultValue: "Доп. элементы" })}
                        </label>
                        <CreatableSelect
                          isMulti
                          value={extras}
                          onChange={(vals) => onSegmentExtrasChange(s.idx, vals)}
                          options={EXTRAS_OPTIONS}
                          classNamePrefix="select"
                          placeholder={t("tourBuilder.extras_ph", { defaultValue: "Питание, мастер-класс…" })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* рекомендации провайдеров */}
        {(range.from && range.to) && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="border rounded p-3">
              <h3 className="font-semibold mb-2">
                {t("tb.guides_suggest", { defaultValue: "Гиды, доступные на выбранные даты" })}
              </h3>
              {suggestGuides.length ? (
                <div className="space-y-2">
                  {suggestGuides.map((g) => (
                    <label key={g.id} className="flex items-center justify-between gap-3 p-2 rounded border hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-xs text-gray-600">~ {g.price_per_day || 0} {g.currency || currency} / day</div>
                      </div>
                      <input type="radio" name="guide" checked={guideId === g.id} onChange={() => setGuideId(g.id)} />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  {t("tb.no_guides", { defaultValue: "Нет подходящих гидов" })}
                </div>
              )}

              {!!days.length && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-1">
                    {t("tb.override_by_day", { defaultValue: "Переопределить по дням" })}
                  </div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {days.map(d => (
                      <div key={d.date} className="flex items-center gap-2">
                        <div className="w-28 text-xs text-gray-500">{d.idx}. {d.date}</div>
                        <select
                          value={guidePerDay[d.date] ?? ""}
                          onChange={(e) => setGuidePerDay((p) => ({ ...p, [d.date]: e.target.value || undefined }))}
                          className="border rounded px-2 py-1 text-sm flex-1"
                        >
                          <option value="">{t("tb.use_default", { defaultValue: "Как по умолчанию" })}</option>
                          {suggestGuides.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border rounded p-3">
              <h3 className="font-semibold mb-2">
                {t("tb.transports_suggest", { defaultValue: "Транспорт, доступный на выбранные даты" })}
              </h3>
              {suggestTransports.length ? (
                <div className="space-y-2">
                  {suggestTransports.map((g) => (
                    <label key={g.id} className="flex items-center justify-between gap-3 p-2 rounded border hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-xs text-gray-600">~ {g.price_per_day || 0} {g.currency || currency} / day</div>
                      </div>
                      <input type="radio" name="transport" checked={transportId === g.id} onChange={() => setTransportId(g.id)} />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  {t("tb.no_transports", { defaultValue: "Нет подходящего транспорта" })}
                </div>
              )}

              {!!days.length && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-1">
                    {t("tb.override_by_day", { defaultValue: "Переопределить по дням" })}
                  </div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {days.map(d => (
                      <div key={d.date} className="flex items-center gap-2">
                        <div className="w-28 text-xs text-gray-500">{d.idx}. {d.date}</div>
                        <select
                          value={transportPerDay[d.date] ?? ""}
                          onChange={(e) => setTransportPerDay((p) => ({ ...p, [d.date]: e.target.value || undefined }))}
                          className="border rounded px-2 py-1 text-sm flex-1"
                        >
                          <option value="">{t("tb.use_default", { defaultValue: "Как по умолчанию" })}</option>
                          {suggestTransports.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ночёвки/отели */}
        {!!nights.length && (
          <div>
            <h2 className="text-lg font-semibold mb-2">
              {t("tb.hotels_nights", { defaultValue: "Ночёвки (отели добавляются вручную)" })}
            </h2>
            <div className="space-y-2">
              {nights.map((n) => (
                <div key={n.date} className="grid md:grid-cols-6 gap-2 items-center border rounded p-2">
                  <div className="text-xs text-gray-500 md:col-span-1">{n.date}</div>
                  <div className="md:col-span-3">
                    <AsyncSelect
                      cacheOptions
                      defaultOptions
                      classNamePrefix="select"
                      placeholder={t("select_hotel", { defaultValue: "Выберите отель" })}
                      loadOptions={loadHotelOptions}
                      value={n.hotelId ? { value: n.hotelId, label: n.hotel } : (n.hotel ? { value: "custom", label: n.hotel } : null)}
                      onChange={(opt) => {
                        setNights(prev => prev.map(x => x.date !== n.date ? x : ({
                          ...x,
                          hotel: opt?.label || "",
                          hotelId: opt?.value || null,
                          net: (opt && typeof opt.price === "number" && !x.net) ? opt.price : x.net,
                        })));
                      }}
                      components={{ DropdownIndicator: () => null, IndicatorSeparator: () => null }}
                    />
                  </div>

                  <input
                    type="number" min={0}
                    className={`${INPUT_S} md:col-span-1`}
                    placeholder={t("tb.net", { defaultValue: "Нетто" })}
                    value={n.net}
                    onChange={(e) => setNightField(n.date, "net", e.target.value)}
                  />
                  <input
                    type="text"
                    className="border rounded px-2 py-1 md:col-span-1 h-9"
                    placeholder={t("tb.notes", { defaultValue: "Заметка" })}
                    value={n.notes}
                    onChange={(e) => setNightField(n.date, "notes", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* прайсинг */}
        <div className="border rounded p-3">
          <h2 className="text-lg font-semibold mb-3">
            {t("tb.pricing", { defaultValue: "Ценообразование" })}
          </h2>

          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.currency", { defaultValue: "Валюта" })}</label>
              <select className="border rounded px-2 py-2 w-full h-9" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="UZS">UZS</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.markup", { defaultValue: "Наценка, %" })}</label>
              <input type="number" min={0} className={INPUT_S + " w-full"} value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT, %</label>
              <input type="number" min={0} className={INPUT_S + " w-full"} value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.tourist_fee", { defaultValue: "Туристический сбор / ночь" })}</label>
              <input type="number" min={0} className={INPUT_S + " w-full"} value={touristFeePerNight} onChange={(e) => setTouristFeePerNight(e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-5 gap-4 mt-4 text-sm">
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.pax", { defaultValue: "Гости (PAX)" })}</div>
              <div>ADT: {adt} • CHD: {chd} • INF: {inf}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.hotels_cost", { defaultValue: "Отели (нетто)" })}</div>
              <div>{hotelsNet.toFixed(2)} {currency}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.providers_cost", { defaultValue: "Гид/Транспорт (нетто)" })}</div>
              <div className="flex justify-between"><span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span><span>{providersCostNet.guideNet.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span><span>{providersCostNet.transportNet.toFixed(2)} {currency}</span></div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.entry_fees_net", { defaultValue: "Entry fees (нетто)" })}</div>
              <div>{entryFeesNet.toFixed(2)} {currency}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.total", { defaultValue: "Суммарно" })}</div>
              <div className="flex justify-between"><span>NET</span><span>{netTotal.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ Markup</span><span>{grossBeforeVat.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ VAT</span><span>{vatAmount.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ Tourist fees</span><span>{touristFees.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>GRAND</span><span>{grandTotal.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between mt-1"><span>/ pax</span><span>{pricePerPax.toFixed(2)} {currency}</span></div>
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={generateProgram} className="px-4 py-2 rounded border">
            {t("tourBuilder.generate", { defaultValue: "Сформировать программу" })}
          </button>
          <button type="button" onClick={exportPdf} className="px-4 py-2 rounded border">
            {t("common.print_pdf", { defaultValue: "Печать / PDF" })}
          </button>
          <button type="button" onClick={saveDraft} className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
            {t("tb.save_draft", { defaultValue: "Сохранить черновик" })}
          </button>
        </div>

        {/* результат */}
        {programJSON && (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-2">
                {t("tourBuilder.programText", { defaultValue: "Текстовая программа" })}
              </h3>
              <pre className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap">{programText}</pre>
            </div>
            <div>
              <h3 className="font-semibold mb-2">JSON</h3>
              <pre className="text-sm bg-gray-50 p-3 rounded border overflow-x-auto">
                {JSON.stringify(programJSON, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
