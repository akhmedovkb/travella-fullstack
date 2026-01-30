//frontend/src/pages/admin/DonasOpex.jsx

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../api";

const CATS = [
  "Rent","Fuel","Gas/Electricity","Staff","Internet","Cleaning","Repairs","Other"
];

export default function DonasOpex() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0,7));
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [f, setF] = useState({ title:"", category:"Rent", amount:"", notes:"" });

  async function load() {
    const r = await apiGet(`/api/admin/donas/opex?month=${month}`);
    setItems(r?.items || []);
    const s = await apiGet(`/api/admin/donas/opex/summary?month=${month}`);
    setTotal(Number(s?.total || 0));
  }
  useEffect(() => { load(); }, [month]);

  async function add() {
    await apiPost("/api/admin/donas/opex", { ...f, month });
    setF({ title:"", category:"Rent", amount:"", notes:"" });
    load();
  }
  async function del(id){ await apiDelete(`/api/admin/donas/opex/${id}`); load(); }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Donas — OPEX</h1>

      <div className="flex gap-3 items-end">
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
               className="border rounded px-3 py-2"/>
        <div className="ml-auto text-sm">Итого за месяц: <b>{total.toLocaleString("ru-RU")}</b></div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <input className="border rounded px-2 py-2" placeholder="Название"
               value={f.title} onChange={e=>setF({...f,title:e.target.value})}/>
        <select className="border rounded px-2 py-2"
                value={f.category} onChange={e=>setF({...f,category:e.target.value})}>
          {CATS.map(c=><option key={c}>{c}</option>)}
        </select>
        <input className="border rounded px-2 py-2" placeholder="Сумма"
               value={f.amount} onChange={e=>setF({...f,amount:e.target.value})}/>
        <input className="border rounded px-2 py-2" placeholder="Заметки"
               value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/>
        <button className="bg-black text-white rounded px-3" onClick={add}>Добавить</button>
      </div>

      <table className="min-w-full text-sm">
        <thead><tr><th>Название</th><th>Категория</th><th className="text-right">Сумма</th><th/></tr></thead>
        <tbody>
          {items.map(x=>(
            <tr key={x.id} className="border-t">
              <td>{x.title}</td>
              <td>{x.category}</td>
              <td className="text-right">{Number(x.amount).toLocaleString("ru-RU")}</td>
              <td className="text-right">
                <button className="text-red-600" onClick={()=>del(x.id)}>Удалить</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
