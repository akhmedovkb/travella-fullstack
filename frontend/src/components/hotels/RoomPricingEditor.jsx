import React from "react";
import { ROOM_TYPES } from "../../constants/hotelDicts";

// простая формула для автозаполнения
const RATIO = { double: 1.2, triple: 1.5, quadruple: 1.8 };

export default function RoomPricingEditor({ value = [], onChange, currency = "USD" }) {
  const map = new Map(value.map(v => [v.type, Number(v.basePrice) || 0]));
  const setPrice = (type, price) => {
    const num = Number(price);
    const next = ROOM_TYPES.map(rt => ({
      type: rt.code,
      currency,
      basePrice: rt.code === type ? num : (map.get(rt.code) || 0),
    })).filter(x => Number.isFinite(x.basePrice) && x.basePrice > 0);
    onChange?.(next);
  };

  const fillFromSingle = () => {
    const s = map.get("single");
    if (!s || s <= 0) return;
    const next = ROOM_TYPES.map(rt => {
      const curr = map.get(rt.code) || 0;
      let v = curr;
      if (!curr || curr <= 0) {
        if (rt.code in RATIO) v = Math.round(s * RATIO[rt.code]);
        else if (rt.code === "suite" || rt.code === "family") v = Math.round(s * 1.8);
      }
      return { type: rt.code, currency, basePrice: v };
    }).filter(x => x.basePrice > 0);
    onChange?.(next);
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold mb-2">Базовые цены (за ночь)</div>
        <button type="button" onClick={fillFromSingle}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
          Заполнить пустые по Single
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ROOM_TYPES.map(rt => (
          <label key={rt.code} className="flex items-center justify-between gap-3 border rounded px-3 py-2">
            <span className="text-sm">{rt.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs">{currency}</span>
              <input
                type="number" min="0" step="1"
                className="w-28 border rounded px-2 py-1 text-right"
                value={map.get(rt.code) || ""}
                onChange={e => setPrice(rt.code, e.target.value)}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
