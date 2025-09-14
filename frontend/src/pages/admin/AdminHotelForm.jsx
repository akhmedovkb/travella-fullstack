// frontend/src/pages/admin/AdminHotelForm.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createHotel } from "../../api/hotels";
import { apiGet } from "../../api";
import { tSuccess, tError } from "../../shared/toast";

/* ================== HELPERS ================== */
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

// универсальный троттлинг/дебаунс
function useDebouncedCallback(cb, delay = 250) {
  const ref = useRef();
  useEffect(() => () => clearTimeout(ref.current), []);
  return (...args) => {
    clearTimeout(ref.current);
    ref.current = setTimeout(() => cb(...args), delay);
  };
}

// пробуем несколько url-ов до первого успешного
async function tryUrls(urls, mapFn) {
  for (const u of urls) {
    try {
      const res = await apiGet(u, true); // токен клиента/провайдера не критичен — true = общедоступно
      const arr = mapFn(res);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {}
  }
  return [];
}

// localStorage cache helpers
const LS = {
  get(key, def = []) {
    try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : def; } catch { return def; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  pushUnique(key, value, max = 50) {
    const cur = LS.get(key);
    if (!value) return cur;
    if (!cur.includes(value)) {
      const next = [value, ...cur].slice(0, max);
      LS.set(key, next);
      return next;
    }
    return cur;
  }
};

/* ================== SUGGEST INPUT ================== */
/**
 * Универсальный инпут с выпадающими подсказками.
 * Источник — проп searchFn(q): Promise<string[]>
 * Дополнительно хранит историю в localStorage (storageKey).
 */
function SuggestInput({
  value,
  onChange,
  placeholder,
  storageKey,
  searchFn,
  min = 2,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() => LS.get(storageKey));
  const wrapRef = useRef(null);

  // закрытие по клику вне
  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const debouncedSearch = useDebouncedCallback(async (q) => {
    if (!q || q.trim().length < min) { setItems(LS.get(storageKey)); return; }
    try {
      const list = (await searchFn(q.trim())) || [];
      // объединяем подсказки бэка и локальную историю
      const hist = LS.get(storageKey);
      const merged = Array.from(new Set([...list, ...hist]));
      setItems(merged.slice(0, 50));
    } catch {
      setItems(LS.get(storageKey));
    }
  }, 220);

  const onInput = (e) => {
    const v = e.target.value;
    onChange(v);
    setOpen(true);
    debouncedSearch(v);
  };

  const onPick = (v) => {
    onChange(v);
    setOpen(false);
    LS.pushUnique(storageKey, v);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        className="w-full border rounded px-3 py-2"
        value={value}
        onChange={onInput}
        onFocus={() => { if (items.length) setOpen(true); }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && items?.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow-lg max-h-60 overflow-auto">
          {items.map((it, i) => (
            <button
              type="button"
              key={`${it}-${i}`}
              className="w-full text-left px-3 py-1.5 hover:bg-gray-100"
              onClick={() => onPick(it)}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================== PAGE ================== */
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

  const [amenities, setAmenities] = useState([]);
  const [services, setServices]   = useState([]);
  const [images, setImages]       = useState([]);

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

  /* --------- Suggest search functions ---------- */
  const countrySearch = async (q, lang) => {
    // возможные эндпоинты — используем первый с данными
    const urlq = encodeURIComponent(q);
    const urll = encodeURIComponent(lang);
    const urls = [
      `/api/geo/countries?q=${urlq}&lang=${urll}`,
      `/api/common/geo/countries?q=${urlq}&lang=${urll}`,
      `/api/geo/country/suggest?q=${urlq}&lang=${urll}`,
      `/api/geo/country?q=${urlq}&lang=${urll}`,
    ];
    const map = (res) => {
      const items = res?.items || res?.data || res;
      if (!items) return [];
      return items.map((x) => (typeof x === "string" ? x : x?.name || x?.title || "")).filter(Boolean);
    };
    const fromApi = await tryUrls(urls, map);
    if (fromApi.length) return fromApi;
    // fallback: локальная история
    return LS.get(`hotels:countries:${lang}`);
  };

  const citySearch = async (q, lang, country) => {
    const urlq = encodeURIComponent(q);
    const urll = encodeURIComponent(lang);
    const urlc = encodeURIComponent(country || "");
    const urls = [
      `/api/geo/cities?q=${urlq}&country=${urlc}&lang=${urll}`,
      `/api/common/geo/cities?q=${urlq}&country=${urlc}&lang=${urll}`,
      `/api/geo/city/suggest?q=${urlq}&country=${urlc}&lang=${urll}`,
      `/api/geo/city?q=${urlq}&country=${urlc}&lang=${urll}`,
    ];
    const map = (res) => {
      const items = res?.items || res?.data || res;
      if (!items) return [];
      return items.map((x) => (typeof x === "string" ? x : x?.name || x?.title || "")).filter(Boolean);
    };
    const fromApi = await tryUrls(urls, map);
    if (fromApi.length) return fromApi;
    return LS.get(`hotels:cities:${lang}:${country || "any"}`);
  };

  // на выбор страны пушим в кэш и чистим город, если поменяли страну
  const setCountryLang = (lang) => (v) => {
    setCountryI18n((p) => {
      const prev = p[lang];
      if (prev !== v) {
        // сброс города при смене страны — только в активном языке
        setCityI18n((c) => ({ ...c, [lang]: "" }));
      }
      // кэш подсказок
      if (v?.trim()) LS.pushUnique(`hotels:countries:${lang}`, v.trim());
      return { ...p, [lang]: v };
    });
  };

  const setCityLang = (lang) => (v) => {
    setCityI18n((p) => {
      if (v?.trim()) {
        const country = (countryI18n?.[lang] || "").trim() || "any";
        LS.pushUnique(`hotels:cities:${lang}:${country}`, v.trim());
      }
      return { ...p, [lang]: v };
    });
  };

  /* --------- Amenities/Services/Images ---------- */
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

  /* --------- Submit ---------- */
  const submit = async () => {
    const base = "ru"; // совместимость с текущим бэком

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

    const payload = {
      name:    nameI18n[base].trim(),
      country: countryI18n[base].trim(),
      city:    (cityI18n[base] || "").trim(),
      address: addrI18n[base].trim(),
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
      const id = created?.id || created?._id || "";
      if (id) navigate(`/hotels/${id}`);
    } catch {
      tError("Ошибка сохранения отеля");
    }
  };

  // удобный биндер для «Название» и «Адрес» (без подсказок)
  const bindSimple = (obj, setObj) => ({
    value: obj[activeLang],
    onChange: (e) => setObj((p) => ({ ...p, [activeLang]: e.target.value })),
  });

  // memo search functions, чтобы не пересоздавались
  const countrySearchLang = useMemo(
    () => (q) => countrySearch(q, activeLang),
    [activeLang]
  );
  const citySearchLang = useMemo(
    () => (q) => citySearch(q, activeLang, countryI18n?.[activeLang] || ""),
    [activeLang, countryI18n]
  );

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
        {/* Название (без внешних подсказок, но с историей можно тоже) */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Название ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bindSimple(nameI18n, setNameI18n)} />
        </div>

        {/* Страна — с автодополнением */}
        <div>
          <label className="block text-sm font-medium mb-1">Страна ({activeLang.toUpperCase()})</label>
          <SuggestInput
            value={countryI18n[activeLang] || ""}
            onChange={setCountryLang(activeLang)}
            placeholder="Начните вводить страну…"
            storageKey={`hotels:countries:${activeLang}`}
            searchFn={countrySearchLang}
          />
        </div>

        {/* Город — автодополнение + зависит от страны */}
        <div>
          <label className="block text-sm font-medium mb-1">Город ({activeLang.toUpperCase()})</label>
          <SuggestInput
            value={cityI18n[activeLang] || ""}
            onChange={setCityLang(activeLang)}
            placeholder="Начните вводить город…"
            storageKey={`hotels:cities:${activeLang}:${(countryI18n?.[activeLang] || "any")}`}
            searchFn={citySearchLang}
          />
        </div>

        {/* Адрес */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Адрес ({activeLang.toUpperCase()})</label>
          <input className="w-full border rounded px-3 py-2" {...bindSimple(addrI18n, setAddrI18n)} />
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
