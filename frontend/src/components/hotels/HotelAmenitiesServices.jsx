import React from "react";
import { AMENITIES, SERVICES } from "../../constants/hotelDicts";

function Checklist({ title, dict, value = [], onChange }) {
  const set = new Set(value);
  const toggle = (k) => {
    if (set.has(k)) set.delete(k); else set.add(k);
    onChange?.([...set]);
  };
  return (
    <div className="border rounded-lg p-4">
      <div className="font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {dict.map(item => (
          <label key={item.key} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={set.has(item.key)} onChange={() => toggle(item.key)} />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function HotelAmenitiesServices({ amenities, services, onAmenities, onServices }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Checklist title="Удобства" dict={AMENITIES} value={amenities} onChange={onAmenities} />
      <Checklist title="Услуги"   dict={SERVICES}  value={services}  onChange={onServices} />
    </div>
  );
}
