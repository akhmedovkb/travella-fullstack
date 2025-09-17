// frontend/src/pages/TourBuilder.jsx
import React, { useCallback, useMemo, useState } from "react";
import AsyncSelect from "react-select/async";
import CreatableSelect from "react-select/creatable";
import { useTranslation } from "react-i18next";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

// --- Leaflet marker icons fix for Vite bundling ---
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

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

export default function TourBuilder() {
  const { t } = useTranslation();

  // форма
  const [arrivalTimeDay1, setArrivalTimeDay1] = useState("");
  const [cities, setCities] = useState([]); // [{value,label,lat,lng,countryName}]
  const [rooming, setRooming] = useState(ROOMING_TYPES.reduce((a,k)=>((a[k]=0),a),{}));
  const [guide, setGuide] = useState(false);
  const [transport, setTransport] = useState(false);
  const [monuments, setMonuments] = useState([]);

  // пер-сегментные данные
  const [segmentTimes, setSegmentTimes] = useState({});   // idx -> {dep, arr}
  const [segmentExtras, setSegmentExtras] = useState({}); // idx -> [{value,label}]

  const [programJSON, setProgramJSON] = useState(null);
  const [programText, setProgramText] = useState("");

  // ====== города (GeoNames) ======
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

  // сегменты A→B по порядку городов
  const segments = useMemo(() => {
    const res = [];
    for (let i = 0; i < cities.length - 1; i++) res.push({ idx: i, from: cities[i], to: cities[i + 1] });
    return res;
  }, [cities]);

  const mapCenter = useMemo(() => {
    const first = cities.find(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    return first ? [first.lat, first.lng] : DEFAULT_CENTER;
  }, [cities]);

  // handlers
  const onRoomingChange = (key, val) => setRooming((p) => ({ ...p, [key]: Math.max(0, toNum(val, 0)) }));
  const onMarkerDrag = (index, e) => {
    const { lat, lng } = e.target.getLatLng();
    setCities((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], lat, lng };
      return copy;
    });
  };
  const onSegmentTimeChange = (idx, field, value) =>
    setSegmentTimes((p) => ({ ...p, [idx]: { ...(p[idx] || {}), [field]: value } }));
  const onSegmentExtrasChange = (idx, vals) =>
    setSegmentExtras((p) => ({ ...p, [idx]: vals || [] }));

  // dnd reorder
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

  // построить программу
  const generateProgram = () => {
    const program = {
      arrivalTimeDay1,
      guide,
      transport,
      rooming,
      monuments: (monuments || []).map((m) => m.label),
      cities: cities.map((c) => ({ id: c.value, name: c.label, lat: c.lat, lng: c.lng, country: c.countryName })),
      segments: segments.map((s) => ({
        from: { id: s.from.value, name: s.from.label, lat: s.from.lat, lng: s.from.lng },
        to:   { id: s.to.value,   name: s.to.label,   lat: s.to.lat,   lng: s.to.lng },
        time: segmentTimes[s.idx] || { dep: "", arr: "" },
        extras: (segmentExtras[s.idx] || []).map((x) => x.label),
      })),
      createdAt: new Date().toISOString(),
    };

    const lines = [];
    lines.push(`Day 1 arrival: ${arrivalTimeDay1 || "-"}`);
    lines.push(`Guide: ${guide ? "yes" : "no"}; Transport: ${transport ? "yes" : "no"}`);
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
    setProgramJSON(program);
    setProgramText(lines.join("\n"));
  };

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t("tourBuilder.title", { defaultValue: "Конструктор тура" })}</h1>

        {/* ===== ФОРМА ===== */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* 1. время прибытия первого дня */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("tourBuilder.arrivalDay1", { defaultValue: "Время прибытия первого дня" })}
            </label>
            <input type="time" value={arrivalTimeDay1} onChange={(e)=>setArrivalTimeDay1(e.target.value)} className="w-full border rounded px-3 py-2"/>
          </div>

          {/* 5. monuments entry fees (multiselect с возможностью добавлять свои) */}
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

          {/* 3-4. гид / транспорт */}
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={guide} onChange={(e)=>setGuide(e.target.checked)}/>
              <span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={transport} onChange={(e)=>setTransport(e.target.checked)}/>
              <span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span>
            </label>
          </div>

          {/* 2. Города (multiselect) */}
          <div className="md:col-span-2">
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

          {/* 2. rooming */}
          <div className="md:col-span-2">
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
