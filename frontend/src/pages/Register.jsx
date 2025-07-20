
import React, { useState } from "react";
import axios from "axios";

const Register = () => {
  const [formData, setFormData] = useState({
    name: "",
    type: "Гид",
    location: "",
    photo: null,
    phone: "",
    email: "",
    social: "",
    password: "",
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo") {
      setFormData({ ...formData, photo: files[0] });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = new FormData();
    for (const key in formData) {
      data.append(key, formData[key]);
    }

    try {
      const response = await axios.post(
        "https://travella-fullstack-production.up.railway.app/api/providers/register",
        data
      );
      alert("Успешно зарегистрирован!");
    } catch (error) {
      console.error("Ошибка регистрации", error);
      alert("Ошибка регистрации");
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F1F1] flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-md max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-6 font-[Manrope]"
      >
        <div className="flex flex-col gap-4">
          <label className="font-bold">Название</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <label className="font-bold">Тип поставщика</label>
          <select
            name="type"
            value={formData.type}
            onChange={handleChange}
            className="border p-2 rounded"
          >
            <option value="Гид">Гид</option>
            <option value="Транспорт">Транспорт</option>
          </select>

          <label className="font-bold">Локация</label>
          <input
            type="text"
            name="location"
            placeholder="например, Самарканд, Бухара"
            value={formData.location}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <label className="font-bold">Фото профиля</label>
          <input
            type="file"
            name="photo"
            onChange={handleChange}
            className="border p-2 rounded bg-white"
          />
        </div>

        <div className="flex flex-col gap-4">
          <label className="font-bold">Телефон</label>
          <input
            type="text"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <label className="font-bold">Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <label className="font-bold">Ссылка на соцсети</label>
          <input
            type="text"
            name="social"
            value={formData.social}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <label className="font-bold text-[#FF5722]">Пароль</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            className="border p-2 rounded"
          />

          <button
            type="submit"
            className="bg-[#FF5722] text-white py-2 rounded mt-4 hover:bg-[#FF784E] transition-colors"
          >
            Зарегистрироваться
          </button>
        </div>
      </form>
    </div>
  );
};

export default Register;
