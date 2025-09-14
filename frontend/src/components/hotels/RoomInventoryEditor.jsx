import React from "react";
import { ROOM_TYPES } from "../../constants/hotelDicts";

export default function RoomInventoryEditor({ value = [], onChange }) {
  const map = new Map(value.map(v => [v.type, v.count]));
  const setCount = (type, count) => {
    const num = Math.max(0, Number.parseInt(count || "0", 10) || 0);
    const next = ROOM_TYPES.map(rt => ({
      type: rt.code,
      count: rt.code === type ? num : (map.get(rt.code) || 0),
    })).filter(x => x.count > 0);
    onChange?.(next);
  };

  const total = value.reduce((s, x) => s + (Number(x.count) || 0), 0);

  return (
    <div className="border rounded-lg p-4">
      <div className="font-semibold mb-2">Номерной фонд</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ROOM_TYPES.map(rt => (
          <label key={rt.code} className="flex items-center justify-between gap-3 border rounded px-3 py-2">
            <span className="text-sm">
              {rt.label}
              <span className="text-gray-500 text-xs ml-2">
                (вместимость {rt.baseCapacity}–{rt.maxCapacity})
              </span>
            </span>
            <input
              type="number" min="0" step="1"
              className="w-24 border rounded px-2 py-1 text-right"
              value={map.get(rt.code) || 0}
              onChange={e => setCount(rt.code, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 text-sm text-gray-600">
        Итого номеров: <span className="font-semibold text-gray-800">{total}</span>
      </div>
    </div>
  );
}
