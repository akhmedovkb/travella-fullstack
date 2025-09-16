// frontend/src/pages/HotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { getHotel, listInspections, likeInspection, createInspection } from "../api/hotels";

/* --- карточка инспекции (как было) --- */
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

/* --- форма новой инспекции --- */
function NewInspectionForm({ hotelId, onCancel, onCreated }) {
  const [author, setAuthor] = useState("");
  const [review, setReview] = useState("");
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [features, setFeatures] = useState("");
  const [media, setMedia] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const readers = files.map(
      (f) =>
        new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(f); // сохраняем как dataURL
        })
    );
    const list = await Promise.all(readers);
    setMedia((prev) => [...prev, ...list]);
    e.target.value = "";
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!review.trim()) {
      setError("Напишите общий отзыв");
      return;
    }
    setSaving(true);
    try {
      await createInspection(hotelId, {
        author_name: author || undefined,
        review: review.trim(),
        pros: pros || undefined,
        cons: cons || undefined,
        features: features || undefined,
        media,
      });
      onCreated?.(); // обновим список/уйдем со страницы
    } catch (e) {
      setError("Не удалось сохранить инспекцию");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white border rounded-xl p-4 shadow-sm max-w-3xl">
      <h2 className="text-lg font-semibold mb-3">Новая инспекция</h2>

      {error && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Автор</label>
          <input className="w-full border rounded px-3 py-2" value={author} onChange={(e)=>setAuthor(e.target.value)} placeholder="Ваше имя (необязательно)" />
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-sm text-gray-600 mb-1">Общий отзыв *</label>
        <textarea className="w-full border rounded px-3 py-2 min-h-[120px]" value={review} onChange={(e)=>setReview(e.target.value)} />
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Плюсы</label>
          <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={pros} onChange={(e)=>setPros(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Минусы</label>
          <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={cons} onChange={(e)=>setCons(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Фишки</label>
          <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={features} onChange={(e)=>setFeatures(e.target.value)} />
        </div>
      </div>

      <div className="mt-3">
        <input id="inspMedia" type="file" multiple accept="image/*" onChange={onPickFiles} className="sr-only" />
        <label htmlFor="inspMedia" className="inline-flex items-center px-3 py-2 rounded bg-gray-800 text-white cursor-pointer">
          Добавить фото
        </label>
        <span className="ml-2 text-sm text-gray-600">{media.length ? `выбрано: ${media.length}` : "фото не выбраны"}</span>

        {!!media.length && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
            {media.map((src, i) => (
              <div key={i} className="relative">
                <img src={src} alt="" className="w-full h-28 object-cover rounded border" />
                <button type="button" onClick={() => setMedia((p)=>p.filter((_,idx)=>idx!==i))}
                        className="absolute top-1 right-1 bg-white/90 rounded px-1 text-xs">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={saving} className={`px-4 py-2 rounded text-white ${saving ? "bg-gray-400" : "bg-orange-600 hover:bg-orange-700"}`}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded border">Отмена</button>
      </div>
    </form>
  );
}

export default function HotelInspections() {
  const { hotelId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isNew = search.get("new") === "1";

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
  useEffect(() => { if (!isNew) load(); /* eslint-disable-next-line */ }, [hotelId, sort, isNew]);

  const onLike = async (item) => {
    try {
      await likeInspection(item.id);
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, likes: (x.likes || 0) + 1 } : x)));
    } catch {}
  };

  /* ---------- Рендер ---------- */
  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-gray-500">Отель</div>
          <div className="text-xl font-semibold">{hotel?.name || "…"}</div>
        </div>

        <div className="flex items-center gap-2">
          {!isNew && (
            <select
              className="border rounded px-2 py-1 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="top">Сначала с большим числом лайков</option>
              <option value="new">Сначала новые</option>
            </select>
          )}
          <Link to={`/hotels/${hotelId}`} className="text-sm text-blue-700 hover:underline">Назад к отелю</Link>
        </div>
      </div>

      {isNew ? (
        <NewInspectionForm
          hotelId={hotelId}
          onCancel={() => navigate(`/hotels/${hotelId}/inspections`)}
          onCreated={() => navigate(`/hotels/${hotelId}/inspections`)}
        />
      ) : (
        <div className="space-y-3">
          {items.map((it) => <Card key={it.id} item={it} onLike={onLike} />)}
          {items.length === 0 && <div className="text-gray-500 text-sm">Инспекций пока нет</div>}
        </div>
      )}
    </div>
  );
}
