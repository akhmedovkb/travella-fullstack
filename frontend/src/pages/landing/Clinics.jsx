//frontend/src/pages/landing/Clinics.jsx

export default function Clinics(){
  // позже подставим реальные клиники из БД/JSON
  const items = [
    {name:"Клиника №1 (Дели)", spec:"Check-up / кардио"},
    {name:"Клиника №2 (Дели)", spec:"Онко"},
    {name:"Клиника №3 (Дели)", spec:"Ортопедия"},
    {name:"Клиника №4 (Дели)", spec:"IVF"},
  ];
  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">Клиники-партнёры (Дели)</h1>
      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {items.map((it,i)=>(
          <div key={i} className="card">
            <div className="text-xl font-semibold">{it.name}</div>
            <div className="text-sm mt-2 opacity-80">{it.spec}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
