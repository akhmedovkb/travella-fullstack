import { useState } from "react";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState([]);
  const [photo, setPhoto] = useState("");
  const [phone, setPhone] = useState("");
  const [social, setSocial] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleLocationChange = (e) => {
    const cities = e.target.value.split(",").map(city => city.trim());
    setLocation(cities);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch("https://travella-api.up.railway.app/api/providers/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, location, photo, phone, social, email, password }),
    });
    if (res.ok) {
      alert("Регистрация успешна");
      navigate("/login");
    } else {
      alert("Ошибка регистрации");
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Регистрация поставщика</h2>
      <form onSubmit={handleSubmit}>
        <select value={type} onChange={(e) => setType(e.target.value)} required>
          <option value="">Выберите тип поставщика</option>
          <option value="гид">Гид</option>
          <option value="транспорт">Транспорт</option>
        </select><br />

        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} required /><br />
        <input placeholder="Локация (через запятую)" value={location.join(", ")} onChange={handleLocationChange} required /><br />
        <input type="file" accept="image/*" onChange={handlePhotoChange} required /><br />
        <input placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} required /><br />
        <input type="url" placeholder="Ссылка на соцсеть" value={social} onChange={(e) => setSocial(e.target.value)} /><br />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required /><br />
        <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required /><br />
        <button type="submit">Зарегистрироваться</button>
      </form>
    </div>
  );
};

export default Register;
