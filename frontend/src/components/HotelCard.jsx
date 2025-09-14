// frontend/src/components/HotelCard.jsx
import { Link } from "react-router-dom";

export default function HotelCard({ hotel }) {
  const cover = hotel?.images?.[0];

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 flex gap-4">
      <Link to={`/hotels/${hotel.id}`} className="w-44 h-32 rounded overflow-hidden flex-shrink-0 bg-gray-100">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Нет фото</div>
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/hotels/${hotel.id}`} className="text-lg font-semibold hover:underline truncate">
            {hotel.name}
          </Link>
          {typeof hotel.rating === "number" && (
            <div className="text-sm px-2 py-0.5 rounded bg-green-600 text-white flex-shrink-0">
              {hotel.rating.toFixed(1)}
            </div>
          )}
        </div>

        <div className="text-sm text-gray-600 mt-0.5">
          {[hotel.country, hotel.city, hotel.address].filter(Boolean).join(" • ")}
        </div>

        {Array.isArray(hotel.amenities) && hotel.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {hotel.amenities.slice(0, 6).map((a, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-gray-100 rounded">{a}</span>
            ))}
            {hotel.amenities.length > 6 && (
              <span className="text-[11px] px-2 py-0.5 bg-gray-100 rounded">+{hotel.amenities.length - 6}</span>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Link
            to={`/hotels/${hotel.id}`}
            className="px-3 py-1.5 rounded bg-orange-600 text-white text-sm"
          >
            Детали
          </Link>
          <Link
            to={`/hotels/${hotel.id}/inspections`}
            className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm"
          >
            Инспекции
          </Link>
        </div>
      </div>
    </div>
  );
}
