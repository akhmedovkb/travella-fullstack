// frontend/src/pages/TemplateCreator.jsx

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  listTemplates,
  upsertTemplateLocal,
  upsertTemplateServer,
  removeTemplateLocal,
  newId,
  syncTemplates,
} from "../store/templates";

// Синхронный детект админа по JWT (без сетевых вызовов)
const isAdminFromJwt = () => {
  try {
    const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
    if (!tok) return false;
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const base64 = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    const claims = JSON.parse(json);
    const roles = []
      .concat(claims.role || [], claims.roles || [])
      .flatMap(r => String(r).split(","))
      .map(s => s.trim().toLowerCase());
    const perms = []
      .concat(claims.permissions || claims.perms || [])
      .map(x => String(x).toLowerCase());
    return (
      claims.is_admin === true ||
      claims.moderator === true ||
      roles.some(r => ["admin","moderator","super","root"].includes(r)) ||
      perms.some(x => ["moderation","admin:moderation"].includes(x))
    );
  } catch {
    return false;
  }
};

export default function TemplateCreator() {
  const { t } = useTranslation();
  const [items, setItems] = useState(listTemplates());
  const [edit, setEdit] = useState(null); // {id,title,days:[{city}]}
  const [isAdmin] = useState(isAdminFromJwt());

  const empty = { id: newId(), title: "", days: [{ city: "" }] };

  const startNew = () => setEdit({ ...empty });
  const editTpl = (tpl) => setEdit(JSON.parse(JSON.stringify(tpl)));
  const cancel = () => setEdit(null);
      // ⬇️ подтягиваем серверные шаблоны на маунте (и кладём их в localStorage)
    useEffect(() => {
      (async () => {
        await syncTemplates();
        setItems(listTemplates());
      })();
    }, []);

  const save = async () => {
    const clean = { ...edit, days: (edit.days || []).map(d => ({ city: (d.city||"").trim() })).filter(d => d.city) };
    if (!clean.title.trim() || !clean.days.length) return alert("Заполните название и хотя бы один день");
    // 1) локально
    upsertTemplateLocal(clean);
    // 2) сервер (best-effort)
    try { await upsertTemplateServer(clean); } catch {}
    // 3) пересинкать и обновить список
    await syncTemplates();
    setItems(listTemplates());
    setEdit(null);
  };

  const del = async (id) => {
    if (!confirm("Удалить шаблон?")) return;
   removeTemplateLocal(id);
   await syncTemplates();
   setItems(listTemplates());
    if (edit && String(edit.id) === String(id)) setEdit(null);
  };

// Для не-админов: страница открыта в режиме просмотра (без CRUD-кнопок)
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t('tpl.title')}</h1>
                {isAdmin && (
          <button className="px-3 py-2 rounded bg-orange-500 text-white" onClick={startNew}>
            {t('tpl.btn_new')}
          </button>
        )}
      </div>
            {!isAdmin && (
        <div className="mb-3 text-sm text-gray-600">
          {t('tpl.readonly_hint')}
        </div>
      )}
      {!edit && (
        <div className="space-y-4">
          {!items.length && <div className="text-gray-500">{t('tpl.empty')}</div>}
          {Object.entries((Array.isArray(items) ? items : [])
            .slice()
            .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || "")))
            .reduce((acc, t) => {
              const m   = String(t?.title || "").match(/^([A-Za-z]{2,4})\s*:/);
              const key = (m && m[1] ? m[1] : "Other").toUpperCase();
              if (!acc[key]) acc[key] = [];            // без ||= чтобы не зависеть от поддержки
              acc[key].push({
                ...t,
                // страховка: days всегда массив объектов {city}
                days: Array.isArray(t?.days)
                  ? t.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city)
                  : [],
              });
              return acc;
            }, {}))
          .sort(([a],[b])=>a.localeCompare(b))
          .map(([country, list]) => (
            <div key={country} className="space-y-3">
              <div className="text-sm font-semibold text-gray-700">{country}</div>
              {list.map(t => (
                <div key={t.id} className="border rounded p-3 flex items-start justify-between">
              <div>
                <div className="font-semibold">{t.title}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {(Array.isArray(t.days) ? t.days : []).map((d, i) => (
                          <span key={i}>{d.city}{i < t.days.length - 1 ? " → " : ""}</span>
                    ))}
                </div>
              </div>
              {isAdmin ? (
                <div className="flex gap-2">
                  <button className="px-3 py-1 border rounded" onClick={() => editTpl(t)}>{t('tpl.btn_edit')}</button>
                  <button className="px-3 py-1 border rounded text-red-600" onClick={() => del(t.id)}>{t('tpl.btn_delete')}</button>
                </div>
              ) : (
                <div className="text-xs text-gray-400 self-center">{t('tpl.view_only')}</div>
              )}
            </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {isAdmin && edit && (
        <div className="border rounded p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t('tpl.name')}</label>
            <input className="w-full border rounded px-3 py-2" value={edit.title}
                   onChange={e=>setEdit(p=>({...p, title:e.target.value}))} />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t('tpl.days_title')}</div>
            {(edit.days||[]).map((d, idx)=>(
              <div key={idx} className="flex gap-2">
                <input className="flex-1 border rounded px-3 py-2"
                       placeholder={`D${idx+1} — ${t('tpl.city_ph')}`}
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
              {t('tpl.btn_add_day')}
            </button>
          </div>
          <div className="flex gap-2 pt-2">
            <button className="px-3 py-2 rounded bg-orange-500 text-white" onClick={save}>{t('tpl.btn_save')}</button>
            <button className="px-3 py-2 rounded border" onClick={cancel}>{t('tpl.btn_cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
