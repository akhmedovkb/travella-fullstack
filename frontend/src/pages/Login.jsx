import React, { useState } from "react";
import axios from "axios";

const Login = () => {
  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/login`,
        formData
      );
      alert("Успешный вход");
      localStorage.setItem("token", res.data.token);
      window.location.href = "/dashboard";
    } catch (err) {
      alert(err.response?.data?.message || "Ошибка входа");
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
        <h2 style={{ color: "#FF5722", textAlign: "center", marginBottom: "2rem" }}>
          Вход для поставщика
        </h2>

        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="email">Email</label>
          <input
            name="email"
            type="email"
            required
            onChange={handleChange}
            className="w-full border p-2"
          />
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="password">Пароль</label>
          <input
            name="password"
            type="password"
            required
            onChange={handleChange}
            className="w-full border p-2"
          />
        </div>

        <button type="submit" style={{
          backgroundColor: "#FF5722",
          color: "#FFF",
          padding: "0.75rem 1.5rem",
          border: "none",
          borderRadius: "5px",
          width: "100%",
          fontWeight: "bold",
          marginBottom: "1rem"
        }}>
          Войти
        </button>

        <div style={{ textAlign: "center" }}>
          <a href="/register" style={{ color: "#FF5722", fontWeight: "600" }}>
            Нет аккаунта? Зарегистрируйтесь
          </a>
        </div>
      </form>
    </div>
  );
};

export default Login;
