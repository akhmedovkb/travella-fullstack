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

  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");

    if (token) {
      axios
        .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => setProfile(res.data))
        .catch((err) => console.error("Ошибка загрузки профиля", err));
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
    const token = localStorage.getItem("token");
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
    const token = localStorage.getItem("token");
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
        <input
          name="name"
          value={profile.name}
          onChange={handleChange}
          className="w-full border p-2 mb-3"
        />

        <label className="block mb-1 font-medium">Тип поставщика</label>
        <input
          value={profile.type}
          disabled
          className="w-full border p-2 mb-3 bg-gray-100"
        />

        <label className="block mb-1 font-medium">Локация</label>
        <input
          name="location"
          value={profile.location}
          onChange={handleChange}
          className="w-full border p-2 mb-3"
        />

        <label className="block mb-1 font-medium">Телефон</label>
        <input
          name="phone"
          value={profile.phone}
          onChange={handleChange}
          className="w-full border p-2 mb-3"
        />

        <label className="block mb-1 font-medium">Ссылки на соцсети</label>
        <input
          name="social"
          value={profile.social}
          onChange={handleChange}
          className="w-full border p-2 mb-4"
        />

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

        {message && (
          <p className="text-sm text-center mt-3 text-gray-700">{message}</p>
        )}
      </div>

      {/* Правая часть — пока пустая, позже вставим услуги и календарь */}
      <div className="w-2/3 bg-white p-4 rounded shadow">
        <h2 className="text-xl font-bold text-orange-600">Ваши услуги</h2>
        {/* Тут будет календарь и управление услугами */}
      </div>
    </div>
  );
};

export default Dashboard;
