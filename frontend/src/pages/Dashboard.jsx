
import React, { useState, useEffect } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const Dashboard = () => {
  const [profile, setProfile] = useState({
    name: "",
    type: "",
    location: "",
    social: "",
    photo: "",
  });
  const [editMode, setEditMode] = useState({
    location: false,
    social: false,
    photo: false,
  });
  const [newPassword, setNewPassword] = useState({ old: "", new: "" });
  const [message, setMessage] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    if (token) {
      axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
        .then((res) => setProfile(res.data))
        .catch((err) => console.error("Ошибка загрузки профиля", err));

      axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
        .then((res) => setServices(res.data))
        .catch((err) => console.error("Ошибка загрузки услуг", err));
    }
  }, []);

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
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

  const handleUpdateField = async (field) => {
    try {
      await axios.put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, profile, config);
      setEditMode((prev) => ({ ...prev, [field]: false }));
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
        { oldPassword: newPassword.old, password: newPassword.new },
        config
      );
      setNewPassword({ old: "", new: "" });
      setMessage("Пароль успешно изменён");
    } catch (error) {
      console.error(error);
      setMessage("Ошибка при смене пароля");
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen p-6 bg-gray-50 gap-6 font-sans">
      {/* Профиль */}
      <div className="w-full md:w-1/2 bg-white rounded-xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6">Профиль поставщика</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Левая колонка */}
          <div>
            <div className="flex flex-col items-center gap-4 mb-6">
              {profile.photo ? (
                <img src={profile.photo} alt="Фото" className="w-24 h-24 rounded-full object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-200" />
              )}
              {editMode.photo ? (
                <>
                  <input type="file" onChange={handlePhotoChange} />
                  <button
                    onClick={() => handleUpdateField("photo")}
                    className="bg-orange-500 text-white px-3 py-1 rounded"
                  >
                    Сохранить
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditMode({ ...editMode, photo: true })}
                  className="text-sm text-orange-600 underline"
                >
                  Изменить фото
                </button>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-lg mb-2">Сменить пароль</h3>
              <input
                type="password"
                placeholder="Старый пароль"
                value={newPassword.old}
                onChange={(e) => setNewPassword({ ...newPassword, old: e.target.value })}
                className="w-full border rounded px-3 py-2 mb-2"
              />
              <input
                type="password"
                placeholder="Новый пароль"
                value={newPassword.new}
                onChange={(e) => setNewPassword({ ...newPassword, new: e.target.value })}
                className="w-full border rounded px-3 py-2 mb-3"
              />
              <button onClick={handleChangePassword} className="w-full bg-black text-white py-2 rounded font-bold">
                Сменить
              </button>
            </div>
          </div>

          {/* Правая колонка */}
          <div className="space-y-4">
            <div>
              <label className="block font-medium mb-1">Наименование</label>
              <div className="w-full border rounded px-3 py-2 bg-gray-100">{profile.name}</div>
            </div>
            <div>
              <label className="block font-medium mb-1">Тип поставщика</label>
              <div className="w-full border rounded px-3 py-2 bg-gray-100">{profile.type}</div>
            </div>
            <div>
              <label className="block font-medium mb-1">Локация</label>
              {editMode.location ? (
                <div className="flex gap-2">
                  <input
                    name="location"
                    value={profile.location}
                    onChange={handleFieldChange}
                    className="w-full border rounded px-3 py-2"
                  />
                  <button
                    onClick={() => handleUpdateField("location")}
                    className="bg-orange-500 text-white px-3 rounded"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div>{profile.location}</div>
                  <button
                    onClick={() => setEditMode({ ...editMode, location: true })}
                    className="text-sm text-orange-600 underline"
                  >
                    Редактировать
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block font-medium mb-1">Ссылка на соцсети</label>
              {editMode.social ? (
                <div className="flex gap-2">
                  <input
                    name="social"
                    value={profile.social}
                    onChange={handleFieldChange}
                    className="w-full border rounded px-3 py-2"
                  />
                  <button
                    onClick={() => handleUpdateField("social")}
                    className="bg-orange-500 text-white px-3 rounded"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div className="truncate">{profile.social}</div>
                  <button
                    onClick={() => setEditMode({ ...editMode, social: true })}
                    className="text-sm text-orange-600 underline"
                  >
                    Редактировать
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {message && <p className="text-sm text-center mt-4 text-gray-600">{message}</p>}
      </div>
    </div>
  );
};

export default Dashboard;
