// frontend/src/components/RoomPicker.jsx
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = (p) => (import.meta.env.VITE_API_BASE_URL || '') + p;

function detectSeason(dateISO, seasons, def='low') {
  // dateISO: 'YYYY-MM-DD'
  const d = new Date(dateISO + 'T00:00:00Z');
  for (const s of seasons) {
    const a = new Date(s.start_date + 'T00:00:00Z');
    const b = new Date(s.end_date   + 'T23:59:59Z');
    if (d >= a && d <= b) return s.label;
  }
  return def;
}

export default function RoomPicker({
  hotelId,
  nightDates,           // массив 'YYYY-MM-DD' (каждая ночь тура)
  resident,             // true => resident, false => nonResident
  meal = 'BB',          // выбранный план питания
  onTotalChange,        // (totalUSD:number) => void
}) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [sel, setSel] = useState({}); // { [type]: qty }

  useEffect(() => {
    if (!hotelId) return;
    (async () => {
      setLoading(true);
      try {
        const [b, s] = await Promise.all([
          axios.get(API(`/api/hotels/${hotelId}/brief`)).then(r => r.data),
          axios.get(API(`/api/hotels/${hotelId}/seasons`)).then(r => r.data),
        ]);
        setBrief(b);
        setSeasons(s);
        setSel({}); // сброс выбора при смене отеля
      } finally { setLoading(false); }
    })();
  }, [hotelId]);

  const currency = brief?.currency || 'USD';
  const rooms = brief?.rooms || [];
  const whoKey = resident ? 'resident' : 'nonResident';

  const total = useMemo(() => {
    if (!brief) return 0;
    let sum = 0;
    for (const night of nightDates || []) {
      const season = detectSeason(night, seasons, brief.default_season || 'low'); // 'low'|'high'
      let perNight = 0;
      for (const r of rooms) {
        const qty = Number(sel[r.type] || 0);
        if (!qty) continue;
        const price = Number(r?.prices?.[season]?.[whoKey]?.[meal] ?? 0);
        perNight += qty * price;
      }
      sum += perNight;
    }
    return sum;
  }, [brief, seasons, nightDates, sel, meal, whoKey]);

  useEffect(() => { onTotalChange?.(total); }, [total, onTotalChange]);

  if (!hotelId) return null;
  if (loading) return <div className="text-sm text-gray-500">Loading rooms…</div>;
  if (!rooms.length) return <div className="text-sm text-gray-500">Нет номерного фонда</div>;

  return (
    <div className="mt-3 border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{brief?.name}</div>
        <div className="text-sm text-gray-600">Валюта прайса: {currency}</div>
      </div>

      <div className="space-y-2">
        {rooms.filter(r => (r.count || 0) > 0).map((r) => (
          <div key={r.type} className="flex items-center gap-3">
            <div className="w-40">{r.type}</div>
            <div className="text-xs text-gray-500 w-40">доступно: {r.count}</div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 border rounded"
                onClick={() => setSel(s => ({ ...s, [r.type]: Math.max(0, (s[r.type]||0)-1) }))}
              >−</button>
              <input
                className="w-16 text-center border rounded py-1"
                type="number"
                min={0}
                max={r.count}
                value={sel[r.type] || 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(Number(r.count||0), Number(e.target.value||0)));
                  setSel(s => ({ ...s, [r.type]: v }));
                }}
              />
              <button
                type="button"
                className="px-2 py-1 border rounded"
                onClick={() => setSel(s => ({ ...s, [r.type]: Math.min(r.count||0, (s[r.type]||0)+1) }))}
              >+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t pt-2 text-right font-semibold">
        Итого за проживание: {total.toFixed(2)} {currency}
      </div>
      {/* Если нужен USD всегда – здесь можно конвертировать по курсу, или сохранять валюту=USD */}
    </div>
  );
}
