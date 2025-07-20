import React, { useState } from "react";
import axios from "axios";

const Register = () => {
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    location: "",
    photo: "",
    phone: "",
    email: "",
    social: "",
    password: "",
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo") {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, photo: reader.result });
      };
      if (files && files[0]) {
        reader.readAsDataURL(files[0]);
      }
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/register`, formData);
      alert("Успешная регистрация!");
    } catch (error) {
      console.error("Ошибка регистрации:", error);
      alert("Ошибка при регистрации.");
    }
  };

  return (
    <div
      style={{
        fontFamily: "Manrope, sans-serif",
        background: "#F1F1F1",
        minHeight: "100vh",
        padding: "2rem",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "2rem",
          justifyContent: "center",
          background: "#fff",
          padding: "2rem",
          borderRadius: "8px",
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <label>Название
            <input name="name" type="text" onChange={handleChange} />
          </label>
          <label>Тип поставщика
            <select name="type" onChange={handleChange}>
              <option value="">Выберите тип</option>
              <option value="Гид">Гид</option>
              <option value="Транспорт">Транспорт</option>
            </select>
          </label>
          <label>Локация
            <input name="location" type="text" onChange={handleChange} />
          </label>
          <label>Фото профиля
            <input name="photo" type="file" accept="image/*" onChange={handleChange} />
          </label>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <label>Телефон
            <input name="phone" type="text" onChange={handleChange} />
          </label>
          <label>Email
            <input name="email" type="email" onChange={handleChange} />
          </label>
          <label>Ссылки на соцсети
            <input name="social" type="text" onChange={handleChange} />
          </label>
          <label style={{ fontWeight: "bold", color: "#FF5722" }}>Пароль
            <input name="password" type="password" onChange={handleChange} />
          </label>
          <button
            type="submit"
            style={{
              marginTop: "1rem",
              background: "#FF5722",
              color: "#fff",
              padding: "0.75rem",
              borderRadius: "6px",
              fontWeight: "bold",
            }}
          >
            Зарегистрироваться
          </button>
        </div>
      </form>
    </div>
  );
};

export default Register;
