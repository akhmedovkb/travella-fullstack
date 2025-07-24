import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-orange-600">
            {t("register.title")}
          </h2>
          <LanguageSelector />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label>{t("register.name")}</label>
            <input
              name="name"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label>{t("register.type")}</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            >
              <option value="гид">{t("guide")}</option>
              <option value="транспорт">{t("transport")}</option>
            </select>

            <label>{t("location")}</label>
            <input
              name="location"
              value={formData.location}
              required
              lang={i18n.language}
              onChange={handleChange}
              placeholder={t("register.location_placeholder")}
              className="w-full border p-2 mb-4"
            />
            {locationSuggestions.length > 0 && (
              <ul className="bg-white border mt-0 -mt-4 max-h-40 overflow-y-auto z-10 relative">
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

            <div className="mb-4">
  <label className="block font-medium mb-1">{t("register.photo")}</label>
  <div className="flex items-center gap-4">
    <label className="bg-orange-500 text-white py-2 px-4 rounded cursor-pointer hover:bg-orange-600">
      {t("register.select_file")}
      <input
        type="file"
        name="photo"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </label>
    <span className="text-sm text-gray-600">
      {formData.photo ? t("register.file_chosen") : t("register.no_file")}
    </span>
  </div>
</div>

          </div>

          <div>
            <label>{t("register.phone")}</label>
            <input
              name="phone"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label>{t("register.email")}</label>
            <input
              name="email"
              type="email"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label>{t("register.social")}</label>
            <input
              name="social"
              onChange={handleChange}
              className="w-full border p-2 mb-4"
            />

            <label>{t("register.password")}</label>
            <input
              name="password"
              type="password"
              required
              lang={i18n.language}
              onChange={handleChange}
              className="w-full border p-2 font-bold border-2 border-orange-500"
            />
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
