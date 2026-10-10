import React, { useId, useMemo } from "react";

export const VEHICLE_MODELS = [
  ["Chevrolet Cobalt", 4], ["Chevrolet Gentra", 4], ["Chevrolet Lacetti", 4], ["Chevrolet Nexia 3", 4],
  ["Chevrolet Spark", 4], ["Chevrolet Onix", 4], ["Chevrolet Tracker", 4], ["Chevrolet Malibu 2", 4],
  ["Chevrolet Captiva", 6], ["Chevrolet Equinox", 4], ["Chevrolet Traverse", 7], ["Chevrolet Tahoe", 7],
  ["Chevrolet Orlando", 6], ["Chevrolet Damas", 7], ["Chevrolet Labo", 2],
  ["BYD Song Plus", 4], ["BYD Chazor", 4], ["BYD Han", 4], ["BYD Yuan Up", 4], ["BYD E2", 4],
  ["Kia K5", 4], ["Kia K8", 4], ["Kia Sportage", 4], ["Kia Sorento", 6], ["Kia Carnival", 7],
  ["Hyundai Elantra", 4], ["Hyundai Sonata", 4], ["Hyundai Tucson", 4], ["Hyundai Santa Fe", 6],
  ["Hyundai Staria", 7], ["Hyundai H-1", 7], ["Hyundai Grand Starex", 7],
  ["Toyota Camry", 4], ["Toyota Corolla", 4], ["Toyota RAV4", 4], ["Toyota Highlander", 6],
  ["Toyota Land Cruiser 200", 7], ["Toyota Land Cruiser 300", 7], ["Toyota Prado", 7],
  ["Toyota Alphard", 6], ["Toyota Hiace", 12], ["Toyota Coaster", 22],
  ["Mercedes-Benz E-Class", 4], ["Mercedes-Benz S-Class", 4], ["Mercedes-Benz V-Class", 6],
  ["Mercedes-Benz Vito", 7], ["Mercedes-Benz Sprinter", 18],
  ["Volkswagen Passat", 4], ["Volkswagen Tiguan", 4], ["Volkswagen Touareg", 4],
  ["Volkswagen Caddy", 6], ["Volkswagen Caravelle", 7], ["Volkswagen Crafter", 18],
  ["Ford Mondeo", 4], ["Ford Explorer", 6], ["Ford Tourneo Custom", 8], ["Ford Transit", 17],
  ["Renault Duster", 4], ["Renault Koleos", 4], ["Nissan Qashqai", 4], ["Nissan X-Trail", 6],
  ["Nissan Patrol", 7], ["Lexus ES", 4], ["Lexus RX", 4], ["Lexus LX 570", 7], ["Lexus LX 600", 7],
  ["BMW 5 Series", 4], ["BMW 7 Series", 4], ["BMW X5", 4], ["BMW X7", 6],
  ["Audi A6", 4], ["Audi A8", 4], ["Audi Q7", 6], ["Honda Accord", 4], ["Honda CR-V", 4],
  ["Chery Tiggo 7 Pro", 4], ["Chery Tiggo 8 Pro", 6], ["Haval Jolion", 4], ["Haval H6", 4],
  ["Geely Monjaro", 4], ["Geely Coolray", 4], ["Jetour X70", 6], ["Jetour X90", 6],
  ["Zeekr 001", 4], ["Zeekr 009", 6], ["Li Auto L7", 4], ["Li Auto L9", 6],
  ["Hongqi H5", 4], ["Hongqi E-HS9", 6], ["GAC GS8", 6], ["JAC M4", 7],
  ["Isuzu NPR", 2], ["Isuzu SAZ", 45], ["Yutong ZK6122", 49], ["King Long XMQ6127", 49],
];

const normalize = (value) => String(value || "").trim().toLocaleLowerCase();

export default function VehicleModelInput({ value, onChange, onModelSelect, className = "", placeholder = "Начните вводить марку или модель" }) {
  const generatedId = useId();
  const listId = `vehicle-models-${generatedId.replace(/:/g, "")}`;
  const selected = useMemo(() => VEHICLE_MODELS.find(([name]) => normalize(name) === normalize(value)), [value]);

  const handleChange = (event) => {
    const nextValue = event.target.value;
    onChange?.(nextValue);
    const match = VEHICLE_MODELS.find(([name]) => normalize(name) === normalize(nextValue));
    if (match) onModelSelect?.({ model: match[0], seats: match[1] });
  };

  return (
    <>
      <input
        type="text"
        list={listId}
        value={value || ""}
        onChange={handleChange}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        aria-label="Марка и модель автомобиля"
      />
      <datalist id={listId}>
        {VEHICLE_MODELS.map(([model, seats]) => <option key={model} value={model}>{seats} пассажирских мест</option>)}
      </datalist>
      {selected ? <span className="sr-only">Выбрано: {selected[0]}</span> : null}
    </>
  );
}