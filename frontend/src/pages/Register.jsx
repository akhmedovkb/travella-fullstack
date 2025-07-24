import React, { useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const { t } = useTranslation("register");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    type: "Гид",
    location: "",
    social: "",
    photo: "",
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo") {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({ ...prev, photo: reader.result }));
      };
      reader.readAsDataURL(files[0]);
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/register`, form);
      navigate("/login");
    } catch (err) {
      alert("Ошибка регистрации");
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-12 bg-white p-8 rounded-xl shadow">
      <h2 className="text-2xl font-bold text-center text-orange-600 mb-6">{t("title")}</h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block font-medium">{t("name")}</label>
          <input type="text" name="name" value={form.name} onChange={handleChange} className="border px-3 py-2 rounded w-full" />
        </div>
        <div>
          <label className="block font-medium">{t("phone")}</label>
          <input type="text" name="phone" value={form.phone} onChange={handleChange} className="border px-3 py-2 rounded w-full" />
        </div>
        <div>
          <label className="block font-medium">{t("type")}</label>
          <select name="type" value={form.type} onChange={handleChange} className="border px-3 py-2 rounded w-full">
            <option value="Гид">{t("guide")}</option>
            <option value="Транспорт">{t("transport")}</option>
          </select>
        </div>
        <div>
          <label className="block font-medium">Email</label>
          <input type="email" name="email" value={form.email} onChange={handleChange} className="border px-3 py-2 rounded w-full" />
        </div>
        <div>
          <label className="block font-medium">{t("location")}</label>
          <input type="text" name="location" value={form.location} onChange={handleChange} className="border px-3 py-2 rounded w-full" placeholder={t("location_placeholder")} />
        </div>
        <div>
          <label className="block font-medium">{t("social")}</label>
          <input type="text" name="social" value={form.social} onChange={handleChange} className="border px-3 py-2 rounded w-full" />
        </div>
        <div>
          <label className="block font-medium">{t("photo")}</label>
          <input type="file" name="photo" accept="image/*" onChange={handleChange} className="w-full" />
        </div>
        <div>
          <label className="block font-medium">{t("password")}</label>
          <input type="password" name="password" value={form.password} onChange={handleChange} className="border px-3 py-2 rounded w-full" />
        </div>
        <div className="col-span-2 mt-4">
          <button type="submit" className="w-full bg-orange-500 text-white py-2 rounded font-bold">{t("submit")}</button>
        </div>
      </form>
    </div>
  );
};

export default Register;
