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
      await axios.post(
        "https://travella-fullstack-production.up.railway.app/api/providers/register",
        data
      );
      alert("Успешно зарегистрировано!");
    } catch (error) {
      alert("Ошибка при регистрации");
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F1F1F1] font-[Manrope]">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-10 rounded shadow-md w-full max-w-5xl grid grid-cols-2 gap-8 text-[#333]"
      >
        {/* Левая колонка */}
        <div className="flex flex-col space-y-6">
          <div>
            <label className="block font-bold mb-2">Название</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full p-3 border rounded"
              required
            />
          </div>

          <div>
            <label className="block font-bold mb-2">Тип поставщика</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="w-full p-3 border rounded"
              required
            >
              <option value="Гид">Гид</option>
              <option value="Транспорт">Транспорт</option>
            </select>
          </div>

          <div>
            <label className="block font-bold mb-2">Локация</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              className="w-full p-3 border rounded"
              placeholder="например, Самарканд, Бухара"
              required
            />
          </div>

          <div>
            <label className="block font-bold mb-2">Фото профиля</label>
            <input
              type="file"
              name="photo"
              accept="image/*"
              onChange={handleChange}
              className="w-full p-2 border rounded"
              required
            />
          </div>
        </div>

        {/* Правая колонка */}
        <div className="flex flex-col space-y-6">
          <div>
            <label className="block font-bold mb-2">Телефон</label>
            <input
              type="text"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="w-full p-3 border rounded"
              required
            />
          </div>

          <div>
            <label className="block font-bold mb-2">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full p-3 border rounded"
              required
            />
          </div>

          <div>
            <label className="block font-bold mb-2">Ссылка на соцсети</label>
            <input
              type="text"
              name="social"
              value={formData.social}
              onChange={handleChange}
              className="w-full p-3 border rounded"
            />
          </div>

          <div>
            <label className="block font-bold mb-2 text-[#FF5722]">
              Пароль
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full p-3 border-2 border-[#FF5722] rounded font-semibold"
              required
            />
          </div>
        </div>

        <div className="col-span-2 text-center mt-4">
          <button
            type="submit"
            className="bg-[#FF5722] text-white px-6 py-3 rounded hover:bg-[#FFAD7A] transition"
          >
            Зарегистрироваться
          </button>
        </div>
      </form>
    </div>
  );
};

export default Register;
