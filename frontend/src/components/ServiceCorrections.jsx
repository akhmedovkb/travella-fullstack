import { useEffect, useRef, useState } from "react";

export function CorrectionRequestDialog({ target, initial, options, busy, onClose, onSubmit }) {
  const closeRef = useRef(null);
  useEffect(()=>{const previous=document.activeElement;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";closeRef.current?.focus();return ()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  const [codes, setCodes] = useState(initial.reasonCodes || [initial.reasonCode]);
  const [texts, setTexts] = useState(Object.fromEntries(options.map(o=>[o.code,o.text])));
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const selected = options.filter(o=>codes.includes(o.code));
  const message = ["Пожалуйста, исправьте карточку и отправьте её на модерацию повторно.", ...selected.map(o=>texts[o.code].trim()),comment.trim()].filter(Boolean).join("\n\n");
  const canRequest = target.canRequest !== false;
  const invalid = !selected.length || selected.some(o=>texts[o.code].trim().length<5) || message.length>4000;
  return <div role="dialog" aria-modal="true" aria-label="Запрос исправлений" onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();if(!busy)onClose();}}} className="fixed inset-0 z-[6200] flex items-center justify-center bg-black/60 p-3 sm:p-5">
    <div className="flex max-h-[94dvh] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4"><div><h2 className="text-lg font-bold">Запрос исправлений</h2><p className="break-words text-sm text-slate-500">#{target.id} · {target.title || target.category}</p></div><button type="button" disabled={busy} ref={closeRef} aria-label="Закрыть запрос исправлений" onClick={onClose} className="h-8 w-8 shrink-0 rounded-lg bg-slate-100">×</button></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <fieldset><legend className="mb-2 font-semibold">Что нужно исправить? Можно выбрать несколько причин.</legend><div className="grid gap-2 sm:grid-cols-2">{options.map(o=><label key={o.code} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${codes.includes(o.code)?"border-rose-300 bg-rose-50":"border-slate-200"}`}><input type="checkbox" disabled={busy} checked={codes.includes(o.code)} onChange={()=>setCodes(prev=>prev.includes(o.code)?prev.filter(c=>c!==o.code):[...prev,o.code])}/><span className="break-words">{o.label}</span></label>)}</div></fieldset>
        {selected.map(o=><label key={o.code} className="block text-sm font-semibold">{o.label}<textarea aria-label={`Замечание: ${o.label}`} disabled={busy} value={texts[o.code]} onChange={e=>setTexts(prev=>({...prev,[o.code]:e.target.value}))} rows={3} maxLength={3000} className="mt-1 w-full rounded-xl border p-3 font-normal"/></label>)}
        <label className="block text-sm font-semibold">Дополнительный комментарий<textarea aria-label="Дополнительный комментарий" disabled={busy} value={comment} onChange={e=>setComment(e.target.value)} rows={2} maxLength={3000} className="mt-1 w-full rounded-xl border p-3 font-normal"/></label>
        <details className="rounded-xl border bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Сообщение поставщику · {message.length}/4000</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message}</p></details>
        {!canRequest && <p className="text-sm text-amber-800">Запрос отправляется только для услуги на модерации. Эта услуга сейчас в другом статусе.</p>}
        {invalid && <p role="status" className="text-sm text-rose-700">Выберите причину, заполните каждое замечание (от 5 символов). Всё сообщение — до 4000 символов.</p>}
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Услуга будет возвращена поставщику. Он увидит замечания и получит уведомление. В запрос попадут сохранённые данные услуги; несохранённый черновик редактора не отправляется.</p>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-4"><button disabled={busy} type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2">Отмена</button><button disabled={busy || invalid || !canRequest} type="button" onClick={async()=>{setError("");try{await onSubmit(target.id,message,codes[0],codes);}catch(e){setError(e.message);}}} className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy?"Отправляем…":"Вернуть и уведомить"}</button></div>
    </div>
  </div>;
}

const GROUPS={NO_PROOF:"proof",BAD_PROOF:"proof",NO_DATES:"dates",BAD_PRICE:"price",HOTEL_DETAILS:"hotel",NO_PHOTO:"photos",MISSING_DETAILS:"details",WRONG_CATEGORY:"details",DUPLICATE:"details",OTHER:"details"};
export function CorrectionReview({ correction, options, disabled, onSave, onNavigate }) {
  const [checked,setChecked]=useState(correction.checkedCodes || []);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  return <section aria-label="Повторная проверка исправлений" className="min-w-0 rounded-xl border border-violet-200 bg-violet-50 p-3">
    <h2 className="font-bold">Повторная проверка исправлений</h2><p className="mt-1 text-xs text-slate-600">Запрос от {new Date(correction.requestedAt).toLocaleString("ru-RU")}. Сравнение сохранённых данных с моментом возврата. Изменение поля само по себе не означает, что замечание исправлено.</p>
    <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Замечания поставщику</summary><p className="mt-2 whitespace-pre-wrap break-words">{correction.reason}</p></details>
    {!correction.hasBaseline && <p className="mt-2 text-sm text-amber-800">Для старого запроса исходные данные не сохранялись. Сравнение недоступно — проверьте замечания вручную.</p>}
    {correction.reviewStale && <p className="mt-2 text-sm text-amber-800">После предыдущей проверки данные изменились. Проверьте замечания повторно.</p>}
    <div className="mt-3 space-y-2">{correction.reasonCodes.map(code=>{const changes=correction.changes.filter(c=>GROUPS[code]==="details" || c.group===GROUPS[code]);return <div key={code} className={`min-w-0 rounded-xl border p-3 ${checked.includes(code)?"border-emerald-200 bg-emerald-50":"border-violet-200 bg-white"}`}><label className="flex gap-2 text-sm font-semibold"><input type="checkbox" disabled={disabled || busy} checked={checked.includes(code)} onChange={()=>{setNotice("");setChecked(prev=>prev.includes(code)?prev.filter(c=>c!==code):[...prev,code]);}}/>{options.find(o=>o.code===code)?.label || code} — проверено</label><p className="mt-1 text-xs text-slate-500">{!correction.hasBaseline?"Сравнение недоступно":changes.length?`Изменено полей: ${changes.length}`:"Изменений в связанных полях нет"}</p>{changes.map(c=><div key={c.field} className="mt-2 min-w-0 break-words text-xs"><strong>{c.label}</strong><div className="text-slate-500">Было: {c.before}</div><div className="font-semibold text-violet-900">Стало: {c.after}{["proof","photos"].includes(c.group)?" · состав файлов изменён":""}</div></div>)}<button type="button" onClick={()=>onNavigate(GROUPS[code]==="proof"?"proof":GROUPS[code]==="photos"?"photos":GROUPS[code]==="details"?"main":"details")} className="mt-2 text-xs font-semibold text-violet-800 underline">Перейти к полям</button></div>;})}</div>
    {correction.changes.some(c=>!correction.reasonCodes.some(code=>GROUPS[code]==="details" || GROUPS[code]===c.group)) && <details className="mt-3 rounded-xl border bg-white p-3 text-sm"><summary className="cursor-pointer font-semibold">Другие изменения после возврата</summary>{correction.changes.filter(c=>!correction.reasonCodes.some(code=>GROUPS[code]==="details" || GROUPS[code]===c.group)).map(c=><div key={c.field} className="mt-2 break-words text-xs"><strong>{c.label}</strong><div>Было: {c.before}</div><div className="font-semibold text-violet-900">Стало: {c.after}</div></div>)}</details>}
    <p className="mt-3 text-xs text-slate-600">Проверено: {checked.length} из {correction.reasonCodes.length}. Отметки сохраняются отдельно и не публикуют услугу.</p>
    {disabled && <p className="mt-2 text-xs text-amber-800">Сначала сохраните данные услуги и откройте её повторно, затем отметьте результат проверки.</p>}
    <button type="button" disabled={disabled || busy} onClick={async()=>{setBusy(true);setNotice("");try{await onSave(checked);setNotice("Проверка сохранена");}catch(e){setNotice(e.message);}finally{setBusy(false);}}} className="mt-2 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?"Сохраняем…":"Сохранить проверку"}</button><p role="status" className="mt-2 text-sm">{notice}</p>
  </section>;
}
