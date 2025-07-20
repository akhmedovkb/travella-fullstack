import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const Register = () => {
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

  const cities = [
    "Самарканд", "Бухара", "Ташкент", "Хива", "Коканд",
    "Андижан", "Навои", "Карши", "Фергана", "Термез", "Наманган", "Ургенч"
  ];
  const [locationSuggestions, setLocationSuggestions] = useState([]);

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo" && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, photo: reader.result }));
      };
      reader.readAsDataURL(files[0]);
    } else if (name === "location") {
      const input = value.toLowerCase();
      const filtered = cities.filter((city) =>
        city.toLowerCase().startsWith(input)
      );
      setLocationSuggestions(filtered);
      setFormData((prev) => ({ ...prev, [name]: value }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleLocationSelect = (city) => {
    setFormData((prev) => ({ ...prev, location: city }));
    setLocationSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/register`,
        formData,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      alert("Регистрация прошла успешно!");
      navigate("/login");
    } catch (error) {
      console.error("Ошибка регистрации:", error.response?.data || error.message);
      alert("Ошибка при регистрации.");
    }
  };

  return (
    <div
      style={{
        fontFamily: "Manrope, sans-serif",
        backgroundColor: "#F1F1F1",
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem"
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: "#FFFFFF",
          padding: "2.5rem",
          borderRadius: "10px",
          width: "100%",
          maxWidth: "900px",
          boxShadow: "0 0 20px rgba(0, 0, 0, 0.1)"
        }}
      >
        <h2
          style={{
            fontWeight: "bold",
            fontSize: "1.8rem",
            color: "#FF5722",
            textAlign: "center",
            marginBottom: "2rem",
            fontFamily: "Manrope Bold, sans-serif"
          }}
        >
          Регистрация поставщика
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
          <div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Название</label>
              <input name="name" required onChange={handleChange} className="w-full border p-2" />
            </div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Тип поставщика</label>
              <select name="type" value={formData.type} onChange={handleChange} className="w-full border p-2">
                <option value="гид">Гид</option>
                <option value="транспорт">Транспорт</option>
              </select>
            </div>

            <div style={{ position: "relative", marginBottom: "1.5rem" }}>
              <label>Локация</label>
              <input
                name="location"
                required
                value={formData.location}
                onChange={handleChange}
                placeholder="например, Самарканд, Бухара"
                className="w-full border p-2"
                autoComplete="off"
              />
              {locationSuggestions.length > 0 && (
                <ul
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    backgroundColor: "#fff",
                    border: "1px solid #ccc",
                    zIndex: 10,
                    maxHeight: "150px",
                    overflowY: "auto",
                    marginTop: "0.25rem",
                  }}
                >
                  {locationSuggestions.map((city, index) => (
                    <li
                      key={index}
                      onClick={() => handleLocationSelect(city)}
                      style={{
                        padding: "0.5rem",
                        cursor: "pointer",
                      }}
                    >
                      {city}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label>Фото профиля</label>
              <input
                name="photo"
                type="file"
                accept="image/*"
                onChange={handleChange}
                className="w-full border p-2"
              />
            </div>
          </div>

          <div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Телефон</label>
              <input name="phone" required onChange={handleChange} className="w-full border p-2" />
            </div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Email</label>
              <input name="email" type="email" required onChange={handleChange} className="w-full border p-2" />
            </div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Ссылка на соцсети</label>
              <input name="social" onChange={handleChange} className="w-full border p-2" />
            </div>
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Пароль</label>
              <input
                name="password"
                type="password"
                required
                onChange={handleChange}
                className="w-full border p-2"
                style={{
                  border: "2px solid #FF5722",
                  fontWeight: "bold"
                }}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          style={{
            backgroundColor: "#FF5722",
            color: "#FFF",
            padding: "0.75rem 1.5rem",
            border: "none",
            borderRadius: "5px",
            width: "100%",
            fontWeight: "bold",
            marginTop: "1.5rem",
            fontFamily: "Manrope Bold, sans-serif"
          }}
        >
          Зарегистрироваться
        </button>
      </form>
    </div>
  );
};

export default Register;
