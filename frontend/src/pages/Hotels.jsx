import React, { useEffect, useState } from "react";
import axios from "axios";
import AsyncSelect from "react-select/async";
import Select from "react-select";
import { tError } from "../shared/toast";

function HotelCard({ h, onOpen }) {
  const priceMin = (h?.rates || []).reduce((m, r) => r.basePrice > 0 ? Math.min(m, r.basePrice) : m, Infinity);
  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="h-40 bg-gray-100">
        {h.images?.[0] ? <img src={h.images[0]} alt="" className="h-40 w-full object-cover" /> : null}
      </div>
      <div className="p-3">
        <div className="font-semibold">{h.name}</div>
        <div className="text-sm text-gray-600">{h.city || ""}{h.country ? `, ${h.country}` : ""}</div>
        {Number.isFinite(priceMin) && priceMin !== Infinity && (
          <div className="mt-1 text-sm">
            от <span className="font-semibold">{priceMin} USD</span> / ночь
          </div>
        )}
        <button className="mt-3 w-full bg-blue-600 text-white px-3 py-2 rounded"
                onClick={() => onOpen(h)}>Посмотреть</button>
      </div>
    </div>
  );
}

export default function Hotels() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const [query, setQuery] = useState("");
  const [city, setCity]   = useState(null);
  const [country, setCountry] = useState(null);
  const [countryOptions, setCountryOptions] = useState([]);
  const [loadCities, setLoadCities] = useState(() => async () => []);
  const [items, setItems] = useState([]);
  const [opened, setOpened] = useState(null);

  useEffect(() => {
    axios.get("https://restcountries.com/v3.1/all?fields=name,cca2").then(res => {
      const opts = (res.data || []).map(c => ({ value: c.cca2, label: c.name?.common || c.cca2 }))
        .sort((a,b) => a.label.localeCompare(b.label));
      setCountryOptions(opts);
    });
    setLoadCities(() => async (inputValue) => {
      if (!inputValue || inputValue.trim().length < 2) return [];
      const { data } = await axios.get("https://secure.geonames.org/searchJSON", {
        params: { q: inputValue, featureClass: "P", maxRows: 10, username: import.meta.env.VITE_GEONAMES_USERNAME }
      });
      return (data.geonames || []).map(g => ({ value: g.name, label: g.name }));
    });
  }, []);

  const search = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/hotels`, {
        params: {
          query: query || "",
          city: city?.label || "",
          country: country?.value || ""
        }
      });
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e); tError("Не удалось выполнить поиск");
    }
  };

  useEffect(() => { search(); }, []); // показать что-то при первом заходе

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-2xl font-bold mb-4">Отели</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <input
            className="border rounded px-3 py-2"
            placeholder="Название отеля"
            value={query} onChange={e => setQuery(e.target.value)}
          />
          <AsyncSelect cacheOptions defaultOptions loadOptions={loadCities}
                       value={city} onChange={setCity} placeholder="Город" />
          <Select options={countryOptions} value={country} onChange={setCountry} placeholder="Страна" />
        </div>
        <button className="mb-6 bg-orange-600 text-white px-4 py-2 rounded" onClick={search}>Найти</button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map(h => <HotelCard key={h.id} h={h} onOpen={setOpened} />)}
        </div>
      </div>

      {/* простая «карточка» детальной инфы + отзывы */}
      {opened && (
        <div className="fixed inset-0 bg-black/50 flex items-start md:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex justify-between">
              <div className="font-semibold text-lg">{opened.name}</div>
              <button onClick={() => setOpened(null)} className="text-gray-600 hover:text-black">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {opened.images?.slice(0,3).map((src,i) => <img key={i} src={src} className="h-28 w-full object-cover rounded" />)}
              </div>
              <div className="text-sm text-gray-700">{opened.address}</div>

              <div>
                <div className="font-semibold mb-1">Удобства</div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {(opened.amenities || []).map(k => <span key={k} className="px-2 py-0.5 rounded bg-gray-100">{k}</span>)}
                </div>
              </div>

              <div>
                <div className="font-semibold mb-1">Услуги</div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {(opened.services || []).map(k => <span key={k} className="px-2 py-0.5 rounded bg-gray-100">{k}</span>)}
                </div>
              </div>

              {/* отзывы (упрощённая заглушка — подключите ваши эндпоинты) */}
              <Reviews hotelId={opened.id} apiBase={API_BASE} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Reviews({ hotelId, apiBase }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);
  const [files, setFiles] = useState([]);

  const token = localStorage.getItem("token");
  const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const load = async () => {
    const { data } = await axios.get(`${apiBase}/api/hotels/${hotelId}/reviews`);
    setItems(Array.isArray(data) ? data : []);
  };
  useEffect(() => { load(); }, [hotelId]);

  const submit = async () => {
    const images = await Promise.all(Array.from(files).map(f => new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f);
    })));
    await axios.post(`${apiBase}/api/hotels/${hotelId}/reviews`, { text, rating, images }, config);
    setText(""); setRating(5); setFiles([]); load();
  };

  return (
    <div className="mt-4">
      <div className="font-semibold mb-2">Отзывы</div>
      <div className="space-y-3 mb-4">
        {items.map((r, i) => (
          <div key={i} className="border rounded p-3">
            <div className="text-sm text-gray-600">Оценка: {r.rating}/5</div>
            <div className="mt-1">{r.text}</div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {(r.images || []).map((src, j) => <img key={j} src={src} className="h-20 w-full object-cover rounded" />)}
            </div>
          </div>
        ))}
      </div>

      <div className="border rounded p-3">
        <div className="mb-2">Ваша оценка: {rating}/5</div>
        <input type="range" min="1" max="5" value={rating} onChange={e => setRating(Number(e.target.value))} />
        <textarea className="w-full border rounded px-3 py-2 mt-2"
                  placeholder="Напишите отзыв…" value={text} onChange={e => setText(e.target.value)} />
        <input type="file" multiple accept="image/*,video/*" className="mt-2" onChange={e => setFiles(e.target.files)} />
        <button className="mt-3 bg-blue-600 text-white px-3 py-2 rounded" onClick={submit}>Отправить</button>
      </div>
    </div>
  );
}
