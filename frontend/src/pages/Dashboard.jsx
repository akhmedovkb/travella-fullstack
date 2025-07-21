import React, { useState, useEffect } from "react";
import axios from "axios";

const Dashboard = () => {
  const [profile, setProfile] = useState({
    name: "",
    type: "",
    location: "",
    phone: "",
    social: "",
    photo: "",
    email: "",
  });

  const [services, setServices] = useState([]);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [serviceForm, setServiceForm] = useState({
    title: "",
    description: "",
    price: "",
    category: "",
    images: [],
    availability: [],
  });

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (token) {
      axios
        .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => setProfile(res.data))
        .catch((err) => console.error("Ошибка загрузки профиля", err));

      axios
        .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => setServices(res.data))
        .catch((err) => console.error("Ошибка загрузки услуг", err));
    }
  }, []);

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile((prev) => ({ ...prev, photo: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpdateProfile = async () => {
    try {
      await axios.put(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`,
        profile,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setMessage("Профиль обновлён");
    } catch (error) {
      console.error(error);
      setMessage("Ошибка обновления профиля");
    }
  };

  const handleChangePassword = async () => {
    try {
      await axios.put(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/change-password`,
        { password: newPassword },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setNewPassword("");
      setMessage("Пароль успешно изменён");
    } catch (error) {
      console.error(error);
      setMessage("Ошибка при смене пароля");
    }
  };

  const handleServiceChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "images") {
      const file = files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setServiceForm((prev) => ({
          ...prev,
          images: [reader.result],
        }));
      };
      reader.readAsDataURL(file);
    } else {
      setServiceForm({ ...serviceForm, [name]: value });
    }
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/services`,
        serviceForm,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setServices([...services, res.data]);
      setServiceForm({
        title: "",
        description: "",
        price: "",
        category: "",
        images: [],
        availability: [],
      });
    } catch (error) {
      console.error("Ошибка при добавлении услуги", error);
    }
  };

  const getCategories = () => {
    if (profile.type === "гид") {
      return [
        "City Tour",
        "Multiple City Tour",
        "Mountain Tour"
      ];
    } else if (profile.type === "транспорт") {
      return [
        "City Tour",
        "Multiple City Tour",
        "Mountain Tour",
        "One Way Transfer",
        "Dinner Transfer",
        "Border Transfer"
      ];
    } else return [];
  };

  return (
    <div className="min-h-screen flex p-4 bg-gray-100 gap-6">
      {/* Левая часть: профиль */}
      <div className="w-1/3 bg-white p-4 rounded shadow">
        <h2 className="text-xl font-bold mb-4 text-orange-600">Профиль поставщика</h2>

        <div className="flex justify-center mb-4">
          {profile.photo && (
            <img
              src={profile.photo}
              alt="Фото профиля"
              className="w-32 h-32 object-cover rounded-full border"
            />
          )}
        </div>

        <input type="file" accept="image/*" onChange={handlePhotoChange} className="mb-4" />

        <label className="block mb-1 font-medium">Наименование</label>
        <input name="name" value={profile.name} onChange={handleChange} className="w-full border p-2 mb-3" />

        <label className="block mb-1 font-medium">Тип поставщика</label>
        <input value={profile.type} disabled className="w-full border p-2 mb-3 bg-gray-100" />

        <label className="block mb-1 font-medium">Локация</label>
        <input name="location" value={profile.location} onChange={handleChange} className="w-full border p-2 mb-3" />

        <label className="block mb-1 font-medium">Телефон</label>
        <input name="phone" value={profile.phone} onChange={handleChange} className="w-full border p-2 mb-3" />

        <label className="block mb-1 font-medium">Ссылки на соцсети</label>
        <input name="social" value={profile.social} onChange={handleChange} className="w-full border p-2 mb-4" />

        <button
          onClick={handleUpdateProfile}
          className="w-full bg-orange-500 text-white font-bold py-2 rounded"
        >
          Сохранить профиль
        </button>

        <hr className="my-4" />

        <h3 className="font-semibold mb-2 text-orange-600">Сменить пароль</h3>
        <input
          type="password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full border p-2 mb-3"
        />
        <button
          onClick={handleChangePassword}
          className="w-full bg-gray-800 text-white font-bold py-2 rounded"
        >
          Обновить пароль
        </button>

        {message && <p className="text-sm text-center mt-3 text-gray-700">{message}</p>}
      </div>

      {/* Правая часть: услуги */}
      <div className="w-2/3 bg-white p-4 rounded shadow">
        <h2 className="text-xl font-bold text-orange-600 mb-4">Добавить услугу</h2>

        <form onSubmit={handleAddService} className="grid grid-cols-2 gap-4 mb-6">
          <input name="title" placeholder="Название" value={serviceForm.title} onChange={handleServiceChange} className="border p-2" required />
          <select name="category" value={serviceForm.category} onChange={handleServiceChange} className="border p-2" required>
            <option value="">Категория</option>
            {getCategories().map((cat, i) => (
              <option key={i} value={cat}>{cat}</option>
            ))}
          </select>
          <input name="price" type="number" placeholder="Цена" value={serviceForm.price} onChange={handleServiceChange} className="border p-2" required />
          <input name="images" type="file" accept="image/*" onChange={handleServiceChange} className="border p-2" />
          <textarea name="description" placeholder="Описание" value={serviceForm.description} onChange={handleServiceChange} className="col-span-2 border p-2" />
          <button type="submit" className="col-span-2 bg-orange-500 text-white font-bold py-2 rounded">
            Добавить услугу
          </button>
        </form>

        <h3 className="text-lg font-semibold mb-2">Ваши услуги:</h3>
        <ul className="space-y-3">
          {services.map((s) => (
            <li key={s.id} className="border p-3 rounded shadow-sm">
              <div className="font-bold">{s.title}</div>
              <div className="text-sm text-gray-600">{s.category} — {s.price} сум</div>
              <div className="text-sm mt-1 text-gray-700">{s.description}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Dashboard;
