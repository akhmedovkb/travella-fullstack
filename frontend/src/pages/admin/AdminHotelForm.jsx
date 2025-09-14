// frontend/src/pages/admin/AdminHotelForm.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createHotel } from "../../api/hotels";
import { tSuccess, tError } from "../../shared/toast";

const ROOM_TYPES = [
  { key: "single",     label: "Single" },
  { key: "double",     label: "Double" },
  { key: "triple",     label: "Triple" },
  { key: "quadruple",  label: "Quadruple" },
  { key: "suite",      label: "Suite" },
  { key: "family",     label: "Family" },
];

// Рекомендация по структуре фонда + цен:
// хранить массив объектов: rooms: [{ type, count, pricePerNight }]
// это прямо связывает пункты 4 и 5 в одной таблице.
export default function AdminHotelForm() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [amenities, setAmenities] = useState([]); // массив строк
  const [services, setServices] = useState([]);   // массив строк
  const [images, setImages] = useState([]);       // dataURL (обложка = images[0])

  // инвентарь: { [typeKey]: { count, pricePerNight } }
  const [inventory, setInventory] = useState(
    ROOM_TYPES.reduce((acc, r) => ({ ...acc, [r.key]: { count: "", pricePerNight: "" } }), {})
  );

  const handleAmenityAdd = (e) => {
    e.preventDefault();
    const val = e.target.elements.amen.value.trim();
    if (val && !amenities.includes(val)) setAmenities((p) => [...p, val]);
    e.target.reset();
  };
  const handleServiceAdd = (e) => {
    e.preventDefault();
    const val = e.target.elements.serv.value.trim();
    if (val && !services.includes(val)) setServices((p) => [...p, val]);
    e.target.reset();
  };
  const removeFrom = (arrSetter, idx) => arrSetter((p) => p.filter((_, i) => i !== idx));

  const onImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const readers = files.map(
      (f) =>
        new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(f);
        })
    );
    Promise.all(readers).then((list) => setImages((prev) => [...prev, ...list]));
    e.target.value = "";
  };

  const submit = async () => {
    if (!name.trim()) return tError("Введите название");
    if (!country.trim()) return tError("Укажите страну");
    if (!address.trim()) return tError("Укажите адрес");

    const rooms = ROOM_TYPES
      .map((r) => ({
        type: r.key,
        count: Number(inventory[r.key].count || 0),
        pricePerNight: inventory[r.key].pricePerNight ? Number(inventory[r.key].pricePerNight) : null,
      }))
      .filter((x) => x.count > 0);

    const payload = {
      name: name.trim(),
      country: country.trim(),
      city: city.trim() || null,
      address: address.trim(),
      rooms,                // ← фонд + цены каскадно
      amenities,
      services,
      images,
    };

    try {
      const created = await createHotel(payload);
      tSuccess("Отель сохранён");
      navigate(`/hotels/${created?.id || ""}`);
    } catch (e) {
      tError("Ошибка сохранения отеля");
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <h1 className="text-2xl font-bold mb-4">Новый отель</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Название</label>
          <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Страна</label>
          <input className="w-full border rounded px-3 py-2" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Город</label>
          <input className="w-full border rounded px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Адрес</label>
          <input className="w-full border rounded px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      {/* Номерной фонд + цены */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Номерной фонд и цены</h2>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Тип</th>
              <th className="text-left px-3 py-2">Кол-во</th>
              <th className="text-left px-3 py-2">Цена/ночь</th>
            </tr>
          </thead>
          <tbody>
            {ROOM_TYPES.map((rt) => (
              <tr key={rt.key} className="border-t">
                <td className="px-3 py-2">{rt.label}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="w-28 border rounded px-2 py-1"
                    value={inventory[rt.key].count}
                    onChange={(e) =>
                      setInventory((p) => ({ ...p, [rt.key]: { ...p[rt.key], count: e.target.value } }))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="USD"
                    className="w-36 border rounded px-2 py-1"
                    value={inventory[rt.key].pricePerNight}
                    onChange={(e) =>
                      setInventory((p) => ({ ...p, [rt.key]: { ...p[rt.key], pricePerNight: e.target.value } }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Удобства */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Удобства</h2>
      <form onSubmit={handleAmenityAdd} className="flex gap-2 mb-2">
        <input name="amen" className="flex-1 border rounded px-3 py-2" placeholder="Добавить удобство…" />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">Добавить</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {amenities.map((a, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {a}{" "}
            <button className="ml-1 text-gray-500" onClick={() => removeFrom(setAmenities, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Услуги */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Услуги</h2>
      <form onSubmit={handleServiceAdd} className="flex gap-2 mb-2">
        <input name="serv" className="flex-1 border rounded px-3 py-2" placeholder="Добавить услугу…" />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">Добавить</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {services.map((s, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {s}{" "}
            <button className="ml-1 text-gray-500" onClick={() => removeFrom(setServices, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Изображения */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Изображения</h2>
      <input type="file" accept="image/*" multiple onChange={onImagePick} />
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="w-full h-28 object-cover rounded border" />
              <button
                type="button"
                onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 bg-white/90 rounded px-1 text-xs"
              >
                ×
              </button>
              {i === 0 && (
                <div className="absolute bottom-1 left-1 text-[10px] bg-white/90 px-1 rounded">Обложка</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={submit} className="bg-orange-600 text-white font-semibold px-4 py-2 rounded">
          Сохранить
        </button>
      </div>
    </div>
  );
}
