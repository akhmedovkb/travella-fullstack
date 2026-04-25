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
  removeTemplateServer,
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

const TB_PROGRAM_LANGS = ["ru", "en", "uz"];
const emptyProgramI18n = () => ({ ru: "", en: "", uz: "" });
const normalizeProgramI18n = (value = {}) => ({
  ru: String(value?.ru || ""),
  en: String(value?.en || ""),
  uz: String(value?.uz || ""),
});

const buildAutoProgramI18n = ({ dayNumber, totalDays, city, prevCity, nextCity }) => {
  const safeCity = String(city || "").trim() || "город по маршруту";
  const safeCityEn = String(city || "").trim() || "the route city";
  const safeCityUz = String(city || "").trim() || "yo'nalish shahri";
  const dayLabel = `D${dayNumber}`;
  const isFirst = dayNumber === 1;
  const isLast = dayNumber === totalDays;
  const hasTransferIn = prevCity && String(prevCity).trim() && String(prevCity).trim() !== safeCity;
  const hasTransferOut = nextCity && String(nextCity).trim() && String(nextCity).trim() !== safeCity;

  return {
    ru: [
      `${dayLabel}. ${safeCity}.`,
      isFirst
        ? "Прибытие группы, встреча с гидом/представителем и трансфер по программе."
        : hasTransferIn
        ? `Переезд из ${prevCity} в ${safeCity}, встреча и начало программы дня.`
        : `Продолжение программы в ${safeCity}.`,
      "Обзорная программа по ключевым локациям города с учетом выбранных услуг, входных билетов и питания.",
      hasTransferOut
        ? `Во второй половине дня подготовка к переезду в ${nextCity}.`
        : isLast
        ? "Завершение программы, свободное время и подготовка к выезду."
        : "Свободное время для прогулки, фото и дополнительных активностей.",
    ].filter(Boolean).join("\n"),
    en: [
      `${dayLabel}. ${safeCityEn}.`,
      isFirst
        ? "Group arrival, meet-and-greet with the guide/representative and transfer according to the program."
        : hasTransferIn
        ? `Transfer from ${prevCity} to ${safeCityEn}, meeting and start of the day program.`
        : `Continuation of the program in ${safeCityEn}.`,
      "Sightseeing program around the key city locations, adjusted to the selected services, entrance tickets and meals.",
      hasTransferOut
        ? `In the second half of the day, preparation for the transfer to ${nextCity}.`
        : isLast
        ? "End of the program, free time and preparation for departure."
        : "Free time for walking, photos and optional activities.",
    ].filter(Boolean).join("\n"),
    uz: [
      `${dayLabel}. ${safeCityUz}.`,
      isFirst
        ? "Guruhning yetib kelishi, gid/vakil bilan kutib olish va dastur bo'yicha transfer."
        : hasTransferIn
        ? `${prevCity} shahridan ${safeCityUz} shahriga yo'l olish, kutib olish va kun dasturini boshlash.`
        : `${safeCityUz} shahrida dastur davom etadi.`,
      "Tanlangan xizmatlar, kirish chiptalari va ovqatlanishni hisobga olgan holda shaharning asosiy joylari bo'ylab ekskursiya dasturi.",
      hasTransferOut
        ? `Kunning ikkinchi yarmida ${nextCity} shahriga yo'l olishga tayyorgarlik.`
        : isLast
        ? "Dastur yakuni, bo'sh vaqt va jo'nashga tayyorgarlik."
        : "Sayr, suratga tushish va qo'shimcha faoliyatlar uchun bo'sh vaqt.",
    ].filter(Boolean).join("\n"),
  };
};

export default function TemplateCreator() {
  const { t } = useTranslation();
  const [items, setItems] = useState(listTemplates());
  const [edit, setEdit] = useState(null); // {id,title,days:[{city,program_i18n}],program_i18n}
  const [isAdmin] = useState(isAdminFromJwt());

  const empty = {
    id: newId(),
    title: "",
    days: [{ city: "", program_i18n: emptyProgramI18n(), _programTab: "ru" }],
    program_i18n: emptyProgramI18n(),
  };
  const startNew = () => setEdit({ ...empty });
  const editTpl = (tpl) => {
    const fallbackProgram = normalizeProgramI18n(tpl.program_i18n || (tpl.program ? { ru: String(tpl.program) } : {}));
    const days = Array.isArray(tpl.days)
      ? tpl.days.map((d) => ({
          city: String(d?.city || ""),
          program_i18n: normalizeProgramI18n(d?.program_i18n || fallbackProgram),
          _programTab: "ru",
        }))
      : [];
    setEdit({ ...tpl, days, program_i18n: fallbackProgram });
  };
  const cancel = () => setEdit(null);
      // ⬇️ подтягиваем серверные шаблоны на маунте (и кладём их в localStorage)
    useEffect(() => {
      (async () => {
        await syncTemplates();
        setItems(listTemplates());
      })();
    }, []);

  const save = async () => {
    const clean = {
     ...edit,
      program_i18n: {
       ru: String(edit.program_i18n?.ru || "").trim(),
       en: String(edit.program_i18n?.en || "").trim(),
       uz: String(edit.program_i18n?.uz || "").trim(),
     },
     days: (edit.days || [])
       .map(d => ({
         city: (d.city || "").trim(),
         program_i18n: normalizeProgramI18n(d.program_i18n || {}),
       }))
       .filter(d => d.city),
   };
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
   try { await removeTemplateServer(id); } catch {}
   await syncTemplates();
   setItems(listTemplates());
    if (edit && String(edit.id) === String(id)) setEdit(null);
  };

  const generateDayProgram = (idx) => {
    setEdit((p) => {
      const days = [...(p?.days || [])];
      if (!days[idx]) return p;
      const current = days[idx] || {};
      days[idx] = {
        ...current,
        program_i18n: buildAutoProgramI18n({
          dayNumber: idx + 1,
          totalDays: days.length,
          city: current.city,
          prevCity: idx > 0 ? days[idx - 1]?.city : "",
          nextCity: idx < days.length - 1 ? days[idx + 1]?.city : "",
        }),
        _programTab: current._programTab || "ru",
      };
      return { ...p, days };
    });
  };

  const generateAllDayPrograms = () => {
    setEdit((p) => {
      const src = Array.isArray(p?.days) ? p.days : [];
      const days = src.map((day, idx) => ({
        ...day,
        program_i18n: buildAutoProgramI18n({
          dayNumber: idx + 1,
          totalDays: src.length,
          city: day?.city,
          prevCity: idx > 0 ? src[idx - 1]?.city : "",
          nextCity: idx < src.length - 1 ? src[idx + 1]?.city : "",
        }),
        _programTab: day?._programTab || "ru",
      }));
      return { ...p, days };
    });
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
          {Object.entries(
            (Array.isArray(items) ? items : [])
              .slice()
              /* стабильная сортировка без деструктуризации аргументов */
              .sort((x, y) =>
                String((x && x.title) || "").localeCompare(String((y && y.title) || ""))
              )
              .reduce((acc, it) => {
                const title = String((it && it.title) || "");
                const m = title.match(/^([A-Za-z]{2,4})\s*:/);
                const key = (m && m[1] ? m[1] : "Other").toUpperCase();
                if (!acc[key]) acc[key] = [];
                acc[key].push({
                  ...it,
                  // страховка: days — всегда массив объектов { city }
                  days: Array.isArray(it && it.days)
                    ? it.days
                        .map((d) => ({
                          city: String((d && d.city) || "").trim(),
                          program_i18n: normalizeProgramI18n(d && d.program_i18n),
                        }))
                        .filter((d) => d.city)
                    : [],
                });
                return acc;
              }, {})
          )
          /* сортируем пары [key, list] — тоже без деструктуризации */
          .sort((pa, pb) => {
            const ka = String((pa && pa[0]) || "");
            const kb = String((pb && pb[0]) || "");
            return ka.localeCompare(kb);
          })
          .map((pair) => {
            const country = pair && pair[0];
            const list = (pair && pair[1]) || [];
            return (
            <div key={country} className="space-y-3">
              <div className="text-sm font-semibold text-gray-700">{country}</div>
              {list.map((tpl) => (
                <div key={tpl.id} className="border rounded p-3 flex items-start justify-between">
              <div>
                <div className="font-semibold">{tpl.title}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {(Array.isArray(tpl.days) ? tpl.days : []).map((d, i) => (
                    <span key={i}>
                      {d.city}
                      {i < tpl.days.length - 1 ? " → " : ""}
                    </span>
                  ))}
                </div>
              </div>
              {isAdmin ? (
                <div className="flex gap-2">
                  <button className="px-3 py-1 border rounded" onClick={() => editTpl(tpl)}>{t('tpl.btn_edit')}</button>
                  <button className="px-3 py-1 border rounded text-red-600" onClick={() => del(tpl.id)}>{t('tpl.btn_delete')}</button>
                </div>
              ) : (
                <div className="text-xs text-gray-400 self-center">{t('tpl.view_only')}</div>
              )}
            </div>
              ))}
            </div>
            );
          })}
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
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{t('tpl.days_title')}</div>
              <button
                type="button"
                className="px-3 py-1 border rounded text-xs bg-white hover:bg-orange-50"
                onClick={generateAllDayPrograms}
              >
                {t('tpl.generate_all_program', { defaultValue: 'Сгенерировать программу для всех дней' })}
              </button>
            </div>
            {(edit.days||[]).map((d, idx)=>(
              <div key={idx} className="border rounded p-3 space-y-2 bg-gray-50">
                <div className="flex gap-2">
                  <input className="flex-1 border rounded px-3 py-2 bg-white"
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
                  <button className="px-2 border rounded bg-white"
                          onClick={()=>setEdit(p=>{
                            const copy = {...p};
                            copy.days = (copy.days||[]).filter((_,i)=>i!==idx);
                            return copy;
                          })}>✕</button>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-gray-600">
                      {t('tpl.day_program', { defaultValue: 'Программа дня' })}
                    </label>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => generateDayProgram(idx)}
                        className="px-2 py-1 border rounded text-xs bg-white hover:bg-orange-50"
                      >
                        {t('tpl.generate_day_program', { defaultValue: 'Сгенерировать день' })}
                      </button>
                      {TB_PROGRAM_LANGS.map(code => (
                        <button key={code}
                          type="button"
                          onClick={() => setEdit(p => {
                            const copy = { ...p, days: [...(p.days || [])] };
                            copy.days[idx] = { ...(copy.days[idx] || {}), _programTab: code };
                            return copy;
                          })}
                          className={`px-2 py-1 border rounded text-xs ${ (d._programTab || "ru")===code ? "bg-orange-50 border-orange-300" : "bg-white"}`}>
                          {code.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const activeLang = TB_PROGRAM_LANGS.includes(d._programTab) ? d._programTab : "ru";
                    return (
                      <textarea
                        className="w-full border rounded px-3 py-2 min-h-[110px] bg-white text-sm"
                        placeholder={t('tpl.day_program_ph', { defaultValue: 'Описание программы этого дня...' })}
                        value={d.program_i18n?.[activeLang] || ""}
                        onChange={e=>{
                          const value = e.target.value;
                          setEdit(p=>{
                            const copy = {...p};
                            copy.days = [...(copy.days||[])];
                            copy.days[idx] = {
                              ...(copy.days[idx] || {}),
                              program_i18n: {
                                ...emptyProgramI18n(),
                                ...(copy.days[idx]?.program_i18n || {}),
                                [activeLang]: value,
                              },
                              _programTab: activeLang,
                            };
                            return copy;
                          });
                        }}
                      />
                    );
                  })()}
                </div>
              </div>
            ))}
            <button className="px-3 py-1 border rounded" onClick={()=>setEdit(p=>({...p, days:[...(p.days||[]), {city:"", program_i18n: emptyProgramI18n(), _programTab:"ru"}]}))}>
              {t('tpl.btn_add_day')}
            </button>
          </div>
             {/* Программа тура (RU/EN/UZ) */}
           <div>
             <label className="block text-sm font-medium mb-1">
               {t('tpl.program') || "Программа тура"}
             </label>
            <div className="flex gap-2 mb-2">
              {["ru","en","uz"].map(code => (
                <button key={code}
                  type="button"
                  onClick={() => setEdit(p => ({ ...p, _progTab: code }))}
                  className={`px-2 py-1 border rounded text-xs ${ (edit._progTab || "ru")===code ? "bg-orange-50" : ""}`}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            {(() => {
              const lang = edit._progTab || "ru";
              return (
                <textarea
                  className="w-full border rounded px-3 py-2 min-h-[140px]"
                  placeholder={t('tpl.program_ph')}
                  value={edit.program_i18n?.[lang] || ""}
                  onChange={e => setEdit(p => ({ ...p, program_i18n: { ...(p.program_i18n||{}), [lang]: e.target.value } }))}
                />
              );
            })()}
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
