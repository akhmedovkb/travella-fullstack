//frontend/src/pages/HotelDetails.jsx

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api";
import ImageCarousel from "../components/ImageCarousel";

function Star({ filled }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      className={filled ? "text-amber-500" : "text-gray-300"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

function Stars({ value = 0, max = 7 }) {
  const n = Math.max(0, Math.min(max, Number(value) || 0));
  return (
    <div className="flex items-center gap-1" title={`${n} ★`}>
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} filled={i < n} />
      ))}
      <span className="ml-2 text-sm text-gray-500">{n > 0 ? `${n}★` : "—"}</span>
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b last:border-b-0">
      <div className="text-gray-500">{label}</div>
      <div className="text-gray-900">{children ?? "—"}</div>
    </div>
  );
}

function tryParseJSON(v) {
  if (!v || typeof v !== "string") return null;
  try {
    const obj = JSON.parse(v);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

export default function HotelDetails() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`, false);
        if (!alive) return;
        setHotel(data || null);
      } catch {
        if (alive) setHotel(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [hotelId]);

  const contacts = useMemo(() => {
    if (!hotel) return {};
    // поле может быть строкой, json-строкой, либо объектом
    const src =
      (typeof hotel.contact === "object" && hotel.contact) ||
      tryParseJSON(hotel.contact) ||
      {};

    const result = {};
    // если всё-таки просто текст — положим его как note
    if (typeof hotel.contact === "string" && !Object.keys(src).length) {
      result.note = hotel.contact;
    } else {
      Object.assign(result, src);
    }
    // небольшие алиасы
    result.phone = result.phone || result.tel || result.phoneNumber;
    result.email = result.email || result.mail;
    result.website = result.website || result.site || result.url;
    return result;
  }, [hotel]);

    // собираем все картинки (строки, объекты или JSON-строка с массивом)
  const images = useMemo(() => {
    const raw = hotel?.images;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const parsed = tryParseJSON(raw);
    if (Array.isArray(parsed)) return parsed;
    return [raw]; // одиночная строка
  }, [hotel]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="animate-pulse h-6 w-64 bg-gray-200 rounded mb-4" />
        <div className="h-48 bg-gray-100 rounded-xl mb-6" />
        <div className="space-y-3">
          <div className="h-4 bg-gray-100 rounded" />
          <div className="h-4 bg-gray-100 rounded" />
          <div className="h-4 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-white border rounded-xl p-6">
          <div className="text-lg">Отель не найден</div>
          <Link to="/hotels" className="text-orange-600 underline mt-3 inline-block">
            ← К списку отелей
          </Link>
        </div>
      </div>
    );
  }

  const fullAddress = [hotel.address, hotel.city || hotel.location, hotel.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {/* Шапка */}
        <div className="p-5 border-b">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{hotel.name}</h1>
              <div className="text-gray-500">
                {hotel.city || hotel.location || "—"}
                {hotel.country ? `, ${hotel.country}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/hotels/${hotel.id}/inspections`}
                className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
              >
                Смотреть инспекции
              </Link>
              <Link
                to={`/hotels/${hotel.id}/inspections?new=1`}
                className="px-3 py-2 rounded bg-gray-900 hover:bg-black text-white"
              >
                Оставить свою инспекцию
              </Link>
            </div>
          </div>
        </div>

        {/* Контент */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-[340px_1fr] gap-5">
                    <div>
            <ImageCarousel images={images} />
            <div className="mt-3">
              <Stars value={hotel.stars} />
            </div>
          </div>

          <div className="bg-white rounded-lg">
            <InfoRow label="Адрес">
              {fullAddress || "—"}
            </InfoRow>

            <InfoRow label="Контакт">
              {contacts.phone || contacts.email || contacts.website || contacts.note ? (
                <div className="space-y-1">
                  {contacts.phone && <div>Телефон: <a href={`tel:${contacts.phone}`} className="text-blue-600 hover:underline">{contacts.phone}</a></div>}
                  {contacts.email && <div>E-mail: <a href={`mailto:${contacts.email}`} className="text-blue-600 hover:underline">{contacts.email}</a></div>}
                  {contacts.website && (
                    <div>
                      Сайт:{" "}
                      <a
                        href={/^https?:\/\//i.test(contacts.website) ? contacts.website : `https://${contacts.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {contacts.website}
                      </a>
                    </div>
                  )}
                  {contacts.note && <div className="text-gray-700">{contacts.note}</div>}
                </div>
              ) : (
                "—"
              )}
            </InfoRow>

            {/* при желании можно добавить удобства / услуги */}
            {/* <InfoRow label="Удобства">{Array.isArray(hotel.amenities) ? hotel.amenities.join(", ") : "—"}</InfoRow> */}
          </div>
        </div>
      </div>
    </div>
  );
}
