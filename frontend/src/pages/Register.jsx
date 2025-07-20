
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
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      backgroundColor: "#F1F1F1"
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: "#FFFFFF",
          padding: "2rem",
          borderRadius: "10px",
          width: "100%",
          maxWidth: "500px",
          boxShadow: "0 0 10px rgba(0, 0, 0, 0.1)"
        }}
      >
        <h2 style={{ color: "#FF5722", textAlign: "center", marginBottom: "1.5rem" }}>
          Регистрация поставщика
        </h2>

        <div className="mb-3">
          <label htmlFor="name">Название</label>
          <input name="name" required onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="type">Тип поставщика</label>
          <select name="type" value={formData.type} onChange={handleChange} className="w-full border p-2 mb-2">
            <option value="гид">Гид</option>
            <option value="транспорт">Транспорт</option>
          </select>
        </div>

        <div className="mb-3">
          <label htmlFor="location">Локация</label>
          <input name="location" required onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="phone">Телефон</label>
          <input name="phone" required onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="email">Email</label>
          <input name="email" type="email" required onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="password">Пароль</label>
          <input name="password" type="password" required onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="social">Ссылка на соцсети</label>
          <input name="social" onChange={handleChange} className="w-full border p-2 mb-2" />
        </div>

        <div className="mb-3">
          <label htmlFor="photo">Фото профиля</label>
          <input name="photo" type="file" accept="image/*" onChange={handleChange} className="w-full border p-2 mb-4" />
        </div>

        <button type="submit" style={{
          backgroundColor: "#FF5722",
          color: "#FFF",
          padding: "0.75rem 1.5rem",
          border: "none",
          borderRadius: "5px",
          width: "100%",
          fontWeight: "bold"
        }}>
          Зарегистрироваться
        </button>
      </form>
    </div>
  );
};

export default Register;
