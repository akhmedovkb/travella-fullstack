import React, { useState } from "react";
import axios from "axios";

const Register = () => {
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
    const form = new FormData();
    for (const key in formData) {
      form.append(key, formData[key]);
    }

    await axios.post(
      `${import.meta.env.VITE_API_BASE_URL}/api/providers/register`,
      form,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    
    alert("Регистрация прошла успешно!");

  } catch (error) {
    console.error("Ошибка регистрации:", error);
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
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Локация</label>
              <input
                name="location"
                required
                onChange={handleChange}
                placeholder="например, Самарканд, Бухара"
                className="w-full border p-2"
              />
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
