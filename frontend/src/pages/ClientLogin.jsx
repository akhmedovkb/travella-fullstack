import { useState } from "react";
import { useNavigate } from "react-router-dom";

const ClientLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch("https://travella-api.up.railway.app/api/clients/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("clientToken", data.token);
      navigate("/client/dashboard");
    } else {
      alert("Ошибка входа клиента");
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Вход для клиента</h2>
      <form onSubmit={handleSubmit}>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} /><br />
        <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} /><br />
        <button type="submit">Войти</button>
      </form>
    </div>
  );
};

export default ClientLogin;
