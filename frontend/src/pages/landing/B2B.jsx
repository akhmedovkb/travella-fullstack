export default function B2B(){
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">Travella B2B для турагентов</h1>
      <ul className="list-disc pl-6 mt-4 space-y-2">
        <li>Агентские тарифы на Индию (авиабилеты + отели)</li>
        <li>Комиссия по клиникам (check-up / лечение / аюрведа)</li>
        <li>Доступ к отказным турам и спецпредложениям</li>
      </ul>
      <form onSubmit={async e=>{
        e.preventDefault();
        const fd=new FormData(e.currentTarget);
        const payload=Object.fromEntries(fd.entries());
        await fetch("/api/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        alert("Отправлено"); e.currentTarget.reset();
      }} className="grid md:grid-cols-2 gap-4 bg-white p-6 rounded-2xl mt-8">
        <input name="name" placeholder="Имя" required className="input"/>
        <input name="phone" placeholder="Телефон" required className="input"/>
        <input name="company" placeholder="Агентство" className="input"/>
        <input name="service" value="b2b" hidden readOnly/>
        <button className="btn md:col-span-2">Подключиться к B2B</button>
      </form>
    </main>
  );
}
