// pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const Dashboard = () => {
  const [provider, setProvider] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [tempData, setTempData] = useState({
    phone: "",
    photo: "",
    social: "",
  });

  const token = localStorage.getItem("token");

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await axios.get(
          "https://travella-fullstack-backend-production.up.railway.app/api/providers/profile",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        setProvider(res.data);
      } catch (err) {
        console.error("Ошибка при загрузке профиля", err);
      }
    };

    fetchProfile();
  }, [token]);

  const handleEdit = (field) => {
    setEditingField(field);
    setTempData((prev) => ({ ...prev, [field]: provider[field] || "" }));
  };

  const handleSave = async (field) => {
    try {
      const res = await axios.put(
        "https://travella-fullstack-backend-production.up.railway.app/api/providers/profile",
        { [field]: tempData[field] },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProvider((prev) => ({ ...prev, [field]: tempData[field] }));
      setEditingField(null);
    } catch (err) {
      console.error("Ошибка при сохранении поля", field, err);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen p-4 gap-6 bg-gray-50">
      {/* Левая колонка — Профиль */}
      <div className="w-full md:w-1/3 bg-white shadow-md rounded-xl p-4">
        <h2 className="text-xl font-semibold mb-4">Профиль</h2>

        {/* Имя */}
        <div className="mb-2">
          <p className="text-sm text-gray-600">Имя</p>
          <p className="font-medium">{provider?.name}</p>
        </div>

        {/* Тип */}
        <div className="mb-2">
          <p className="text-sm text-gray-600">Тип</p>
          <p className="font-medium">{provider?.type}</p>
        </div>

        {/* Локация */}
        <div className="mb-2">
          <p className="text-sm text-gray-600">Локация</p>
          <p className="font-medium">{provider?.location}</p>
        </div>

        {/* Блок: смена пароля */}
        <div className="my-6">
          <h3 className="text-sm font-semibold mb-2">Сменить пароль</h3>
          <input
            type="password"
            placeholder="Новый пароль"
            className="w-full border p-2 rounded mb-2"
          />
          <button className="bg-blue-500 text-white px-4 py-2 rounded">
            Обновить пароль
          </button>
        </div>

        {/* 🔽 Ниже — редактируемые поля */}

        {/* Фото */}
        <div className="my-4">
          <p className="text-sm text-gray-600">Фото</p>
          {editingField === "photo" ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={tempData.photo}
                onChange={(e) =>
                  setTempData({ ...tempData, photo: e.target.value })
                }
                className="border p-2 rounded"
              />
              <img
                src={tempData.photo}
                alt="Предпросмотр"
                className="w-20 h-20 rounded-full object-cover"
              />
              <button
                onClick={() => handleSave("photo")}
                className="bg-green-500 text-white px-4 py-1 rounded"
              >
                Сохранить
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {provider?.photo && (
                <img
                  src={provider.photo}
                  alt="Фото"
                  className="w-12 h-12 rounded-full object-cover"
                />
              )}
              <button
                onClick={() => handleEdit("photo")}
                className="text-blue-500 text-sm"
              >
                ✏️ Изменить
              </button>
            </div>
          )}
        </div>

        {/* Телефон */}
        <div className="my-4">
          <p className="text-sm text-gray-600">Телефон</p>
          {editingField === "phone" ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={tempData.phone}
                onChange={(e) =>
                  setTempData({ ...tempData, phone: e.target.value })
                }
                className="border p-2 rounded w-full"
              />
              <button
                onClick={() => handleSave("phone")}
                className="bg-green-500 text-white px-4 py-1 rounded"
              >
                Сохранить
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="font-medium">{provider?.phone || "—"}</p>
              <button
                onClick={() => handleEdit("phone")}
                className="text-blue-500 text-sm"
              >
                ✏️ Изменить
              </button>
            </div>
          )}
        </div>

        {/* Соцсети */}
        <div className="my-4">
          <p className="text-sm text-gray-600">Соцсети</p>
          {editingField === "social" ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={tempData.social}
                onChange={(e) =>
                  setTempData({ ...tempData, social: e.target.value })
                }
                className="border p-2 rounded w-full"
              />
              <button
                onClick={() => handleSave("social")}
                className="bg-green-500 text-white px-4 py-1 rounded"
              >
                Сохранить
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="font-medium">{provider?.social || "—"}</p>
              <button
                onClick={() => handleEdit("social")}
                className="text-blue-500 text-sm"
              >
                ✏️ Изменить
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Правая колонка — Услуги */}
      <div className="w-full md:w-2/3 bg-white shadow-md rounded-xl p-4">
        <h2 className="text-xl font-semibold mb-4">Ваши услуги</h2>

        {/* Здесь будет форма и список услуг */}

        <p className="text-gray-500">Раздел в разработке...</p>
      </div>
    </div>
  );
};

export default Dashboard;
