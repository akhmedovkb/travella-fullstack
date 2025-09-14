// frontend/src/components/HotelCard.jsx
import { Link } from "react-router-dom";

export default function HotelCard({ hotel }) {
  const cover = hotel?.images?.[0];
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 flex gap-4">
      <div className="w-32 h-24 bg-gray-100 rounded overflow-hidden flex-shrink-0">
        {cover ? (
          <img src={cover} alt={hotel.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-gray-400 text-xs">NO IMAGE</div>
        )}
      </div>

      <div className="flex-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link to={`/hotels/${hotel.id}`} className="text-lg font-semibold hover:underline">
              {hotel.name}
            </Link>
            <div className="text-sm text-gray-600">
              {hotel.city ? `${hotel.city}, ` : ""}{hotel.country}
            </div>
            {hotel.address && <div className="text-xs text-gray-500">{hotel.address}</div>}
          </div>
          <div className="text-right">
            {Number.isFinite(hotel.rating) && (
              <div className="text-sm font-medium">★ {Number(hotel.rating).toFixed(1)}</div>
            )}
            <Link
              to={`/hotels/${hotel.id}/inspections`}
              className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              Инспекции: {hotel.inspections_count ?? 0}
            </Link>
          </div>
        </div>

        {Array.isArray(hotel.amenities) && hotel.amenities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hotel.amenities.slice(0, 6).map((a, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">{a}</span>
            ))}
            {hotel.amenities.length > 6 && <span className="text-[11px] text-gray-500">+{hotel.amenities.length - 6}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
