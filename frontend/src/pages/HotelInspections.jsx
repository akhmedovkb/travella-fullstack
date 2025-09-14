// frontend/src/pages/HotelInspections.jsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getHotel, listInspections, likeInspection } from "../api/hotels";

function Card({ item, onLike }) {
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <div className="text-sm text-gray-500">Автор: {item.author_name || "провайдер"}</div>
      <div className="mt-1 whitespace-pre-wrap">{item.review}</div>

      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        {item.pros && <div><div className="font-semibold">Плюсы</div><div>{item.pros}</div></div>}
        {item.cons && <div><div className="font-semibold">Минусы</div><div>{item.cons}</div></div>}
        {item.features && <div><div className="font-semibold">Фишки</div><div>{item.features}</div></div>}
      </div>

      {Array.isArray(item.media) && item.media.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {item.media.map((src, i) => (
            <img key={i} src={src} alt="" className="w-full h-28 object-cover rounded border" />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onLike(item)}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white"
        >
          👍 {item.likes ?? 0}
        </button>
      </div>
    </div>
  );
}

export default function HotelInspections() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(null);
  const [items, setItems] = useState([]);
  const [sort, setSort] = useState("top"); // top | new

  useEffect(() => {
    (async () => {
      try {
        const h = await getHotel(hotelId);
        setHotel(h);
      } catch { setHotel(null); }
    })();
  }, [hotelId]);

  const load = async () => {
    try {
      const res = await listInspections(hotelId, { sort });
      setItems(res.items || []);
    } catch { setItems([]); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [hotelId, sort]);

  const onLike = async (item) => {
    try {
      await likeInspection(item.id);
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, likes: (x.likes || 0) + 1 } : x)));
    } catch {}
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-gray-500">Отель</div>
          <div className="text-xl font-semibold">{hotel?.name || "…"}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="top">Сначала с большим числом лайков</option>
            <option value="new">Сначала новые</option>
          </select>
          <Link to={`/hotels/${hotelId}`} className="text-sm text-blue-700 hover:underline">Назад к отелю</Link>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((it) => <Card key={it.id} item={it} onLike={onLike} />)}
        {items.length === 0 && <div className="text-gray-500 text-sm">Инспекций пока нет</div>}
      </div>
    </div>
  );
}
