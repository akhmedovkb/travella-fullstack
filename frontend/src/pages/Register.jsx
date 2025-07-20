import { useState } from "react";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch("https://travella-api.up.railway.app/api/providers/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (res.ok) {
      alert("Регистрация успешна");
      navigate("/login");
    } else {
      alert("Ошибка при регистрации");
    }
  };

  return (
    <div style={ padding: "2rem" }>
      <h2>Регистрация</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        /><br />
        <input
          placeholder="Пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        /><br />
        <input
          placeholder="Имя"
          value={name}
          onChange={(e) => setName(e.target.value)}
        /><br />
        <button type="submit">Зарегистрироваться</button>
      </form>
    </div>
  );
};

export default Register;
