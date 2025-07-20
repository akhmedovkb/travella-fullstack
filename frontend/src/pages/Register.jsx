import React, { useState } from "react";
import axios from "axios";

const Register = () => {
  const [formData, setFormData] = useState({
    name: "",
    type: "гид",
    location: "",
    photo: "",
    phone: "",
    email: "",
    social: "",
    password: ""
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "photo" && files.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, photo: reader.result });
      };
      reader.readAsDataURL(files[0]);
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/providers/register`, formData);
      alert("Регистрация прошла успешно!");
    } catch (error) {
      console.error("Ошибка регистрации:"
