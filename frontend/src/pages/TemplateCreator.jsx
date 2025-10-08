// frontend/src/pages/TemplateCreator.jsx
import React, { useMemo, useState } from "react";
import { listTemplates, upsertTemplate, removeTemplate, newId } from "../store/templates";

export default function TemplateCreator() {
  const [items, setItems] = useState(listTemplates());
  const [edit, setEdit] = useState(null); // {id,title,days:[{city}]}
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await fetchMeLoose();
      setIsAdmin(isAdminFrom(me));
      setAdminChecked(true);
    })();
  }, []);

  const empty = { id: newId(), title: "", days: [{ city: "" }] };

  const startNew = () => setEdit({ ...empty });
  const editTpl = (tpl) => setEdit(JSON.parse(JSON.stringify(tpl)));
  const cancel = () => setEdit(null);

  const save = () => {
    const clean = { ...edit, days: (edit.days || []).map(d => ({ city: (d.city||"").trim() })).filter(d => d.city) };
    if (!clean.title.trim() || !clean.days.length) return alert("Заполните название и хотя бы один день");
    upsertTemplate(clean);
    setItems(listTemplates());
    setEdit(null);
  };

  const del = (id) => {
    if (!confirm("Удалить шаблон?")) return;
    removeTemplate(id);
    setItems(listTemplates());
    if (edit && String(edit.id) === String(id)) setEdit(null);
  };

    if (adminChecked && !isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="border rounded-lg p-6 bg-white shadow">
          <div className="text-lg font-semibold mb-2">Доступ запрещён</div>
          <div className="text-sm text-gray-600">Конструктор шаблонов доступен только администраторам.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Шаблоны туров</h1>
        <button className="px-3 py-2 rounded bg-orange-500 text-white" onClick={startNew}>+ Новый шаблон</button>
      </div>
      {!edit && (
        <div className="space-y-4">
          {!items.length && <div className="text-gray-500">Пока нет шаблонов</div>}
          {Object.entries(
            items
              .slice()
              .sort((a,b)=>a.title.localeCompare(b.title))
              .reduce((acc, t) => {
                const m = String(t.title||"").match(/^([A-Za-z]{2,4})\s*:/);
                const key = (m?.[1] || "Other").toUpperCase();
                (acc[key] ||= []).push(t);
                return acc;
              }, {})
          )
          .sort(([a],[b])=>a.localeCompare(b))
          .map(([country, list]) => (
            <div key={country} className="space-y-3">
              <div className="text-sm font-semibold text-gray-700">{country}</div>
              {list.map(t => (
                <div key={t.id} className="border rounded p-3 flex items-start justify-between">flex items-start justify-between">
              <div>
                <div className="font-semibold">{t.title}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {t.days?.map((d, i) => <span key={i}>{d.city}{i < t.days.length-1 ? " → " : ""}</span>)}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1 border rounded" onClick={() => editTpl(t)}>Редактировать</button>
                <button className="px-3 py-1 border rounded text-red-600" onClick={() => del(t.id)}>Удалить</button>
              </div>
            </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div className="border rounded p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Название шаблона</label>
            <input className="w-full border rounded px-3 py-2" value={edit.title}
                   onChange={e=>setEdit(p=>({...p, title:e.target.value}))} />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Дни (города по порядку)</div>
            {(edit.days||[]).map((d, idx)=>(
              <div key={idx} className="flex gap-2">
                <input className="flex-1 border rounded px-3 py-2"
                       placeholder={`D${idx+1} — Город`}
                       value={d.city}
                       onChange={e=>{
                         const v = e.target.value;
                         setEdit(p=>{
                           const copy = {...p};
                           copy.days = [...(copy.days||[])];
                           copy.days[idx] = {...copy.days[idx], city: v};
                           return copy;
                         });
                       }} />
                <button className="px-2 border rounded"
                        onClick={()=>setEdit(p=>{
                          const copy = {...p};
                          copy.days = (copy.days||[]).filter((_,i)=>i!==idx);
                          return copy;
                        })}>✕</button>
              </div>
            ))}
            <button className="px-3 py-1 border rounded" onClick={()=>setEdit(p=>({...p, days:[...(p.days||[]), {city:""}]}))}>
              + Добавить день
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button className="px-3 py-2 rounded bg-orange-500 text-white" onClick={save}>Сохранить</button>
            <button className="px-3 py-2 rounded border" onClick={cancel}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
