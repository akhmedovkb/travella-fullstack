import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector";

const Register = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    type: "гид",
    location: "",
    photo: "",
    phone: "",
    email: "",
    social: "",
    password: ""
  });

  const [errors, setErrors] = useState({});
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  let debounceTimeout = null;

  const fetchCities = async (query) => {
    if (!query) return setLocationSuggestions([]);

    try {
      const response = await axios.get(
        `https://wft-geo-db.p.rapidapi.com/v1/geo/cities`,
        {
          params: {
            namePrefix: query,
            limit: 5,
            sort: "-population",
            countryIds: "UZ"
          },
          headers: {
            "X-RapidAPI-Key": import.meta.env.VITE_GEODB_API_KEY,
            "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
          },
        }
      );
      const cities = response.data.data.map((city) => city.city);
      setLocationSuggestions(cities);
    } catch (err) {
      console.error("Ошибка автоподсказки:", err);
      setLocationSuggestions([]);
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((prev) => ({ ...prev, location: city }));
    setLocationSuggestions([]);
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    setErrors((prev) => ({ ...prev, [name]: null }));

    if (name === "photo" && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, photo: reader.result }));
      };
      reader.readAsDataURL(files[0]);
    } else if (name === "location") {
      setFormData((prev) => ({ ...prev, [name]: value }));
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        fetchCities(value);
      }, 300);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.name) newErrors.name = t("register.required");
    if (!formData.phone) newErrors.phone = t("register.required");
    if (!formData.email) newErrors.email = t("register.required");
    if (!formData.password) newErrors.password = t("register.required");
    if (!formData.location) newErrors.location = t("register.required");

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/register`,
        formData,
        { headers: { "Content-Type": "application/json" } }
      );
      alert(t("register.success"));
      navigate("/login");
    } catch (error) {
      console.error("Ошибка регистрации:", error.response?.data || error.message);
      alert(t("register.error"));
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-10 rounded-lg shadow-lg w-full max-w-4xl"
      >
        <div className="flex justify-end mb-4"><LanguageSelector /></div>

        <h2 className="text-2xl font-bold text-center text-orange-600 mb-8">
          {t("register.title")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label>{t("register.name")}</label>
            <input name="name" value={formData.name} onChange={handleChange} className="w-full border p-2 mb-1" />
            {errors.name && <p className="text-red-500 text-sm mb-2">{errors.name}</p>}

            <label>{t("register.type")}</label>
            <select name="type" value={formData.type} onChange={handleChange} className="w-full border p-2 mb-4">
              <option value="гид">{t("guide")}</option>
              <option value="транспорт">{t("transport")}</option>
            </select>

            <label>{t("location")}</label>
            <input
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-1"
            />
            {errors.location && <p className="text-red-500 text-sm mb-2">{errors.location}</p>}

            {locationSuggestions.length > 0 && (
              <ul className="bg-white border max-h-40 overflow-y-auto z-10 relative mb-2">
                {locationSuggestions.map((city, index) => (
                  <li
                    key={index}
                    onClick={() => handleLocationSelect(city)}
                    className="p-2 border-b cursor-pointer hover:bg-gray-100"
                  >
                    {city}
                  </li>
                ))}
              </ul>
            )}

            <label>{t("register.photo")}</label>
            <input
              name="photo"
              type="file"
              accept="image/*"
              onChange={handleChange}
              className="w-full border p-2 mb-4 file:bg-orange-600 file:text-white file:rounded file:px-4 file:py-1"
            />
          </div>

          <div>
            <label>{t("register.phone")}</label>
            <input name="phone" value={formData.phone} onChange={handleChange} className="w-full border p-2 mb-1" />
            {errors.phone && <p className="text-red-500 text-sm mb-2">{errors.phone}</p>}

            <label>{t("register.email")}</label>
            <input name="email" type="email" value={formData.email} onChange={handleChange} className="w-full border p-2 mb-1" />
            {errors.email && <p className="text-red-500 text-sm mb-2">{errors.email}</p>}

            <label>{t("register.social")}</label>
            <input name="social" value={formData.social} onChange={handleChange} className="w-full border p-2 mb-4" />

            <label>{t("register.password")}</label>
            <input
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full border p-2 mb-1 font-bold border-2 border-orange-500"
            />
            {errors.password && <p className="text-red-500 text-sm">{errors.password}</p>}
          </div>
        </div>

        <button
          type="submit"
          className="mt-6 w-full bg-orange-600 text-white py-3 rounded font-bold"
        >
          {t("register.button")}
        </button>
      </form>
    </div>
  );
};

export default Register;
