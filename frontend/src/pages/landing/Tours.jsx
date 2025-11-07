//frontend/src/pages/landing/Tours.jsx

import { useState } from "react";

export default function Tours() {
  const [loading, setLoading] = useState(false);

  async function onLead(e) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const r = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    alert(r.ok ? "Отправлено" : "Ошибка");
    if (r.ok) e.currentTarget.reset();
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">Туры в Индию</h1>
      <p className="mt-3 text-lg">Гоа, Керала, Дели, Мумбаи, Золотой треугольник. Пакеты и авторские программы.</p>

      {/* Примеры (заглушки) */}
      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {[
          {city:"Гоа", price:"от $350", desc:"7 ночей, перелёт отдельно"},
          {city:"Керала (Аюрведа)", price:"от $690", desc:"10 дней wellness"},
          {city:"Дели (Check-up)", price:"от $299", desc:"программы обследования"},
        ].map((x,i)=>(
          <div key={i} className="card">
            <div className="text-xl font-semibold">{x.city}</div>
            <div className="text-[#FF5722] font-bold mt-1">{x.price}</div>
            <div className="text-sm mt-2 opacity-80">{x.desc}</div>
          </div>
        ))}
      </div>

      <form onSubmit={onLead} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-10">
        <input name="name" placeholder="Имя" required className="input" />
        <input name="phone" placeholder="Телефон" required className="input" />
        <input name="destination" placeholder="Город / даты" className="input" />
        <input name="pax" placeholder="Кол-во человек" className="input" />
        <input name="service" value="tour" hidden readOnly />
        <textarea name="comment" placeholder="Комментарий" className="input md:col-span-2" />
        <button disabled={loading} className="btn md:col-span-2">{loading ? "Отправка…" : "Запросить предложение"}</button>
      </form>
    </main>
  );
}
