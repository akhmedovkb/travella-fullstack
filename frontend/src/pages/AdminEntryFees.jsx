// frontend/src/pages/AdminEntryFees.jsx
import React, { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

const blank = {
  name_ru:"", name_uz:"", name_en:"", city:"", currency:"UZS",

  wk_res_adult:0, wk_res_child:0, wk_res_senior:0,
  wk_nrs_adult:0, wk_nrs_child:0, wk_nrs_senior:0,

  we_res_adult:0, we_res_child:0, we_res_senior:0,
  we_nrs_adult:0, we_nrs_child:0, we_nrs_senior:0,

  hd_res_adult:0, hd_res_child:0, hd_res_senior:0,
  hd_nrs_adult:0, hd_nrs_child:0, hd_nrs_senior:0,
};

export default function AdminEntryFees() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [editing, setEditing] = useState(null); // объект для формы
  const [loading, setLoading] = useState(false);

  const pages = useMemo(() => Math.max(1, Math.ceil(total/limit)), [total, limit]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const u = new URL("/api/admin/entry-fees", API_BASE);
      u.searchParams.set("q", q);
      u.searchParams.set("page", page);
      u.searchParams.set("limit", limit);
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [q, page]);

  const onEdit = (row) => {
    setEditing(row ? { ...row } : { ...blank });
  };

  const onDelete = async (row) => {
    if (!confirm(`Удалить "${row.name_ru}"?`)) return;
    await fetch(new URL(`/api/admin/entry-fees/${row.id}`, API_BASE), {
      method: "DELETE", credentials: "include"
    });
    fetchList();
  };

  const onSave = async (e) => {
    e.preventDefault();
    const body = { ...editing };
    // нормализуем числа
    Object.keys(body).forEach(k => {
      if (/_(adult|child|senior)$/.test(k)) body[k] = num(body[k]);
    });

    const isNew = !body.id;
    const url = isNew ? "/api/admin/entry-fees" : `/api/admin/entry-fees/${body.id}`;
    const method = isNew ? "POST" : "PUT";

    const r = await fetch(new URL(url, API_BASE), {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!r.ok) { alert("Ошибка сохранения"); return; }
    setEditing(null);
    fetchList();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Entry fees — админ</h1>
        <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={()=>onEdit(null)}>
          + Новый объект
        </button>
      </div>

      {/* поиск */}
      <div className="flex gap-2 items-center mb-3">
        <input
          className="border rounded px-3 py-2 w-72"
          placeholder="Поиск: название/город"
          value={q} onChange={e=>{ setPage(1); setQ(e.target.value); }}
        />
        {loading && <span className="text-sm text-gray-500">Загрузка…</span>}
      </div>

      {/* список */}
      <div className="border rounded overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">ID</th>
              <th className="p-2 text-left">Название (ru)</th>
              <th className="p-2 text-left">Город</th>
              <th className="p-2 text-left">Валюта</th>
              <th className="p-2 text-left">Будни рез/нерез (ВЗР)</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <tr key={row.id} className="border-t">
                <td className="p-2">{row.id}</td>
                <td className="p-2">{row.name_ru}</td>
                <td className="p-2">{row.city}</td>
                <td className="p-2">{row.currency}</td>
                <td className="p-2">{row.wk_res_adult} / {row.wk_nrs_adult}</td>
                <td className="p-2 text-right">
                  <button className="px-2 py-1 border rounded mr-2" onClick={()=>onEdit(row)}>Редакт.</button>
                  <button className="px-2 py-1 border rounded" onClick={()=>onDelete(row)}>Удалить</button>
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr><td className="p-3 text-gray-500" colSpan={6}>Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* пагинация */}
      <div className="mt-3 flex gap-2 items-center">
        <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="px-3 py-1 border rounded disabled:opacity-50">←</button>
        <div className="text-sm">Стр. {page} / {pages}</div>
        <button disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))} className="px-3 py-1 border rounded disabled:opacity-50">→</button>
      </div>

      {/* форма */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={onSave} className="bg-white w-[980px] max-h-[90vh] overflow-auto rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{editing.id ? "Редактирование" : "Новый объект"}</h2>
              <button type="button" onClick={()=>setEditing(null)} className="px-3 py-1 border rounded">✕</button>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <label className="text-sm">Название (ru)
                <input required className="mt-1 border rounded px-2 py-1 w-full" value={editing.name_ru||""} onChange={e=>setEditing(s=>({...s,name_ru:e.target.value}))}/>
              </label>
              <label className="text-sm">Название (uz)
                <input className="mt-1 border rounded px-2 py-1 w-full" value={editing.name_uz||""} onChange={e=>setEditing(s=>({...s,name_uz:e.target.value}))}/>
              </label>
              <label className="text-sm">Название (en)
                <input className="mt-1 border rounded px-2 py-1 w-full" value={editing.name_en||""} onChange={e=>setEditing(s=>({...s,name_en:e.target.value}))}/>
              </label>
              <label className="text-sm">Город
                <input required className="mt-1 border rounded px-2 py-1 w-full" value={editing.city||""} onChange={e=>setEditing(s=>({...s,city:e.target.value}))}/>
              </label>

              <label className="text-sm">Валюта
                <select className="mt-1 border rounded px-2 py-1 w-full" value={editing.currency||"UZS"} onChange={e=>setEditing(s=>({...s,currency:e.target.value}))}>
                  <option>UZS</option><option>USD</option><option>EUR</option>
                </select>
              </label>
            </div>

            {/* тарифные блоки */}
            <TariffBlock title="Будни" prefix="wk" editing={editing} setEditing={setEditing}/>
            <TariffBlock title="Выходные" prefix="we" editing={editing} setEditing={setEditing}/>
            <TariffBlock title="Праздничные" prefix="hd" editing={editing} setEditing={setEditing}/>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-4 py-2 border rounded" onClick={()=>setEditing(null)}>Отмена</button>
              <button type="submit" className="px-4 py-2 rounded bg-gray-800 text-white">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function TariffBlock({ title, prefix, editing, setEditing }) {
  const set = (k,v)=>setEditing(s=>({...s,[k]:v}));

  return (
    <div className="border rounded p-3">
      <div className="font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-4">
        {/* Резиденты */}
        <div>
          <div className="text-sm font-medium mb-1">Резиденты</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Num label="ВЗР" v={editing[`${prefix}_res_adult`]}  onChange={v=>set(`${prefix}_res_adult`,v)} />
            <Num label="РЕБ" v={editing[`${prefix}_res_child`]}  onChange={v=>set(`${prefix}_res_child`,v)} />
            <Num label="ПЕНС" v={editing[`${prefix}_res_senior`]} onChange={v=>set(`${prefix}_res_senior`,v)} />
          </div>
        </div>
        {/* Нерезиденты */}
        <div>
          <div className="text-sm font-medium mb-1">Нерезиденты</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Num label="ВЗР" v={editing[`${prefix}_nrs_adult`]}  onChange={v=>set(`${prefix}_nrs_adult`,v)} />
            <Num label="РЕБ" v={editing[`${prefix}_nrs_child`]}  onChange={v=>set(`${prefix}_nrs_child`,v)} />
            <Num label="ПЕНС" v={editing[`${prefix}_nrs_senior`]} onChange={v=>set(`${prefix}_nrs_senior`,v)} />
          </div>
        </div>
        {/* Подсказка */}
        <div className="text-xs text-gray-500">
          Указывайте цены в выбранной валюте объекта. Все поля числовые, пустые = 0.
        </div>
      </div>
    </div>
  );
}

function Num({ label, v, onChange }) {
  return (
    <label className="text-xs">
      {label}
      <input type="number" min={0} step="1"
        className="mt-1 w-full border rounded px-2 py-1"
        value={v ?? 0}
        onChange={(e)=>onChange(Number(e.target.value)||0)}
      />
    </label>
  );
}
