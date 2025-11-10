// frontend/src/pages/landing/IndiaLayout.jsx
import { Outlet } from "react-router-dom";
import IndiaNav from "../../components/IndiaNav";
import FloatingLeadButton from "../../components/LeadModal";

export default function IndiaLayout() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Верхняя навигация по India-разделам */}
      <IndiaNav />

      {/* Контент конкретной страницы */}
      <Outlet />

      {/* Плавающая кнопка для заявки (уведомление в Telegram) */}
      <FloatingLeadButton />
    </div>
  );
}
