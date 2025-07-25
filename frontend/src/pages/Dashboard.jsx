import React, { useEffect, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useTranslation } from "react-i18next";
import LanguageSelector from "../components/LanguageSelector"; // ⬅️ Добавлен импорт

const Dashboard = () => {
  const { t } = useTranslation();
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newAddress, setNewAddress] = useState("");
  const [newCertificate, setNewCertificate] = useState(null);
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [messageProfile, setMessageProfile] = useState("");
  const [messageService, setMessageService] = useState("");
  const [images, setImages] = useState([]);
  const handleRemoveImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]);
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
        setNewAddress(res.data.address);
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
    if (newAddress !== profile.address) updated.address = newAddress;
    if (Object.keys(updated).length === 0) {
      setMessageProfile(t("no_changes"));
      return;
    }

    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
        setIsEditing(false);
        setMessageProfile(t("profile_updated"));
      })
      .catch(() => setMessageProfile(t("update_error")));
  };

  const handleChangePassword = () => {
    axios
      .put(`${import.meta.env.VITE_API_BASE_URL}/api/providers/change-password`,
        { password: newPassword },
        config
      )
      .then(() => {
        setNewPassword("");
        setMessageProfile(t("password_changed"));
      })
      .catch(() => setMessageProfile(t("password_error")));
  };

  const handleSaveService = () => {
    if (!title || !description || !category || !price || availability.length === 0) {
      setMessageService(t("fill_all_fields"));
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
          setTitle("");
          setDescription("");
          setCategory("");
          setPrice("");
          setAvailability([]);
          setImages([]);
          setMessageService(t("service_updated"));
        })
        .catch(() => setMessageService(t("update_error")));
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
          setMessageService(t("service_added"));
        })
        .catch(() => setMessageService(t("add_error")));
    }
  };

  const handleDeleteService = (id) => {
    axios
      .delete(`${import.meta.env.VITE_API_BASE_URL}/api/providers/services/${id}`, config)
      .then(() => {
        setServices((prev) => prev.filter((s) => s.id !== id));
        setSelectedService(null);
      })
      .catch(() => setMessageService(t("delete_error")));
  };

  const loadServiceToEdit = (service) => {
    setSelectedService(service);
    setTitle(service.title);
    setDescription(service.description);
    setCategory(service.category);
    setPrice(service.price);
    setAvailability(service.availability.map((d) => new Date(d)));
    setMessageService("");
    setImages(service.images || []);
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const readers = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then((base64Images) => {
      setImages((prev) => [...prev, ...base64Images]);
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">     
      {/* Левый блок */}
<div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md flex flex-col">
  <h2 className="text-2xl font-bold mb-4">{t("provider_profile")}</h2>
  <div className="flex justify-end mb-2">
  <LanguageSelector />
 </div>
  <div className="flex gap-4">
    <div className="flex flex-col items-center w-1/2">
      <div className="relative">
        <img
          src={newPhoto || profile.photo || "https://via.placeholder.com/96x96"}
          className="w-24 h-24 rounded-full object-cover mb-2"
          alt="Фото"
        />
        {isEditing && (
  <div className="flex flex-col items-center">
    <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm">
      {t("choose_files")}
      <input
        type="file"
        accept="image/*"
        onChange={handlePhotoChange}
        className="hidden"
      />
    </label>
    <div className="text-sm text-gray-600 mt-1">
      {newPhoto ? t("file_chosen") : t("no_files_selected")}
    </div>
  </div>
)}

      </div>
      <h3 className="font-semibold text-lg mt-6 mb-2">{t("phone")}</h3>
      {isEditing ? (
        <input
          type="text"
          placeholder={t("phone")}
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          className="border px-3 py-2 mb-2 rounded w-full"
        />
      ) : (
        <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
          {profile.phone || t("not_specified")}
        </div>
      )}

<h3 className="font-semibold text-lg mb-2">{t("address")}</h3>
{isEditing ? (
  <input
    type="text"
    placeholder={t("address")}
    value={newAddress}
    onChange={(e) => setNewAddress(e.target.value)}
    className="border px-3 py-2 mb-2 rounded w-full"
  />
) : (
  <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
    {profile.address || t("not_specified")}
  </div>
)}

{/* Карта (только если адрес есть) */}
{profile.address && !isEditing && (
  <div className="w-full mb-4">
    <iframe
      title="provider-map"
      width="100%"
      height="200"
      frameBorder="0"
      scrolling="no"
      marginHeight="0"
      marginWidth="0"
      className="rounded"
      src={`https://www.google.com/maps?q=${encodeURIComponent(profile.address)}&output=embed`}
    ></iframe>
  </div>
)}

      <button
        onClick={() => {
          localStorage.removeItem("token");
          window.location.href = "/login";
        }}
        className="mt-4 bg-red-600 text-white px-4 py-2 rounded font-semibold w-full"
      >
        {t("logout")}
      </button>
    </div>

    <div className="w-1/2 space-y-3">
      <div>
        <label className="block font-medium">{t("name")}</label>
        <div className="border px-3 py-2 rounded bg-gray-100">{profile.name}</div>
      </div>
      <div>
        <label className="block font-medium">{t("type")}</label>
        <div className="border px-3 py-2 rounded bg-gray-100">{profile.type}</div>
      </div>
      <div>
        <label className="block font-medium">{t("location")}</label>
        {isEditing ? (
          <input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="border px-3 py-2 rounded w-full" />
        ) : (
          <div className="border px-3 py-2 rounded bg-gray-100">{profile.location}</div>
        )}
      </div>
      <div>
        <label className="block font-medium">{t("social")}</label>
        {isEditing ? (
          <input value={newSocial} onChange={(e) => setNewSocial(e.target.value)} className="border px-3 py-2 rounded w-full" />
        ) : (
          <div className="border px-3 py-2 rounded bg-gray-100">{profile.social || t("not_specified")}</div>
        )}
      </div>
     <div>
  <label className="block font-medium">{t("certificate")}</label>
  {isEditing ? (
    <div className="flex flex-col gap-2">
      <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm w-fit">
        {t("choose_files")}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleCertificateChange}
          className="hidden"
        />
      </label>

      {newCertificate ? (
        newCertificate.startsWith("data:image") ? (
          <img
            src={newCertificate}
            alt="Certificate preview"
            className="w-32 h-32 object-cover border rounded"
          />
        ) : (
          <div className="text-sm text-gray-600">📄 {t("file_chosen")}</div>
        )
      ) : (
        <div className="text-sm text-gray-600">{t("no_files_selected")}</div>
      )}
    </div>
  ) : profile.certificate ? (
    <a
      href={profile.certificate}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline"
    >
      {t("view_certificate")}
    </a>
  ) : (
    <div className="text-gray-500">{t("not_specified")}</div>
  )}
</div>

</div>


        ) : profile.certificate ? (
          <a href={profile.certificate} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            {t("view_certificate")}
          </a>
        ) : (
          <div className="text-gray-500">{t("no_files_selected")}</div>
        )}
      </div>
      <button
        onClick={isEditing ? handleSaveProfile : () => setIsEditing(true)}
        className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
      >
        {isEditing ? t("save") : t("edit")}
      </button>

      <div className="mt-4">
        <h3 className="font-semibold text-lg mb-2">{t("change_password")}</h3>
        <input
          type="password"
          placeholder={t("new_password")}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="border px-3 py-2 mb-2 rounded w-full"
        />
        <button onClick={handleChangePassword} className="w-full bg-orange-500 text-white py-2 rounded font-bold">
          {t("change")}
        </button>
      </div>
    </div>
  </div>
  {messageProfile && <p className="text-sm text-center text-gray-600 mt-4">{messageProfile}</p>}
</div>

{/* Правый блок */}
{/* Правый блок */}
<div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
  <div className="mb-6">
    <div className="flex justify-between items-center">
      <h2 className="text-2xl font-bold">{t("services")}</h2>
      {selectedService && (
        <button
          onClick={() => {
            setSelectedService(null);
            setTitle("");
            setDescription("");
            setCategory("");
            setPrice("");
            setAvailability([]);
            setImages([]);
          }}
          className="text-sm text-orange-500 underline"
        >
          {t("back")}
        </button>
      )}
    </div>

    <div className="mt-4 space-y-2">
      {services.map((s) => (
        <div
          key={s.id}
          className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
          onClick={() => loadServiceToEdit(s)}
        >
          <div className="font-bold text-lg">{s.title}</div>
          <div className="text-sm text-gray-600">{s.category}</div>
          <div className="text-sm text-gray-800">
            {t("price")}: {s.price} сум
          </div>
        </div>
      ))}
    </div>
  </div>

  {selectedService ? (
    <>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("description")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t("category")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder={t("price")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <div className="mb-4">
       <label className="block font-medium mb-1">{t("upload_images")}</label>
       <div className="mb-2">
        <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
        {t("choose_files")}
         <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          className="hidden"
         />
        </label>
        <div className="mt-1 text-sm text-gray-600">
        {images.length > 0
        ? t("file_chosen", { count: images.length })
        : t("no_files_selected")}
        </div>
       </div>

        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => (
            <div key={idx} className="relative">
              <img
                src={img}
                alt={`preview-${idx}`}
                className="w-20 h-20 object-cover rounded"
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(idx)}
                className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                title="Удалить"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <DayPicker
        mode="multiple"
        selected={availability}
        onSelect={setAvailability}
        className="border rounded-lg p-4 mb-4"
      />
      <div className="flex gap-4">
        <button
          className="w-full bg-orange-500 text-white py-2 rounded font-bold"
          onClick={handleSaveService}
        >
          {t("save")}
        </button>
        <button
          className="w-full bg-red-600 text-white py-2 rounded font-bold"
          onClick={() => handleDeleteService(selectedService.id)}
        >
          {t("delete")}
        </button>
      </div>
    </>
  ) : (
    <>
      <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded mb-4">
        {t("new_service_tip")}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("title")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("description")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t("category")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder={t("price")}
        className="w-full border px-3 py-2 rounded mb-2"
      />
      <div className="mb-4">
        <label className="block font-medium mb-1">{t("upload_images")}</label>
        <div className="mb-2">
  <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
    {t("choose_files")}
    <input
      type="file"
      accept="image/*"
      multiple
      onChange={handleImageUpload}
      className="hidden"
    />
  </label>
  <div className="mt-1 text-sm text-gray-600">
    {images.length > 0
      ? t("file_chosen", { count: images.length })
      : t("no_files_selected")}
  </div>
</div>

        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => (
            <div key={idx} className="relative">
              <img
                src={img}
                alt={`preview-${idx}`}
                className="w-20 h-20 object-cover rounded"
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(idx)}
                className="absolute top-0 right-0 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                title="Удалить"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <DayPicker
        mode="multiple"
        selected={availability}
        onSelect={setAvailability}
        className="border rounded-lg p-4 mb-4"
      />
      <button
        className="w-full bg-orange-500 text-white py-2 rounded font-bold"
        onClick={handleSaveService}
      >
        {t("save_service")}
      </button>
    </>
  )}

  {messageService && (
    <p className="text-sm text-center text-gray-600 mt-4">{messageService}</p>
  )}
</div>

</div>
 
);
};

export default Dashboard;


