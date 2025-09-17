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

// --- Leaflet marker icons fix for Vite bundling ---
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const GEONAMES_USER = import.meta.env.VITE_GEONAMES_USERNAME || "";

const DEFAULT_CENTER = [41.3111, 69.2797]; // Tashkent
const DEFAULT_ZOOM = 5;

const ROOMING_TYPES = [
  "SGL","DBL","TRPL","Quadruple","Quintuple","Sextuple","Septuple","Octuple","Nonuple","Decuple"
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
  { value: "khiva_itchan_kala", label: "Itchan Kala (Khiva)" },
  { value: "bukhara_ark", label: "Ark (Bukhara)" },
];

const toNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0,10) : "");
const addDays = (d, n) => new Date(new Date(d).getTime() + n*86400000);
const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  const d1 = new Date(fmtDate(a)), d2 = new Date(fmtDate(b));
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1); // включительно, чтобы считать Дни
};

export default function TourBuilder() {
  const { t } = useTranslation();

  // ====== БАЗОВАЯ ФОРМА ======
  const [arrivalTimeDay1, setArrivalTimeDay1] = useState("");
  const [cities, setCities] = useState([]); // [{value,label,lat,lng,countryName}]
  const [rooming, setRooming] = useState(ROOMING_TYPES.reduce((a,k)=>((a[k]=0),a),{}));
  const [guideNeeded, setGuideNeeded] = useState(true);
  const [transportNeeded, setTransportNeeded] = useState(true);
  const [monuments, setMonuments] = useState([]);

  // ====== ДАТЫ ТУРА ======
  const [range, setRange] = useState({ from: undefined, to: undefined }); // DayPicker range
  const dayCount = daysBetween(range.from, range.to);

  // список дней с датами
  const days = useMemo(() => {
    if (!range.from || !range.to) return [];
    const n = dayCount;
    return Array.from({ length: n }, (_, i) => ({
      idx: i + 1,
      date: fmtDate(addDays(range.from, i)),
    }));
  }, [range.from, range.to, dayCount]);

  // ====== СЕГМЕНТЫ ПО ГОРОДАМ ======
  const segments = useMemo(() => {
    const res = [];
    for (let i = 0; i < cities.length - 1; i++) res.push({ idx: i, from: cities[i], to: cities[i + 1] });
    return res;
  }, [cities]);

  const mapCenter = useMemo(() => {
    const first = cities.find(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    return first ? [first.lat, first.lng] : DEFAULT_CENTER;
  }, [cities]);

  // пер-сегментные данные
  const [segmentTimes, setSegmentTimes] = useState({});   // idx -> {dep, arr}
  const [segmentExtras, setSegmentExtras] = useState({}); // idx -> [{value,label}]
  const onSegmentTimeChange = (idx, field, value) =>
    setSegmentTimes((p) => ({ ...p, [idx]: { ...(p[idx] || {}), [field]: value } }));
  const onSegmentExtrasChange = (idx, vals) =>
    setSegmentExtras((p) => ({ ...p, [idx]: vals || [] }));

  // ====== ГОСТИНИЦЫ ПО НОЧАМ (ручной ввод) ======
  // одна ночь = дата и цена/название. Обычно ночь = день i → ночь между day i и day i+1
  const [nights, setNights] = useState([]); // [{date, hotel, net, notes}]
  useEffect(() => {
    // синхронизировать массив ночей под выбранный диапазон
    if (!range.from || !range.to) { setNights([]); return; }
    const totalNights = Math.max(0, dayCount - 1);
    const base = [];
    for (let i=0; i<totalNights; i++) {
      const date = fmtDate(addDays(range.from, i)); // дата ночёвки (после дня i+1)
      const existing = nights.find(n => n.date === date);
      base.push(existing || { date, hotel: "", net: 0, notes: "" });
    }
    setNights(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, dayCount]);

  const setNightField = (date, key, val) =>
    setNights((prev) => prev.map(n => n.date === date ? { ...n, [key]: key === "net" ? toNum(val,0) : val } : n));

  // ====== ПРОВАЙДЕРЫ: автоподбор по датам ======
  const [suggestGuides, setSuggestGuides] = useState([]);       // [{id,name,price_per_day,currency}]
  const [suggestTransports, setSuggestTransports] = useState([]); // idem

  // выбранные провайдеры на тур целиком (можно переопределять на день)
  const [guideId, setGuideId] = useState(null);
  const [transportId, setTransportId] = useState(null);

  // переопределения по дням: {date: id}
  const [guidePerDay, setGuidePerDay] = useState({});
  const [transportPerDay, setTransportPerDay] = useState({});

  const normalizeProvider = (x, kind) => ({
    id: x.id ?? x.provider_id ?? x._id ?? String(Math.random()),
    name: x.name ?? x.title ?? x.company ?? "—",
    kind,
    price_per_day: toNum(x.price_per_day ?? x.price ?? x.rate_day ?? 0, 0),
    currency: x.currency ?? "USD",
  });

  const fetchJSON = async (url, params = {}) => {
    const u = new URL(url, API_BASE || window.frontend?.API_BASE || "");
    Object.entries(params).forEach(([k,v]) => (v!=null && v!=="") && u.searchParams.set(k, v));
    const r = await fetch(u.toString(), { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  };

  const loadAvailable = useCallback(async (kind) => {
    if (!range.from || !range.to) return [];
    const start = fmtDate(range.from), end = fmtDate(range.to);

    // 1) основной: /api/{kind}s/available
    try {
      const a = await fetchJSON(`/api/${kind}s/available`, { start, end, limit: 50 });
      const items = (Array.isArray(a?.items) ? a.items : Array.isArray(a) ? a : []).map((x) => normalizeProvider(x, kind));
      return items;
    } catch {}

    // 2) фолбэк: /api/providers/search?type=guide|transport
    try {
      const a = await fetchJSON(`/api/providers/search`, { type: kind, start_date: start, end_date: end, limit: 50 });
      const items = (Array.isArray(a?.items) ? a.items : Array.isArray(a) ? a : []).map((x) => normalizeProvider(x, kind));
      return items;
    } catch {}

    return [];
  }, [range.from, range.to]);

  useEffect(() => {
    // при выборе диапазона подгружаем рекомендации
    (async () => {
      if (!range.from || !range.to) { setSuggestGuides([]); setSuggestTransports([]); return; }
      const [g, t] = await Promise.all([
        guideNeeded ? loadAvailable("guide") : [],
        transportNeeded ? loadAvailable("transport") : [],
      ]);
      setSuggestGuides(g || []);
      setSuggestTransports(t || []);
      // если ничего не выбрано — можно автоподставить первого
      if (g?.length && !guideId) setGuideId(g[0].id);
      if (t?.length && !transportId) setTransportId(t[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, guideNeeded, transportNeeded]);

  // ====== ГОРОДА поиск ======
  const loadCityOptions = useCallback(async (input, cb) => {
    const q = (input || "").trim();
    if (!q || !GEONAMES_USER) return cb([]);
    try {
      const url = `https://secure.geonames.org/searchJSON?name_startsWith=${encodeURIComponent(
        q
      )}&maxRows=10&featureClass=P&orderby=relevance&username=${GEONAMES_USER}&lang=ru`;
      const r = await fetch(url);
      const data = await r.json();
      const options = (data?.geonames || []).map((g) => ({
        value: String(g.geonameId),
        label: `${g.name}${g.adminName1 ? ", " + g.adminName1 : ""}${g.countryName ? ", " + g.countryName : ""}`,
        lat: Number(g.lat),
        lng: Number(g.lng),
        countryName: g.countryName,
      }));
      cb(options);
    } catch {
      cb([]);
    }
  }, []);

  // DnD reorder
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

  // ====== ЦЕНООБРАЗОВАНИЕ ======
  const [currency, setCurrency] = useState("USD");
  const [markupPct, setMarkupPct] = useState(0);         // наценка %
  const [vatPct, setVatPct] = useState(0);               // НДС %
  const [touristFeePerNight, setTouristFeePerNight] = useState(0); // с/ночь/чел — если нужно

  const providerById = useMemo(() => {
    const map = new Map();
    [...suggestGuides, ...suggestTransports].forEach(p => map.set(p.id, p));
    return map;
  }, [suggestGuides, suggestTransports]);

  const selectedGuide = providerById.get(guideId) || null;
  const selectedTransport = providerById.get(transportId) || null;

  // стоимость провайдеров по дням (с переопределением)
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

  const netTotal = useMemo(() => hotelsNet + providersCostNet.total, [hotelsNet, providersCostNet.total]);
  const grossBeforeVat = useMemo(() => netTotal * (1 + toNum(markupPct,0)/100), [netTotal, markupPct]);
  const vatAmount = useMemo(() => grossBeforeVat * (toNum(vatPct,0)/100), [grossBeforeVat, vatPct]);
  const touristFees = useMemo(() => toNum(touristFeePerNight,0) * Math.max(0, nights.length), [touristFeePerNight, nights.length]);
  const grandTotal = useMemo(() => grossBeforeVat + vatAmount + touristFees, [grossBeforeVat, vatAmount, touristFees]);

  // ====== СФОРМИРОВАТЬ ПРОГРАММУ ======
  const [programJSON, setProgramJSON] = useState(null);
  const [programText, setProgramText] = useState("");

  const generateProgram = () => {
    const program = {
      dates: { start: fmtDate(range.from), end: fmtDate(range.to), days: days.map(d => d.date) },
      arrivalTimeDay1,
      need: { guide: guideNeeded, transport: transportNeeded },
      rooming,
      monuments: (monuments || []).map((m) => m.label),
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
        overrides: { guidePerDay, transportPerDay }
      },
      pricing: {
        currency,
        netTotal,
        markupPct: toNum(markupPct,0),
        grossBeforeVat,
        vatPct: toNum(vatPct,0),
        vatAmount,
        touristFees,
        grandTotal
      },
      createdAt: new Date().toISOString(),
    };

    const lines = [];
    lines.push(`Dates: ${fmtDate(range.from)} — ${fmtDate(range.to)} (${dayCount || 0} d)`);
    lines.push(`Day 1 arrival: ${arrivalTimeDay1 || "-"}`);
    lines.push(`Guide: ${guideNeeded ? (selectedGuide ? selectedGuide.name : "yes") : "no"}; Transport: ${transportNeeded ? (selectedTransport ? selectedTransport.name : "yes") : "no"}`);
    const rm = ROOMING_TYPES.map((k) => `${k}:${rooming[k] || 0}`).filter((s) => !/:\s*0$/.test(s)).join(", ");
    if (rm) lines.push(`Rooming: ${rm}`);
    if (monuments?.length) lines.push(`Monuments: ${(monuments || []).map((m) => m.label).join(", ")}`);
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
      nights.forEach((n, i) => lines.push(`  N${i+1} ${n.date}: ${n.hotel || "(hotel)"} — ${n.net || 0} ${currency}`));
    }
    lines.push(`Totals [${currency}]: NET=${netTotal.toFixed(2)}, +markup ${markupPct||0}% → ${grossBeforeVat.toFixed(2)}, VAT ${vatPct||0}% = ${vatAmount.toFixed(2)}, tourist fees=${touristFees.toFixed(2)}, GRAND=${grandTotal.toFixed(2)}`);

    setProgramJSON(program);
    setProgramText(lines.join("\n"));
  };

  // ====== RENDER ======
  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t("tourBuilder.title", { defaultValue: "Конструктор тура" })}</h1>

        {/* ===== ДАТЫ ТУРА ===== */}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
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
            />
            <p className="text-sm text-gray-600 mt-2">
              {range.from && range.to
                ? `${fmtDate(range.from)} — ${fmtDate(range.to)} • ${dayCount} ${t("days", { defaultValue: "дн." })}`
                : t("pick_dates", { defaultValue: "Выберите даты начала и конца" })}
            </p>
          </div>

          {/* Время прибытия D1 + переключатели */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("tourBuilder.arrivalDay1", { defaultValue: "Время прибытия первого дня" })}
              </label>
              <input type="time" value={arrivalTimeDay1} onChange={(e)=>setArrivalTimeDay1(e.target.value)} className="w-full border rounded px-3 py-2"/>
            </div>
            <div className="flex items-center gap-6">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={guideNeeded} onChange={(e)=>setGuideNeeded(e.target.checked)}/>
                <span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={transportNeeded} onChange={(e)=>setTransportNeeded(e.target.checked)}/>
                <span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span>
              </label>
            </div>

            {/* Monuments */}
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("tourBuilder.monuments", { defaultValue: "Monuments entry fees" })}
              </label>
              <CreatableSelect
                isMulti
                value={monuments}
                onChange={(vals)=>setMonuments(vals || [])}
                options={MONUMENTS_PRESET}
                classNamePrefix="select"
                placeholder={t("tourBuilder.monuments_ph", { defaultValue: "Выберите объекты" })}
              />
            </div>
          </div>
        </div>

        {/* ===== ГОРОДА / ПОРЯДОК ===== */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("tourBuilder.cities", { defaultValue: "Города (multiselect)" })}
          </label>
          <AsyncSelect
            cacheOptions defaultOptions isMulti classNamePrefix="select"
            placeholder={t("tourBuilder.cities_ph", { defaultValue: "Начните вводить город..." })}
            loadOptions={loadCityOptions}
            onChange={(vals)=>setCities(vals || [])}
            value={cities}
          />
          {/* порядок городов можно менять drag-n-drop */}
          {!!cities.length && (
            <div className="mt-3">
              <p className="text-sm text-gray-500 mb-2">
                {t("tourBuilder.dragToReorder", { defaultValue: "Перетащите для изменения порядка" })}
              </p>
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="citiesList">
                  {(provided)=>(
                    <ul ref={provided.innerRef} {...provided.droppableProps} className="divide-y rounded border">
                      {cities.map((c, idx)=>(
                        <Draggable key={c.value} draggableId={String(c.value)} index={idx}>
                          {(prov)=>(
                            <li ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                                className="px-3 py-2 bg-white flex items-center justify-between">
                              <span className="truncate">{idx+1}. {c.label}</span>
                              <span className="text-xs text-gray-500">
                                {Number.isFinite(c.lat)&&Number.isFinite(c.lng)?`${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`:"—"}
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

        {/* ===== ROOMING ===== */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("tourBuilder.rooming", { defaultValue: "Rooming (кол-во номеров)" })}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {ROOMING_TYPES.map((k)=>(
              <div key={k} className="flex items-center gap-2">
                <span className="w-24 text-sm text-gray-600">{k}</span>
                <input type="number" min={0} value={rooming[k]}
                       onChange={(e)=>onRoomingChange(k, e.target.value)}
                       className="w-28 border rounded px-2 py-1"/>
              </div>
            ))}
          </div>
        </div>

        {/* ===== КАРТА ===== */}
        <div>
          <h2 className="text-lg font-semibold mb-2">{t("tourBuilder.map", { defaultValue: "Карта" })}</h2>
          <div className="h-[420px] w-full rounded overflow-hidden border">
            <MapContainer center={mapCenter} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{height:"100%",width:"100%"}}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {cities.map((c, idx) => Number.isFinite(c.lat)&&Number.isFinite(c.lng) ? (
                <Marker key={c.value} position={[c.lat, c.lng]} draggable
                        eventHandlers={{ dragend: (e)=>onMarkerDrag(idx, e) }}>
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">{c.label}</div>
                      <div className="text-gray-600">
                        {t("tourBuilder.markerHint", { defaultValue: "Перетащите маркер для уточнения точки" })}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ) : null)}
              {cities.length >= 2 && (
                <Polyline positions={cities.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lng)).map(c=>[c.lat,c.lng])}/>
              )}
            </MapContainer>
          </div>
        </div>

        {/* ===== СЕГМЕНТЫ (время + допы) ===== */}
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
                        <input type="time" value={times.dep || ""} onChange={(e)=>onSegmentTimeChange(s.idx,"dep",e.target.value)} className="w-full border rounded px-3 py-2"/>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          {t("tourBuilder.arr", { defaultValue: "Время приезда" })}
                        </label>
                        <input type="time" value={times.arr || ""} onChange={(e)=>onSegmentTimeChange(s.idx,"arr",e.target.value)} className="w-full border rounded px-3 py-2"/>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          {t("tourBuilder.extras", { defaultValue: "Доп. элементы" })}
                        </label>
                        <CreatableSelect isMulti value={extras} onChange={(vals)=>onSegmentExtrasChange(s.idx, vals)}
                          options={EXTRAS_OPTIONS} classNamePrefix="select"
                          placeholder={t("tourBuilder.extras_ph", { defaultValue: "Питание, мастер-класс…" })}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== АВТОПРЕДЛОЖЕНИЯ ПРОВАЙДЕРОВ ===== */}
        {(range.from && range.to) && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Guides */}
            <div className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{t("tb.guides_suggest", { defaultValue: "Гиды, доступные на выбранные даты" })}</h3>
              </div>
              {suggestGuides.length ? (
                <div className="space-y-2">
                  {suggestGuides.map((g) => (
                    <label key={g.id} className="flex items-center justify-between gap-3 p-2 rounded border hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-xs text-gray-600">~ {g.price_per_day || 0} {g.currency || currency} / day</div>
                      </div>
                      <input
                        type="radio"
                        name="guide"
                        checked={guideId === g.id}
                        onChange={()=>setGuideId(g.id)}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">{t("tb.no_guides", { defaultValue: "Нет подходящих гидов" })}</div>
              )}

              {/* overrides per day */}
              {!!days.length && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-1">{t("tb.override_by_day", { defaultValue: "Переопределить по дням" })}</div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {days.map(d => (
                      <div key={d.date} className="flex items-center gap-2">
                        <div className="w-28 text-xs text-gray-500">{d.idx}. {d.date}</div>
                        <select
                          value={guidePerDay[d.date] ?? ""}
                          onChange={(e)=>setGuidePerDay((p)=>({ ...p, [d.date]: e.target.value || undefined }))}
                          className="border rounded px-2 py-1 text-sm flex-1"
                        >
                          <option value="">{t("tb.use_default", { defaultValue: "Как по умолчанию" })}</option>
                          {suggestGuides.map((g)=> <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Transport */}
            <div className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{t("tb.transports_suggest", { defaultValue: "Транспорт, доступный на выбранные даты" })}</h3>
              </div>
              {suggestTransports.length ? (
                <div className="space-y-2">
                  {suggestTransports.map((g) => (
                    <label key={g.id} className="flex items-center justify-between gap-3 p-2 rounded border hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-xs text-gray-600">~ {g.price_per_day || 0} {g.currency || currency} / day</div>
                      </div>
                      <input
                        type="radio"
                        name="transport"
                        checked={transportId === g.id}
                        onChange={()=>setTransportId(g.id)}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">{t("tb.no_transports", { defaultValue: "Нет подходящего транспорта" })}</div>
              )}

              {!!days.length && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-1">{t("tb.override_by_day", { defaultValue: "Переопределить по дням" })}</div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {days.map(d => (
                      <div key={d.date} className="flex items-center gap-2">
                        <div className="w-28 text-xs text-gray-500">{d.idx}. {d.date}</div>
                        <select
                          value={transportPerDay[d.date] ?? ""}
                          onChange={(e)=>setTransportPerDay((p)=>({ ...p, [d.date]: e.target.value || undefined }))}
                          className="border rounded px-2 py-1 text-sm flex-1"
                        >
                          <option value="">{t("tb.use_default", { defaultValue: "Как по умолчанию" })}</option>
                          {suggestTransports.map((g)=> <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== НОЧИ (HOTELS) ===== */}
        {!!nights.length && (
          <div>
            <h2 className="text-lg font-semibold mb-2">{t("tb.hotels_nights", { defaultValue: "Ночёвки (отели добавляются вручную)" })}</h2>
            <div className="space-y-2">
              {nights.map((n) => (
                <div key={n.date} className="grid md:grid-cols-6 gap-2 items-center border rounded p-2">
                  <div className="text-xs text-gray-500 md:col-span-1">{n.date}</div>
                  <input
                    type="text" className="border rounded px-2 py-1 md:col-span-3"
                    placeholder={t("tb.hotel_name", { defaultValue: "Название отеля / примечание" })}
                    value={n.hotel} onChange={(e)=>setNightField(n.date, "hotel", e.target.value)}
                  />
                  <input
                    type="number" min={0} className="border rounded px-2 py-1 md:col-span-1"
                    placeholder={t("tb.net", { defaultValue: "Нетто" })}
                    value={n.net} onChange={(e)=>setNightField(n.date, "net", e.target.value)}
                  />
                  <input
                    type="text" className="border rounded px-2 py-1 md:col-span-1"
                    placeholder={t("tb.notes", { defaultValue: "Заметка" })}
                    value={n.notes} onChange={(e)=>setNightField(n.date, "notes", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== ПРАЙСИНГ ===== */}
        <div className="border rounded p-3">
          <h2 className="text-lg font-semibold mb-3">{t("tb.pricing", { defaultValue: "Ценообразование" })}</h2>

          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.currency", { defaultValue: "Валюта" })}</label>
              <select className="border rounded px-2 py-2 w-full" value={currency} onChange={(e)=>setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="UZS">UZS</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.markup", { defaultValue: "Наценка, %" })}</label>
              <input type="number" min={0} className="border rounded px-2 py-2 w-full" value={markupPct} onChange={(e)=>setMarkupPct(e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT, %</label>
              <input type="number" min={0} className="border rounded px-2 py-2 w-full" value={vatPct} onChange={(e)=>setVatPct(e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.tourist_fee", { defaultValue: "Туристический сбор / ночь" })}</label>
              <input type="number" min={0} className="border rounded px-2 py-2 w-full" value={touristFeePerNight} onChange={(e)=>setTouristFeePerNight(e.target.value)}/>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mt-4 text-sm">
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
              <div className="font-medium mb-2">{t("tb.total", { defaultValue: "Суммарно" })}</div>
              <div className="flex justify-between"><span>NET</span><span>{netTotal.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ Markup</span><span>{grossBeforeVat.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ VAT</span><span>{vatAmount.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>+ Tourist fees</span><span>{touristFees.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>GRAND</span><span>{grandTotal.toFixed(2)} {currency}</span></div>
            </div>
          </div>
        </div>

        {/* ===== СФОРМИРОВАТЬ ПРОГРАММУ ===== */}
        <div className="flex justify-end">
          <button type="button" onClick={generateProgram} className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
            {t("tourBuilder.generate", { defaultValue: "Сформировать программу" })}
          </button>
        </div>

        {/* Результат */}
        {programJSON && (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-2">{t("tourBuilder.programText", { defaultValue: "Текстовая программа" })}</h3>
              <pre className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap">{programText}</pre>
            </div>
            <div>
              <h3 className="font-semibold mb-2">JSON</h3>
              <pre className="text-sm bg-gray-50 p-3 rounded border overflow-x-auto">{JSON.stringify(programJSON, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
