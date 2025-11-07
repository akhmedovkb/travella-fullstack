import { Link } from "react-router-dom";

export default function LandingHome() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <section className="rounded-3xl bg-[#FFEAD2] p-8 md:p-12">
        <h1 className="text-3xl md:text-5xl font-bold">Путешествия и лечение в Индии под ключ</h1>
        <p className="mt-3 text-lg">Туры, Аюрведа, Check-up, клиники Дели. Поддержка 24/7.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#lead" className="px-5 py-3 bg-[#FF5722] text-white rounded-xl">Получить подбор</a>
          <a href="https://wa.me/<YOUR_NUMBER>?text=Salom,%20Travella" className="px-5 py-3 border rounded-xl">WhatsApp</a>
        </div>
      </section>

      <section className="grid md:grid-cols-4 gap-4 mt-10">
        <Link to="/tours" className="card">Туры</Link>
        <Link to="/ayurveda" className="card">Аюрведа</Link>
        <Link to="/checkup" className="card">Check-up</Link>
        <Link to="/treatment" className="card">Лечение</Link>
      </section>

      <section id="lead" className="mt-12">
        <LeadForm />
      </section>
    </main>
  );
}

function LeadForm() {
  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const r = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    alert(r.ok ? "Заявка отправлена" : "Ошибка, попробуйте позже");
  }
  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl">
      <input name="name" placeholder="Имя" required className="input"/>
      <input name="phone" placeholder="Телефон" required className="input"/>
      <select name="service" className="input">
        <option value="tour">Подбор тура</option>
        <option value="checkup">Check-up</option>
        <option value="ayurveda">Аюрведа</option>
        <option value="treatment">Лечение</option>
      </select>
      <textarea name="comment" placeholder="Комментарий" className="input md:col-span-2"/>
      <button className="btn md:col-span-2">Получить предложение</button>
    </form>
  );
}
