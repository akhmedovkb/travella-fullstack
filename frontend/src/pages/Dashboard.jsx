import React, { useEffect, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const Dashboard = () => {
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [message, setMessage] = useState("");

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
      .then((res) => {
        setProfile(res.data);
        setNewLocation(res.data.location);
        setNewSocial(res.data.social);
      })
      .catch((err) => console.error("Ошибка загрузки профиля", err));

    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
      .then((res) => setServices(res.data))
      .catch((err) => console.error("Ошибка загрузки услуг", err));
  }, []);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewPhoto(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = () => {
    const updated = {
      ...profile,
      location: newLocation,
      social: newSocial,
      photo: newPhoto || profile.photo,
    };
    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile(updated);
        setIsEditing(false);
        setMessage("Профиль обновлён");
      })
      .catch(() => setMessage("Ошибка обновления"));
  };

  const handleChangePassword = () => {
    axios
      .put(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/change-password`,
        { password: newPassword },
        config
      )
      .then(() => {
        setNewPassword("");
        setMessage("Пароль обновлён");
      })
      .catch(() => setMessage("Ошибка смены пароля"));
  };

  const handleDeleteService = (id) => {
    axios
      .delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config)
      .then(() => setServices((prev) => prev.filter((s) => s.id !== id)))
      .catch(() => setMessage("Ошибка удаления"));
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
      {/* Левый блок */}
      <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md flex flex-col">
        <h2 className="text-2xl font-bold mb-4">Профиль поставщика</h2>
        <div className="flex gap-4">
          {/* Левая колонка */}
          <div className="flex flex-col items-center w-1/2">
            {profile.photo || newPhoto ? (
              <img
                src={newPhoto || profile.photo}
                className="w-24 h-24 rounded-full object-cover mb-2"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gray-200 mb-2" />
            )}
            <input type="file" onChange={handlePhotoChange} className="text-sm" />
            <h3 className="font-semibold text-lg mt-6 mb-2">Сменить пароль</h3>
            <input
              type="password"
              placeholder="Новый пароль"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="border px-3 py-2 mb-2 rounded w-full"
            />
            <button
              onClick={handleChangePassword}
              className="w-full bg-orange-500 text-white py-2 rounded font-bold"
            >
              Сменить
            </button>
          </div>

          {/* Правая колонка */}
          <div className="w-1/2 space-y-3">
            <div>
              <label className="block font-medium">Наименование</label>
              <div className="border px-3 py-2 rounded bg-gray-100">{profile.name}</div>
            </div>
            <div>
              <label className="block font-medium">Тип поставщика</label>
              <div className="border px-3 py-2 rounded bg-gray-100">{profile.type}</div>
            </div>
            <div>
              <label className="block font-medium">Локация</label>
              {isEditing ? (
                <input
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 rounded bg-gray-100">{profile.location}</div>
              )}
            </div>
            <div>
              <label className="block font-medium">Ссылка на соцсети</label>
              {isEditing ? (
                <input
                  value={newSocial}
                  onChange={(e) => setNewSocial(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 rounded bg-gray-100">{profile.social}</div>
              )}
            </div>

            <button
              onClick={isEditing ? handleSaveProfile : () => setIsEditing(true)}
              className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
            >
              {isEditing ? "Сохранить" : "Редактировать"}
            </button>
          </div>
        </div>
        {message && <p className="text-sm text-center text-gray-600 mt-4">{message}</p>}
      </div>

      {/* Правый блок — Услуги */}
      <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Услуги</h2>
          <button
            className="bg-orange-500 text-white px-4 py-2 rounded font-semibold"
            onClick={() => setSelectedService(null)}
          >
            + Добавить услугу
          </button>
        </div>

        {selectedService ? (
          <>
            <h3 className="text-lg font-medium mb-2">{selectedService.title}</h3>
            <DayPicker
              mode="multiple"
              selected={selectedService.availability.map((d) => new Date(d))}
              disabled
              className="border rounded-lg p-4 mb-4"
            />
            <div className="flex gap-4">
              <button className="w-full bg-orange-500 text-white py-2 rounded font-bold">
                Редактировать
              </button>
              <button
                className="w-full bg-red-600 text-white py-2 rounded font-bold"
                onClick={() => handleDeleteService(selectedService.id)}
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
                className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
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
