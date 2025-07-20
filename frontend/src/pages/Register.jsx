
import React, { useState } from "react";
import axios from "axios";

const Register = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    type: "гид",
    location: "",
    phone: "",
    social: "",
    photo: ""
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo" && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, photo: reader.result });
      };
      reader.readAsDataURL(files[0]);
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        "https://your-backend-url/api/providers/register",
        formData
      );
      alert(res.data.message);
      window.location.href = "/login";
    } catch (err) {
      alert(err.response?.data?.message || "Ошибка регистрации");
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h2 className="text-xl font-bold mb-4">Регистрация поставщика</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input name="name" placeholder="Название" required onChange={handleChange} className="w-full border p-2" />
        <select name="type" value={formData.type} onChange={handleChange} className="w-full border p-2">
          <option value="гид">Гид</option>
          <option value="транспорт">Транспорт</option>
        </select>
        <input name="location" placeholder="Локация" required onChange={handleChange} className="w-full border p-2" />
        <input name="phone" placeholder="Телефон" required onChange={handleChange} className="w-full border p-2" />
        <input name="email" type="email" placeholder="Email" required onChange={handleChange} className="w-full border p-2" />
        <input name="password" type="password" placeholder="Пароль" required onChange={handleChange} className="w-full border p-2" />
        <input name="social" placeholder="Ссылка на соцсети" onChange={handleChange} className="w-full border p-2" />
        <input name="photo" type="file" accept="image/*" onChange={handleChange} className="w-full border p-2" />
        <button type="submit" className="bg-blue-600 text-white py-2 px-4 rounded">Зарегистрироваться</button>
      </form>
    </div>
  );
};

export default Register;
