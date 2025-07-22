import React, { useEffect, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

const Dashboard = () => {
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newCertificate, setNewCertificate] = useState(null);
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [message, setMessage] = useState("");

  const [newServiceTitle, setNewServiceTitle] = useState("");
  const [newServiceDescription, setNewServiceDescription] = useState("");
  const [newServicePrice, setNewServicePrice] = useState("");
  const [newServiceCategory, setNewServiceCategory] = useState("");
  const [newServiceDates, setNewServiceDates] = useState([]);

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
      .then((res) => {
        setProfile(res.data);
        setNewLocation(res.data.location);
        setNewSocial(res.data.social);
        setNewPhone(res.data.phone);
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

  const handleCertificateChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewCertificate(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = () => {
    const updated = {};
    if (newLocation !== profile.location) updated.location = newLocation;
    if (newSocial !== profile.social) updated.social = newSocial;
    if (newPhone !== profile.phone) updated.phone = newPhone;
    if (newPhoto) updated.photo = newPhoto;
    if (newCertificate) updated.certificate = newCertificate;

    if (Object.keys(updated).length === 0) {
      setMessage("Нет изменений для сохранения");
      return;
    }

    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
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

  const handleCreateService = () => {
    if (!newServiceTitle || !newServiceCategory || !newServicePrice || newServiceDates.length === 0) {
      setMessage("Пожалуйста, заполните все поля и выберите даты");
      return;
    }
    axios
      .post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/services`,
        {
          title: newServiceTitle,
          description: newServiceDescription,
          price: newServicePrice,
          category: newServiceCategory,
          availability: newServiceDates
        },
        config
      )
      .then((res) => {
        setServices((prev) => [...prev, res.data]);
        setNewServiceTitle("");
        setNewServiceDescription("");
        setNewServicePrice("");
        setNewServiceCategory("");
        setNewServiceDates([]);
        setMessage("Услуга добавлена");
      })
      .catch(() => setMessage("Ошибка добавления услуги"));
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
      {/* ...Левый блок не изменяется... */}

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
            <input
              type="text"
              placeholder="Название"
              value={newServiceTitle}
              onChange={(e) => setNewServiceTitle(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
            <textarea
              placeholder="Описание"
              value={newServiceDescription}
              onChange={(e) => setNewServiceDescription(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
            <input
              type="text"
              placeholder="Категория"
              value={newServiceCategory}
              onChange={(e) => setNewServiceCategory(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
            <input
              type="number"
              placeholder="Цена"
              value={newServicePrice}
              onChange={(e) => setNewServicePrice(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
            <DayPicker
              mode="multiple"
              selected={newServiceDates}
              onSelect={setNewServiceDates}
              className="border rounded-lg p-4"
            />
            <button
              className="w-full bg-orange-500 text-white py-2 rounded font-bold"
              onClick={handleCreateService}
            >
              Сохранить услугу
            </button>
          </div>
        )}
        {message && <p className="text-sm text-center text-gray-600 mt-4">{message}</p>}
      </div>
    </div>
  );
};

export default Dashboard;
