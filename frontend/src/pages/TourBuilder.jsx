// frontend/src/pages/TourBuilder.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncSelect from "react-select/async";
import { components as SelectComponents } from "react-select";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

// -------- CONFIG --------
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// -------- small utils --------
const toNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const toYMD = (d) => (d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) : "");
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => toYMD(a) === toYMD(b);

// entry-fees helpers
const HOLIDAYS = []; // например ["2025-01-01"]
const dkey = (d) => new Date(d).toISOString().slice(0, 10);
const isWeekend = (d) => [0, 6].includes(new Date(d).getDay());
const isHoliday = (d) => HOLIDAYS.includes(dkey(d));
const dayKind = (d) => (isHoliday(d) ? "hd" : isWeekend(d) ? "we" : "wk");

// -------- transport/guide/hotel fetching --------
const fetchJSON = async (path, params = {}) => {
  const u = new URL(path, API_BASE || window.frontend?.API_BASE || "");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), { credentials: "include" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
};

const normalizeProvider = (row, kind) => ({
  id: row.id ?? row._id ?? String(Math.random()),
  name: row.name || "—",
  kind,
  phone: row.phone || "",
  email: row.email || "",
  location: row.location || row.city || "",
  price_per_day: toNum(row.price_per_day ?? row.price ?? row.rate_day ?? 0, 0),
  currency: row.currency || "USD",
});

async function fetchProvidersSmart({ kind, city, date, q = "", limit = 30 }) {
  const tries = [
    { url: "/api/providers/search", params: { type: kind, location: city, date, q, limit } },
    { url: `/api/${kind}s/available`, params: { city, date, limit } },
    { url: "/api/providers", params: { type: kind, location: city, q, limit } },
  ];
  for (const t of tries) {
    try {
      const j = await fetchJSON(t.url, t.params);
      const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      if (arr.length) return arr.map((x) => normalizeProvider(x, kind));
    } catch (e) {
      // console.warn("providers fetch failed:", t.url, e);
    }
  }
  return [];
}

const normalizeHotel = (row) => ({
  id: row.id ?? row._id ?? row.hotel_id ?? String(Math.random()),
  name: row.name || row.title || "Hotel",
  city: row.city || row.location || "",
  price: toNum(row.price ?? row.net ?? row.price_per_night ?? 0, 0), // за ночь (нетто)
  currency: row.currency || "USD",
});

async function fetchHotelsSmart({ city, date, q = "", limit = 30 }) {
  const tries = [
    { url: "/api/hotels/search", params: { city, date, name: q, limit } },
    { url: "/api/hotels", params: { city, q, limit } },
  ];
  for (const t of tries) {
    try {
      const j = await fetchJSON(t.url, t.params);
      const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      if (arr.length) return arr.map((x) => normalizeHotel(x));
    } catch (e) {}
  }
  return [];
}

// Entry fees directory
async function fetchEntryFees({ q = "", city = "", limit = 50 } = {}) {
  try {
    const j = await fetchJSON("/api/entry-fees", { q, city, limit });
    return Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

// -------- custom option with tooltip --------
const ProviderOption = (props) => {
  const p = props.data?.raw;
  const tip = [
    p?.name,
    p?.location ? `Город: ${p.location}` : "",
    p?.phone ? `Тел.: ${p.phone}` : "",
    p?.email ? `E-mail: ${p.email}` : "",
    typeof p?.price_per_day === "number" && p?.price_per_day > 0
      ? `Цена/день: ${p.price_per_day} ${p.currency || "USD"}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div title={tip}>
      <SelectComponents.Option {...props} />
    </div>
  );
};

const HotelOption = (props) => {
  const h = props.data?.raw;
  const tip = [
    h?.name,
    h?.city ? `Город: ${h.city}` : "",
    typeof h?.price === "number" && h?.price > 0 ? `Цена/ночь: ${h.price} ${h.currency || "USD"}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div title={tip}>
      <SelectComponents.Option {...props} />
    </div>
  );
};

// =========================================================

export default function TourBuilder() {
  // даты тура
  const [range, setRange] = useState({ from: undefined, to: undefined });

  // pax
  const [adt, setAdt] = useState(2);
  const [chd, setChd] = useState(0);
  const payingPax = useMemo(() => Math.max(1, toNum(adt, 0) + toNum(chd, 0)), [adt, chd]);

  // резидентство для entry fees
  const [residentType, setResidentType] = useState("nrs"); // "nrs" | "res"

  // список дней
  const days = useMemo(() => {
    if (!range.from || !range.to) return [];
    const res = [];
    let d = new Date(range.from);
    while (d <= range.to) {
      res.push(new Date(d));
      d = addDays(d, 1);
    }
    return res;
  }, [range.from, range.to]);

  // состояние по каждому дню
  // { [dateKey]: { city, guide, transport, hotel, entrySelected[] } }
  const [byDay, setByDay] = useState({});
  useEffect(() => {
    // инициализируем записи для видимых дней
    setByDay((prev) => {
      const copy = { ...prev };
      days.forEach((d, i) => {
        const k = toYMD(d);
        if (!copy[k]) copy[k] = { city: "", guide: null, transport: null, hotel: null, entrySelected: [] };
      });
      // подчистим удалённые дни
      Object.keys(copy).forEach((k) => {
        if (!days.find((d) => toYMD(d) === k)) delete copy[k];
      });
      return copy;
    });
  }, [days]);

  // ===== entry fees state (общий поиск) =====
  const [entryQ, setEntryQ] = useState("");
  const [entryOptions, setEntryOptions] = useState([]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const items = await fetchEntryFees({ q: entryQ, limit: 50 });
      setEntryOptions(
        items.map((x) => ({
          value: x.id,
          label: `${x.name_ru || x.name_en || x.name_uz || "—"}${x.city ? " — " + x.city : ""} (${x.currency || "UZS"})`,
          raw: x,
        }))
      );
    }, 250);
    return () => clearTimeout(t);
  }, [entryQ]);

  // ===== loaders for a specific day =====
  const makeGuideLoader = (dateKey) =>
    async (input, cb) => {
      const day = byDay[dateKey] || {};
      const rows = await fetchProvidersSmart({
        kind: "guide",
        city: day.city || "",
        date: dateKey,
        q: input?.trim() || "",
      });
      cb(
        rows.map((p) => ({
          value: p.id,
          label: p.name,
          raw: p,
        }))
      );
    };

  const makeTransportLoader = (dateKey) =>
    async (input, cb) => {
      const day = byDay[dateKey] || {};
      const rows = await fetchProvidersSmart({
        kind: "transport",
        city: day.city || "",
        date: dateKey,
        q: input?.trim() || "",
      });
      cb(
        rows.map((p) => ({
          value: p.id,
          label: p.name,
          raw: p,
        }))
      );
    };

  const makeHotelLoader = (dateKey) =>
    async (input, cb) => {
      const day = byDay[dateKey] || {};
      const rows = await fetchHotelsSmart({
        city: day.city || "",
        date: dateKey,
        q: input?.trim() || "",
      });
      cb(
        rows.map((h) => ({
          value: h.id,
          label: `${h.name}${h.city ? " — " + h.city : ""}`,
          raw: h,
        }))
      );
    };

  // ===== prices =====
  const entryCell = (siteRaw, kind, pax) => {
    const key = `${kind}_${residentType}_${pax}`; // wk|we|hd + nrs/res + adult|child
    const v = Number(siteRaw?.[key] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };

  const calcEntryForDay = (dateKey) => {
    const d = new Date(dateKey);
    const kind = dayKind(d);
    const day = byDay[dateKey] || {};
    const sel = day.entrySelected || [];
    let sum = 0;
    for (const opt of sel) {
      const s = opt.raw;
      sum += toNum(adt, 0) * entryCell(s, kind, "adult");
      sum += toNum(chd, 0) * entryCell(s, kind, "child");
    }
    return sum;
  };

  const calcGuideForDay = (dateKey) => toNum(byDay[dateKey]?.guide?.price_per_day, 0);
  const calcTransportForDay = (dateKey) => toNum(byDay[dateKey]?.transport?.price_per_day, 0);
  const calcHotelForDay = (dateKey) => toNum(byDay[dateKey]?.hotel?.price, 0);

  const totals = useMemo(() => {
    let guide = 0,
      transport = 0,
      hotel = 0,
      entries = 0;
    Object.keys(byDay).forEach((k) => {
      guide += calcGuideForDay(k);
      transport += calcTransportForDay(k);
      hotel += calcHotelForDay(k);
      entries += calcEntryForDay(k);
    });
    const net = guide + transport + hotel + entries;
    return { guide, transport, hotel, entries, net, perPax: net / payingPax };
  }, [byDay, adt, chd, residentType, payingPax]);

  // ===== render =====
  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">Конструктор тура</h1>

        {/* даты + pax + resident */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Даты тура</label>
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={2}
              disabled={{ before: new Date() }}
              className="text-sm"
            />
            <p className="text-sm text-gray-600 mt-2">
              {range.from && range.to ? `${toYMD(range.from)} — ${toYMD(range.to)} • ${days.length} дн.` : "Выберите даты начала и конца"}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium mb-1">PAX</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm flex items-center gap-2">
                  <span className="w-10">ADT</span>
                  <input type="number" min={0} value={adt} onChange={(e) => setAdt(e.target.value)} className="h-9 w-full border rounded px-2 text-sm" />
                </label>
                <label className="text-sm flex items-center gap-2">
                  <span className="w-10">CHD</span>
                  <input type="number" min={0} value={chd} onChange={(e) => setChd(e.target.value)} className="h-9 w-full border rounded px-2 text-sm" />
                </label>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Тарифы для</div>
              <label className="inline-flex items-center gap-2 mr-4">
                <input type="radio" checked={residentType === "nrs"} onChange={() => setResidentType("nrs")} />
                <span>Нерезиденты</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={residentType === "res"} onChange={() => setResidentType("res")} />
                <span>Резиденты</span>
              </label>
            </div>
          </div>
        </div>

        {/* дни */}
        <div className="space-y-6">
          {days.map((d, i) => {
            const k = toYMD(d);
            const st = byDay[k] || {};
            return (
              <div key={k} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="font-semibold">D{i + 1}</div>
                  <input
                    className="border rounded px-3 py-2 min-w-[220px] flex-1"
                    placeholder="Город (например, Tashkent)"
                    value={st.city || ""}
                    onChange={(e) => setByDay((p) => ({ ...p, [k]: { ...p[k], city: e.target.value } }))}
                  />
                  <div className="text-sm text-gray-500">{k}</div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {/* Гид */}
                  <div className="border rounded p-2">
                    <label className="block text-sm font-medium mb-1">Гид</label>
                    <AsyncSelect
                      cacheOptions
                      defaultOptions
                      loadOptions={makeGuideLoader(k)}
                      components={{ Option: ProviderOption }}
                      placeholder="Выберите гида"
                      noOptionsMessage={() => "Провайдеров не найдено"}
                      value={
                        st.guide
                          ? { value: st.guide.id, label: st.guide.name, raw: st.guide }
                          : null
                      }
                      onChange={(opt) => setByDay((p) => ({ ...p, [k]: { ...p[k], guide: opt?.raw || null } }))}
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      Цена/день: {toNum(st.guide?.price_per_day, 0).toFixed(2)} {st.guide?.currency || "USD"}
                    </div>
                  </div>

                  {/* Транспорт */}
                  <div className="border rounded p-2">
                    <label className="block text-sm font-medium mb-1">Транспорт</label>
                    <AsyncSelect
                      cacheOptions
                      defaultOptions
                      loadOptions={makeTransportLoader(k)}
                      components={{ Option: ProviderOption }}
                      placeholder="Выберите транспорт"
                      noOptionsMessage={() => "Провайдеров не найдено"}
                      value={
                        st.transport
                          ? { value: st.transport.id, label: st.transport.name, raw: st.transport }
                          : null
                      }
                      onChange={(opt) => setByDay((p) => ({ ...p, [k]: { ...p[k], transport: opt?.raw || null } }))}
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      Цена/день: {toNum(st.transport?.price_per_day, 0).toFixed(2)} {st.transport?.currency || "USD"}
                    </div>
                  </div>

                  {/* Отель */}
                  <div className="border rounded p-2">
                    <label className="block text-sm font-medium mb-1">Отель (за ночь, нетто)</label>
                    <AsyncSelect
                      cacheOptions
                      defaultOptions
                      loadOptions={makeHotelLoader(k)}
                      components={{ Option: HotelOption }}
                      placeholder="Выберите отель"
                      noOptionsMessage={() => "Нет вариантов"}
                      value={
                        st.hotel
                          ? { value: st.hotel.id, label: `${st.hotel.name}${st.hotel.city ? " — " + st.hotel.city : ""}`, raw: st.hotel }
                          : null
                      }
                      onChange={(opt) => setByDay((p) => ({ ...p, [k]: { ...p[k], hotel: opt?.raw || null } }))}
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      Цена/ночь: {toNum(st.hotel?.price, 0).toFixed(2)} {st.hotel?.currency || "USD"}
                    </div>
                  </div>

                  {/* Entry fees (объекты) */}
                  <div className="border rounded p-2">
                    <label className="block text-sm font-medium mb-1">Входные билеты (объекты)</label>
                    <input
                      className="w-full border rounded px-3 py-2 mb-2"
                      placeholder="Начните вводить объект/город…"
                      value={entryQ}
                      onChange={(e) => setEntryQ(e.target.value)}
                    />
                    <AsyncSelect
                      isMulti
                      cacheOptions
                      defaultOptions={entryOptions}
                      loadOptions={(input, cb) => cb(entryOptions)}
                      value={st.entrySelected || []}
                      onChange={(vals) => setByDay((p) => ({ ...p, [k]: { ...p[k], entrySelected: vals || [] } }))}
                      placeholder="Выберите объекты"
                      noOptionsMessage={() => "Ничего не найдено"}
                    />

                    <div className="text-xs text-gray-600 mt-1">
                      На этот день: {calcEntryForDay(k).toFixed(2)} (учтены ADT/CHD и статус резидента)
                    </div>
                  </div>
                </div>

                <div className="text-sm text-gray-700">
                  Итого по дню: Гид {calcGuideForDay(k).toFixed(2)} + Транспорт {calcTransportForDay(k).toFixed(2)} + Отель{" "}
                  {calcHotelForDay(k).toFixed(2)} + Entry {calcEntryForDay(k).toFixed(2)} ={" "}
                  <b>
                    {(calcGuideForDay(k) + calcTransportForDay(k) + calcHotelForDay(k) + calcEntryForDay(k)).toFixed(2)} USD
                  </b>
                </div>
              </div>
            );
          })}
        </div>

        {/* суммирование */}
        <div className="grid md:grid-cols-5 gap-3 text-sm">
          <div className="bg-gray-50 rounded p-3 border">
            <div className="font-medium mb-1">Гид (нетто)</div>
            <div>{totals.guide.toFixed(2)} USD</div>
          </div>
          <div className="bg-gray-50 rounded p-3 border">
            <div className="font-medium mb-1">Транспорт (нетто)</div>
            <div>{totals.transport.toFixed(2)} USD</div>
          </div>
          <div className="bg-gray-50 rounded p-3 border">
            <div className="font-medium mb-1">Отели (нетто)</div>
            <div>{totals.hotel.toFixed(2)} USD</div>
          </div>
          <div className="bg-gray-50 rounded p-3 border">
            <div className="font-medium mb-1">Entry fees (нетто)</div>
            <div>{totals.entries.toFixed(2)} USD</div>
          </div>
          <div className="bg-gray-50 rounded p-3 border">
            <div className="font-semibold">ИТОГО</div>
            <div className="flex justify-between"><span>NET</span><span>{totals.net.toFixed(2)} USD</span></div>
            <div className="flex justify-between mt-1"><span>/ pax</span><span>{totals.perPax.toFixed(2)} USD</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
