
import React, { useState, useEffect } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const Dashboard = () => {
  const [profile, setProfile] = useState({
    name: "",
    type: "",
    location: "",
    phone: "",
    social: "",
    photo: "",
  });

  const [newPassword, setNewPassword] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [message, setMessage] = useState("");

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
      .then((res) => setProfile(res.data))
      .catch((err) => console.error("Ошибка профиля", err));

    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
      .then((res) => setServices(res.data))
      .catch((err) => console.error("Ошибка услуг", err));
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
      await axios.put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, profile, config);
      setMessage("Профиль обновлён");
    } catch {
      setMessage("Ошибка при обновлении профиля");
    }
  };

  const handleChangePassword = async () => {
    try {
      await axios.put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/change-password`, { password: newPassword }, config);
      setNewPassword("");
      setMessage("Пароль обновлён");
    } catch {
      setMessage("Ошибка при смене пароля");
    }
  };

  const handleDeleteService = async (id) => {
    try {
      await axios.delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config);
      setServices((prev) => prev.filter((s) => s.id !== id));
      setSelectedService(null);
    } catch (err) {
      console.error("Ошибка удаления", err);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 bg-gray-50 p-6 min-h-screen font-sans">
      <div className="w-full md:w-1/2 bg-white rounded-xl shadow p-6">
        <h2 className="text-2xl font-bold mb-6">Профиль поставщика</h2>
        <div className="flex items-center gap-4 mb-4">
          {profile.photo ? (
            <img src={profile.photo} className="w-24 h-24 rounded-full object-cover" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-200" />
          )}
          <input type="file" onChange={handlePhotoChange} className="text-sm" />
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Наименование</label>
            <input value={profile.name} disabled className="w-full border rounded px-3 py-2 bg-gray-100" />
          </div>
          <div>
            <label className="text-sm font-medium">Тип поставщика</label>
            <input value={profile.type} disabled className="w-full border rounded px-3 py-2 bg-gray-100" />
          </div>
          <div>
            <label className="text-sm font-medium">Локация</label>
            <input name="location" value={profile.location} onChange={handleChange} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="text-sm font-medium">Телефон</label>
            <input name="phone" value={profile.phone} onChange={handleChange} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="text-sm font-medium">Ссылка на соцсети</label>
            <input name="social" value={profile.social} onChange={handleChange} className="w-full border rounded px-3 py-2" />
          </div>
        </div>

        <button onClick={handleUpdateProfile} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white py-2 px-4 rounded font-semibold w-full">
          Сохранить
        </button>

        <div className="mt-6">
          <h3 className="font-semibold text-lg mb-2">Сменить пароль</h3>
          <input
            type="password"
            placeholder="Новый пароль"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-3"
          />
          <button
            onClick={handleChangePassword}
            className="w-full bg-black text-white py-2 rounded font-bold"
          >
            Сменить
          </button>
        </div>

        {message && <p className="text-sm text-center mt-4 text-gray-600">{message}</p>}
      </div>

      <div className="w-full md:w-1/2 bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Услуги</h2>
          <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded font-semibold">
            + Добавить услугу
          </button>
        </div>

        {selectedService ? (
          <>
            <h3 className="text-lg font-medium mb-3">{selectedService.title}</h3>
            <DayPicker
              mode="multiple"
              selected={selectedService.availability.map((d) => new Date(d))}
              disabled
              className="border rounded-lg p-4 mb-4"
            />
            <div className="flex gap-4">
              <button className="w-full bg-orange-500 text-white py-2 rounded font-bold">Редактировать</button>
              <button
                onClick={() => handleDeleteService(selectedService.id)}
                className="w-full bg-red-600 text-white py-2 rounded font-bold"
              >
                Удалить
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {services.map((s) => (
              <div
                key={s.id}
                className="border rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition cursor-pointer"
                onClick={() => setSelectedService(s)}
              >
                <div className="font-bold text-lg">{s.title}</div>
                <div className="text-sm text-gray-600">{s.category}</div>
                <div className="text-sm text-gray-800">Цена: {s.price} сум</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
