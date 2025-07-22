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
  const [bookedDates, setBookedDates] = useState([]);

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
      .then((res) => {
        setServices(res.data);
        const allDates = res.data.flatMap((s) => s.availability);
        setBookedDates(allDates);
      })
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
      setMessageProfile("Нет изменений для сохранения");
      return;
    }

    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
        setIsEditing(false);
        setMessageProfile("Профиль обновлён");
      })
      .catch(() => setMessageProfile("Ошибка обновления"));
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
        setMessageProfile("Пароль обновлён");
      })
      .catch(() => setMessageProfile("Ошибка смены пароля"));
  };

  const handleSaveService = () => {
    if (!title || !description || !category || !price || availability.length === 0) {
      setMessageService("Заполните все поля и выберите даты");
      return;
    }

    const selectedDateStrings = availability.map((date) => date.toISOString().split("T")[0]);
    const conflict = selectedDateStrings.some((d) => bookedDates.includes(d));
    if (conflict) {
      setMessageService("Вы выбрали дату, уже занятую другой услугой");
      return;
    }

    const data = { title, description, category, price, availability: selectedDateStrings };

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
          setBookedDates((prev) => [...prev, ...selectedDateStrings]);
          setTitle("");
          setDescription("");
          setCategory("");
          setPrice("");
          setAvailability([]);
          setMessageService("Услуга добавлена");
        })
        .catch(() => setMessageService("Ошибка добавления"));
    }
  };

  const handleDeleteService = (id) => {
    axios
      .delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config)
      .then(() => {
        setServices((prev) => prev.filter((s) => s.id !== id));
        setSelectedService(null);
      })
      .catch(() => setMessageService("Ошибка удаления"));
  };

  const loadServiceToEdit = (service) => {
    setSelectedService(service);
    setTitle(service.title);
    setDescription(service.description);
    setCategory(service.category);
    setPrice(service.price);
    setAvailability(service.availability.map((d) => new Date(d)));
    setMessageService("");
  };

  const disabledDays = [
    { before: new Date() },
    ...bookedDates.map((d) => new Date(d)),
  ];

  const modifiers = {
    booked: bookedDates.map((d) => new Date(d)),
  };

  const modifiersStyles = {
    booked: {
      backgroundColor: "#ccc",
      color: "#555",
      cursor: "not-allowed",
    },
  };

  return (
    // ... остальная разметка не меняется, DayPicker обновляется так:
    <DayPicker
      mode="multiple"
      selected={availability}
      onSelect={setAvailability}
      disabled={disabledDays}
      modifiers={modifiers}
      modifiersStyles={modifiersStyles}
      className="border rounded-lg p-4 mb-4"
    />
  );
};

export default Dashboard;
