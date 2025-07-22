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
  const [messageProfile, setMessageProfile] = useState("");
  const [messageService, setMessageService] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]);
  const [images, setImages] = useState([]);

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

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveService = () => {
    if (!title || !description || !category || !price || availability.length === 0) {
      setMessageService("Заполните все поля и выберите даты");
      return;
    }

    const data = { title, description, category, price, availability, images };

    if (selectedService) {
      axios
        .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${selectedService.id}`, data, config)
        .then(() => {
          setServices((prev) =>
            prev.map((s) => (s.id === selectedService.id ? { ...s, ...data } : s))
          );
          setSelectedService(null);
          setMessageService("Услуга обновлена");
        })
        .catch(() => setMessageService("Ошибка обновления"));
    } else {
      axios
        .post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services`, data, config)
        .then((res) => {
          setServices((prev) => [...prev, res.data]);
          setTitle("");
          setDescription("");
          setCategory("");
          setPrice("");
          setAvailability([]);
          setImages([]);
          setMessageService("Услуга добавлена");
        })
        .catch(() => setMessageService("Ошибка добавления"));
    }
  };

  const loadServiceToEdit = (service) => {
    setSelectedService(service);
    setTitle(service.title);
    setDescription(service.description);
    setCategory(service.category);
    setPrice(service.price);
    setAvailability(service.availability.map((d) => new Date(d)));
    setImages(service.images || []);
    setMessageService("");
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
      {/* Левый блок — без изменений */}

      {/* Правый блок */}
      <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Услуги</h2>
          {selectedService ? (
            <button onClick={() => {
              setSelectedService(null);
              setTitle("");
              setDescription("");
              setCategory("");
              setPrice("");
              setAvailability([]);
              setImages([]);
            }} className="text-sm text-orange-500 underline">
              ← Назад
            </button>
          ) : (
            <button className="bg-orange-500 text-white px-4 py-2 rounded font-semibold" onClick={() => setSelectedService(null)}>
              + Добавить услугу
            </button>
          )}
        </div>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" className="w-full border px-3 py-2 rounded mb-2" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание" className="w-full border px-3 py-2 rounded mb-2" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Категория" className="w-full border px-3 py-2 rounded mb-2" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Цена" className="w-full border px-3 py-2 rounded mb-2" />

        {/* Image upload */}
        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="w-full border px-3 py-2 rounded mb-2" />
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative w-20 h-20">
              <img src={img} alt="preview" className="w-full h-full object-cover rounded" />
              <button onClick={() => removeImage(idx)} className="absolute top-0 right-0 bg-red-600 text-white text-xs rounded px-1">×</button>
            </div>
          ))}
        </div>

        <DayPicker mode="multiple" selected={availability} onSelect={setAvailability} className="border rounded-lg p-4 mb-4" />
        <div className="flex gap-4">
          <button className="w-full bg-orange-500 text-white py-2 rounded font-bold" onClick={handleSaveService}>Сохранить</button>
          {selectedService && (
            <button className="w-full bg-red-600 text-white py-2 rounded font-bold" onClick={() => handleDeleteService(selectedService.id)}>Удалить</button>
          )}
        </div>

        {!selectedService && (
          <div className="mt-4 space-y-2">
            {services.map((s) => (
              <div key={s.id} className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition" onClick={() => loadServiceToEdit(s)}>
                <div className="font-bold text-lg">{s.title}</div>
                <div className="text-sm text-gray-600">{s.category}</div>
                <div className="text-sm text-gray-800">Цена: {s.price} сум</div>
              </div>
            ))}
          </div>
        )}

        {messageService && <p className="text-sm text-center text-gray-600 mt-4">{messageService}</p>}
      </div>
    </div>
  );
};

export default Dashboard;
