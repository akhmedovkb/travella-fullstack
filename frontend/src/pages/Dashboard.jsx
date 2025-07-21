import React from "react";

const Dashboard = () => {
  return (
    <div
      style={{
        display: "flex",
        padding: "2rem",
        gap: "2rem",
        backgroundColor: "#f5f5f5",
        minHeight: "100vh",
        fontFamily: "Manrope, sans-serif"
      }}
    >
      {/* Левый блок — Профиль */}
      <div
        style={{
          flex: "0 0 30%",
          backgroundColor: "#fff",
          padding: "1.5rem",
          borderRadius: "8px",
          boxShadow: "0 0 10px rgba(0,0,0,0.05)"
        }}
      >
        <h2 style={{ color: "#FF5722", marginBottom: "1rem" }}>Профиль</h2>

        <div style={{ textAlign: "center", marginBottom: "1rem" }}>
          <img
            src="/default-profile.jpg"
            alt="Фото"
            style={{
              width: "8rem",
              height: "8rem",
              borderRadius: "50%",
              objectFit: "cover",
              marginBottom: "1rem"
            }}
          />
          <input type="file" accept="image/*" />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>Наименование</label>
          <input className="w-full border p-2" />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>Тип поставщика</label>
          <input className="w-full border p-2 bg-gray-100" disabled />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>Локация</label>
          <input className="w-full border p-2" />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>Телефон</label>
          <input className="w-full border p-2" />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>Соцсети</label>
          <input className="w-full border p-2" />
        </div>

        <hr style={{ margin: "1.5rem 0" }} />

        <h3 style={{ fontSize: "1rem", marginBottom: "1rem", color: "#FF5722" }}>
          Смена пароля
        </h3>
        <input
          type="password"
          placeholder="Новый пароль"
          className="w-full border p-2 mb-2"
        />
        <input
          type="password"
          placeholder="Повторите пароль"
          className="w-full border p-2 mb-2"
        />
        <button
          style={{
            backgroundColor: "#FF5722",
            color: "white",
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: "4px",
            width: "100%",
            fontWeight: "bold"
          }}
        >
          Обновить пароль
        </button>
      </div>

      {/* Правый блок — Услуги */}
      <div
        style={{
          flex: "1",
          backgroundColor: "#fff",
          padding: "1.5rem",
          borderRadius: "8px",
          boxShadow: "0 0 10px rgba(0,0,0,0.05)"
        }}
      >
        <h2 style={{ color: "#FF5722", marginBottom: "1rem" }}>
          Ваши услуги и календарь
        </h2>
        <p>Сюда добавим интерфейс управления услугами и календарь бронирования…</p>
      </div>
    </div>
  );
};

export default Dashboard;
