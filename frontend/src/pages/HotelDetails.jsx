// frontend/src/pages/HotelDetails.jsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getHotel, createInspection } from "../api/hotels";
import { tSuccess, tError } from "../shared/toast";

function TextRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <span className="text-gray-500">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function HotelDetails() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // инспекция форма
  const [review, setReview] = useState("");
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [features, setFeatures] = useState("");
  const [media, setMedia] = useState([]); // dataURL изображений/видео (простая версия)

  useEffect(() => {
    (async () => {
      try {
        const h = await getHotel(hotelId);
        setHotel(h);
      } catch {
        setHotel(null);
      }
    })();
  }, [hotelId]);

  const onPickMedia = (e) => {
    const files = Array.from(e.target.files || []);
    const readers = files.map((f) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(f);
    }));
    Promise.all(readers).then((list) => setMedia((p) => [...p, ...list]));
    e.target.value = "";
  };

  const submitInspection = async () => {
    if (!review.trim()) return tError("Напишите отзыв");
    try {
      await createInspection(hotelId, {
        review: review.trim(),
        pros: pros.trim() || null,
        cons: cons.trim() || null,
        features: features.trim() || null,
        media,
      });
      tSuccess("Инспекция отправлена");
      setShowForm(false);
      setReview(""); setPros(""); setCons(""); setFeatures(""); setMedia([]);
    } catch {
      tError("Ошибка отправки инспекции");
    }
  };

  if (!hotel) return <div className="max-w-5xl mx-auto">Загрузка…</div>;

  const cover = hotel.images?.[0];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex gap-4">
          <div className="w-48 h-36 bg-gray-100 rounded overflow-hidden">
            {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{hotel.name}</h1>
            <TextRow label="Страна" value={hotel.country} />
            <TextRow label="Город" value={hotel.city} />
            <TextRow label="Адрес" value={hotel.address} />

            <div className="mt-2 flex gap-2">
              <Link
                to={`/hotels/${hotel.id}/inspections`}
                className="px-3 py-1.5 rounded bg-blue-600 text-white"
              >
                Смотреть инспекции
              </Link>
              <button
                onClick={() => setShowForm((s) => !s)}
                className="px-3 py-1.5 rounded bg-gray-900 text-white"
              >
                Оставить свою инспекцию
              </button>
            </div>
          </div>
        </div>

        {(hotel.amenities?.length || hotel.services?.length) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {hotel.amenities?.length ? (
              <div>
                <div className="font-semibold mb-2">Удобства</div>
                <div className="flex flex-wrap gap-1">
                  {hotel.amenities.map((a, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-gray-100 rounded">{a}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {hotel.services?.length ? (
              <div>
                <div className="font-semibold mb-2">Услуги</div>
                <div className="flex flex-wrap gap-1">
                  {hotel.services.map((s, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-gray-100 rounded">{s}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-4 mt-4">
          <div className="font-semibold mb-2">Инспекция от провайдера</div>
          <textarea
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Отзыв"
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Плюсы"
            value={pros}
            onChange={(e) => setPros(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Минусы"
            value={cons}
            onChange={(e) => setCons(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Фишки (особенности)"
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
          />

          <div className="mb-2">
            <label className="block text-sm font-medium mb-1">Фото/видео</label>
            <input type="file" accept="image/*,video/*" multiple onChange={onPickMedia} />
            {media.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                {media.map((m, i) => (
                  <div key={i} className="relative">
                    <img src={m} alt="" className="w-full h-28 object-cover border rounded" />
                    <button
                      type="button"
                      onClick={() => setMedia((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-white/90 rounded px-1 text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={submitInspection} className="px-3 py-2 rounded bg-orange-600 text-white">Отправить</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-2 rounded bg-gray-200">Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
