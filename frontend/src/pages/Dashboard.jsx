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
    email: "",
  });

  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  const [services, setServices] = useState([]);
  const [serviceForm, setServiceForm] = useState({
    id: null,
    title: "",
    description: "",
    price: "",
    category: "",
    images: [],
    availability: [],
  });
  const [selectedDates, setSelectedDates] = useState([]);

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  // Загрузка профиля
  useEffect(() => {
    if (token) {
      axios
        .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, config)
        .then((res) => setProfile(res.data))
        .catch((err) => console.error("Ошибка загрузки профиля", err));
    }
  }, []);

  // Загрузка услуг
  useEffect(() => {
    if (token) {
      axios
        .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config)
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
      await axios.put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, profile, config);
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
        config
      );
      setNewPassword("");
      setMessage("Пароль успешно изменён");
    } catch (error) {
      console.error(error);
      setMessage("Ошибка при смене пароля");
    }
  };

  const handleServiceChange = (e) => {
    setServiceForm({ ...serviceForm, [e.target.name]: e.target.value });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setServiceForm((prev) => ({
          ...prev,
          images: [reader.result],
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddOrUpdateService = async () => {
    const data = {
      ...serviceForm,
      availability: selectedDates.map((d) => d.toISOString().split("T")[0]),
    };

    try {
      if (serviceForm.id) {
        // Обновление
        await axios.put(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${serviceForm.id}`,
          data,
          config
        );
      } else {
        // Добавление
        await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/services`,
          data,
          config
        );
      }

      // Очистка формы
      setServiceForm({ id: null, title: "", description: "", price: "", category: "", images: [], availability: [] });
      setSelectedDates([]);
      // Перезагрузка списка
      const res = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, config);
      setServices(res.data);
    } catch (error) {
      console.error("Ошибка добавления/обновления услуги", error);
    }
  };

  const handleEditService = (service) => {
    setServiceForm({
      id: service.id,
      title: service.title,
      description: service.description,
      price: service.price,
      category: service.category,
      images: service.images,
      availability: service.availability,
    });
    setSelectedDates(service.availability.map((d) => new Date(d)));
  };

  const handleDeleteService = async (id) => {
    try {
      await axios.delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config);
      setServices((prev) => prev.filter((s) => s.id !== id));
    } catch (error) {
      console.error("Ошибка удаления", error);
    }
  };

  return (
    <div className="min-h-screen flex p-4 bg-gray-100 gap-6">
      {/* Левая часть: профиль */}
      <div className="w-1/3 bg-white p-4 rounded shadow">
        <h2 className="text-xl font-bold mb-4 text-orange-600">Профиль поставщика</h2>
        <div className="flex justify-center mb-4">
          {profile.photo && (
            <img src={profile.photo} alt="Фото профиля" className="w-32 h-32 object-cover rounded-full border" />
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
        <button onClick={handleUpdateProfile} className="w-full bg-orange-500 text-white font-bold py-2 rounded">
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
        <button onClick={handleChangePassword} className="w-full bg-gray-800 text-white font-bold py-2 rounded">
          Обновить пароль
        </button>
        {message && <p className="text-sm text-center mt-3 text-gray-700">{message}</p>}
      </div>

      {/* Правая часть — услуги и календарь */}
      <div className="w-2/3 bg-white p-4 rounded shadow">
        <h2 className="text-xl font-bold text-orange-600 mb-4">Ваши услуги</h2>

        {/* Список услуг */}
        <div className="space-y-4 mb-6">
          {services.map((s) => (
            <div key={s.id} className="border p-3 rounded shadow-sm bg-gray-50">
              <div className="font-semibold text-lg">{s.title}</div>
              <div className="text-sm text-gray-600 mb-2">{s.description}</div>
              <div className="text-sm">Цена: {s.price} сум</div>
              <div className="text-sm">Категория: {s.category}</div>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => handleEditService(s)}
                  className="px-3 py-1 bg-yellow-500 text-white rounded text-sm"
                >
                  Редактировать
                </button>
                <button
                  onClick={() => handleDeleteService(s.id)}
                  className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Форма добавления/редактирования */}
        <h3 className="font-semibold mb-2 text-orange-600">Добавить/Редактировать услугу</h3>
        <input
          name="title"
          value={serviceForm.title}
          onChange={handleServiceChange}
          placeholder="Название"
          className="w-full border p-2 mb-2"
        />
        <textarea
          name="description"
          value={serviceForm.description}
          onChange={handleServiceChange}
          placeholder="Описание"
          className="w-full border p-2 mb-2"
        />
        <input
          name="price"
          type="number"
          value={serviceForm.price}
          onChange={handleServiceChange}
          placeholder="Цена"
          className="w-full border p-2 mb-2"
        />
        <select
          name="category"
          value={serviceForm.category}
          onChange={handleServiceChange}
          className="w-full border p-2 mb-2"
        >
          <option value="">Выберите категорию</option>
          {profile.type === "guide" && (
            <>
              <option value="city tour">City Tour</option>
              <option value="multiple city tour">Multiple City Tour</option>
              <option value="mountain tour">Mountain Tour</option>
            </>
          )}
          {profile.type === "transport" && (
            <>
              <option value="city tour">City Tour</option>
              <option value="multiple city tour">Multiple City Tour</option>
              <option value="mountain tour">Mountain Tour</option>
              <option value="one way transfer">One Way Transfer</option>
              <option value="dinner transfer">Dinner Transfer</option>
              <option value="border transfer">Border Transfer</option>
            </>
          )}
        </select>
        <input type="file" accept="image/*" onChange={handleImageUpload} className="mb-2" />
        <DayPicker
          mode="multiple"
          selected={selectedDates}
          onSelect={setSelectedDates}
          className="mb-4"
        />
        <button
          onClick={handleAddOrUpdateService}
          className="w-full bg-orange-500 text-white font-bold py-2 rounded"
        >
          {serviceForm.id ? "Сохранить изменения" : "Добавить услугу"}
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
