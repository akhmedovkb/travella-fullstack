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

const LANGS = [
  { code: "ru", label: "RU" },
  { code: "uz", label: "UZ" },
  { code: "en", label: "EN" },
];

// Рекомендация по структуре фонда + цен:
// хранить массив объектов: rooms: [{ type, count, pricePerNight }]
export default function AdminHotelForm() {
  const navigate = useNavigate();

  // i18n-поля
  const [activeLang, setActiveLang] = useState("ru");
  const [nameI18n, setNameI18n]       = useState({ ru: "", uz: "", en: "" });
  const [countryI18n, setCountryI18n] = useState({ ru: "", uz: "", en: "" });
  const [cityI18n, setCityI18n]       = useState({ ru: "", uz: "", en: "" });
  const [addrI18n, setAddrI18n]       = useState({ ru: "", uz: "", en: "" });

  const [amenities, setAmenities] = useState([]); // массив строк
  const [services, setServices]   = useState([]); // массив строк
  const [images, setImages]       = useState([]); // dataURL (обложка = images[0])

  // инвентарь: { [typeKey]: { count, pricePerNight } }
  const [inventory, setInventory] = useState(
    ROOM_TYPES.reduce((acc, r) => ({ ...acc, [r.key]: { count: "", pricePerNight: "" } }), {})
  );

  const cloneFromRU = () => {
    setNameI18n((p) => ({ ...p, uz: p.uz || p.ru, en: p.en || p.ru }));
    setCountryI18n((p) => ({ ...p, uz: p.uz || p.ru, en: p.en || p.ru }));
    setCityI18n((p) => ({ ...p, uz: p.uz || p.ru, en: p.en || p.ru }));
    setAddrI18n((p) => ({ ...p, uz: p.uz || p.ru, en: p.en || p.ru }));
  };

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
    // базовым оставляем RU — это нужно для совместимости с текущим бэком
    const base = "ru";

    if (!nameI18n[base].trim()) return tError("Введите название (RU)");
    if (!countryI18n[base].trim()) return tError("Укажите страну (RU)");
    if (!addrI18n[base].trim()) return tError("Укажите адрес (RU)");

    const rooms = ROOM_TYPES
      .map((r) => ({
        type: r.key,
        count: Number(inventory[r.key].count || 0),
        pricePerNight: inventory[r.key].pricePerNight ? Number(inventory[r.key].pricePerNight) : null,
      }))
      .filter((x) => x.count > 0);

    // совместимый payload: строковые поля из RU + полный набор переводов
    const payload = {
      // базовые (для существующих эндпойнтов)
      name:    nameI18n[base].trim(),
      country: countryI18n[base].trim(),
      city:    (cityI18n[base] || "").trim(),
      address: addrI18n[base].trim(),

      // полный набор переводов (бэк может игнорировать — не ломает)
      translations: {
        ru: { name: nameI18n.ru, country: countryI18n.ru, city: cityI18n.ru, address: addrI18n.ru },
        uz: { name: nameI18n.uz, country: countryI18n.uz, city: cityI18n.uz, address: addrI18n.uz },
        en: { name: nameI18n.en, country: countryI18n.en, city: cityI18n.en, address: addrI18n.en },
      },

      rooms, amenities, services, images,
    };

    try {
      const created = await createHotel(payload);
      tSuccess("Отель сохранён");
      // если бэк вернул id — переходим на карточку
      const id = created?.id || created?._id || "";
      if (id) navigate(`/hotels/${id}`);
    } catch (e) {
      tError("Ошибка сохранения отеля");
    }
  };

  // удобный геттер/сеттер текущего языка
  const bind = (obj, setObj) => ({
    value: obj[activeLang],
    onChange: (e) => setObj((p) => ({ ...p, [activeLang]: e.target.value })),
  });

  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <h1 className="text-2xl font-bold mb-4">Новый отель</h1>

      {/* Языковые табы */}
      <div className="flex items-center gap-2 mb-3">
        {LANGS.map(l => (
          <button
            key={l.code}
            type="button"
            onClick={() => setActiveLang(l.code)}
            className={[
              "px-3 py-1 rounded-full border text-sm",
              activeLang === l.code ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-800"
            ].join(" ")}
          >
            {l.label}
          </button>
        ))}
        <button type="button" onClick={cloneFromRU} className="ml-auto text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
          Скопировать из RU
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Название ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bind(nameI18n, setNameI18n)} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Страна ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bind(countryI18n, setCountryI18n)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Город ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bind(cityI18n, setCityI18n)} />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Адрес ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bind(addrI18n, setAddrI18n)} />
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
