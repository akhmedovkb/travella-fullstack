export default function Checkup(){
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">Check-up в Индии</h1>
      <p className="mt-3 text-lg">Пакеты обследований: базовый, кардио, онко, женский/мужской. Партнёрские клиники Дели.</p>
      <Form preset="checkup" />
    </main>
  );
}

function Form({preset}) {
  async function onSubmit(e){
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    await fetch("/api/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    alert("Отправлено"); e.currentTarget.reset();
  }
  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8">
      <input name="name" placeholder="Имя" required className="input"/>
      <input name="phone" placeholder="Телефон" required className="input"/>
      <select name="program" className="input">
        <option>Базовый</option>
        <option>Кардио</option>
        <option>Онко</option>
        <option>Женский</option>
        <option>Мужской</option>
      </select>
      <input name="service" value={preset} hidden readOnly/>
      <button className="btn md:col-span-2">Получить стоимость</button>
    </form>
  );
}
