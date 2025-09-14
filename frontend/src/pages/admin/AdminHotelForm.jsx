import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import RoomInventoryEditor from "../../components/hotels/RoomInventoryEditor";
import RoomPricingEditor from "../../components/hotels/RoomPricingEditor";
import HotelAmenitiesServices from "../../components/hotels/HotelAmenitiesServices";
import { tSuccess, tError } from "../../shared/toast";
import { AMENITIES, SERVICES } from "../../constants/hotelDicts";

// возьмите из вашего кода:
import { makeAsyncSelectI18n } from "../Dashboard"; // если не экспортируется — скопируйте локально
// или продублируйте i18n-хелперы здесь

export default function AdminHotelForm() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token");
  const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const [countryOptions, setCountryOptions] = useState([]);
  const [loadCities, setLoadCities] = useState(() => async () => []);
  const [name, setName] = useState("");
  const [country, setCountry] = useState(null);
  const [city, setCity] = useState(null);
  const [address, setAddress] = useState("");
  const [images, setImages] = useState([]);
  const [inventory, setInventory] = useState([]); // [{type,count}]
  const [rates, setRates] = useState([]);         // [{type,currency,basePrice}]
  const [amenities, setAmenities] = useState([]);
  const [services, setServices] = useState([]);

  // ====== подхватим уже существующие загрузчики из Dashboard (если вынесены в утилы) ======
  useEffect(() => {
    // страны (можете переиспользовать ваш эффект из Dashboard)
    axios.get("https://restcountries.com/v3.1/all?fields=name,cca2").then(res => {
      const opts = (res.data || []).map(c => ({
        value: c.cca2, code: c.cca2, label: c.name?.common || c.cca2
      })).sort((a,b) => a.label.localeCompare(b.label));
      setCountryOptions(opts);
    });
    // города (минимальный ассинх-лоадер)
    setLoadCities(() => async (inputValue) => {
      if (!inputValue || inputValue.trim().length < 2) return [];
      const { data } = await axios.get("https://secure.geonames.org/searchJSON", {
        params: { q: inputValue, featureClass: "P", maxRows: 10, username: import.meta.env.VITE_GEONAMES_USERNAME }
      });
      return (data.geonames || []).map(g => ({ value: g.name, label: g.name }));
    });
  }, []);

  const save = async () => {
    if (!name || !country) {
      tError("Заполните название и страну");
      return;
    }
    try {
      const payload = {
        name,
        country: country?.value,
        address: address || (city?.label || ""),
        city: city?.label || "",
        images,
        inventory,
        rates,
        amenities,
        services
      };
      await axios.post(`${API_BASE}/api/hotels`, payload, config);
      tSuccess("Отель сохранён");
      // очистить форму
      setName(""); setCountry(null); setCity(null); setAddress("");
      setImages([]); setInventory([]); setRates([]); setAmenities([]); setServices([]);
    } catch (e) {
      console.error(e);
      tError("Не удалось сохранить отель");
    }
  };

  return (
    <div className="p-6 mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Добавить отель</h1>

      <div className="mb-3">
        <label className="block font-medium mb-1">Название</label>
        <input className="w-full border rounded px-3 py-2"
               value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block font-medium mb-1">Страна</label>
          <Select options={countryOptions} value={country} onChange={setCountry} />
        </div>
        <div>
          <label className="block font-medium mb-1">Город</label>
          <AsyncSelect cacheOptions defaultOptions loadOptions={loadCities} value={city} onChange={setCity} />
        </div>
        <div>
          <label className="block font-medium mb-1">Адрес</label>
          <input className="w-full border rounded px-3 py-2"
                 value={address} onChange={e => setAddress(e.target.value)}
                 placeholder="Улица, дом…" />
        </div>
      </div>

      <RoomInventoryEditor value={inventory} onChange={setInventory} className="mb-4" />
      <div className="mt-4" />
      <RoomPricingEditor value={rates} onChange={setRates} currency="USD" />

      <div className="mt-4" />
      <HotelAmenitiesServices
        amenities={amenities}
        services={services}
        onAmenities={setAmenities}
        onServices={setServices}
      />

      {/* Простейшая загрузка фоток (можно переиспользовать ImagesEditor из Dashboard) */}
      <div className="mt-4 border rounded-lg p-4">
        <div className="font-semibold mb-2">Фотографии</div>
        <input type="file" multiple accept="image/*"
               onChange={e => {
                 const files = Array.from(e.target.files || []);
                 Promise.all(files.map(f => {
                   return new Promise(res => {
                     const r = new FileReader();
                     r.onload = () => res(r.result); r.readAsDataURL(f);
                   });
                 })).then(arr => setImages(prev => [...prev, ...arr]));
               }} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="h-24 w-full object-cover rounded" />
              <button type="button" className="absolute top-1 right-1 bg-white/90 text-xs px-2 rounded"
                      onClick={() => setImages(imgs => imgs.filter((_,idx) => idx !== i))}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex gap-3 justify-end">
        <button onClick={save} className="bg-orange-600 text-white px-5 py-2 rounded font-semibold">
          Сохранить
        </button>
      </div>
    </div>
  );
}
