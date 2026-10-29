import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const ProviderCorrectionContext = createContext(null);
export const CORRECTION_GROUPS = {NO_PROOF:"proof",BAD_PROOF:"proof",NO_DATES:"dates",BAD_PRICE:"price",HOTEL_DETAILS:"hotel",NO_PHOTO:"photos",MISSING_DETAILS:"details",WRONG_CATEGORY:"details",DUPLICATE:"details",OTHER:"details"};
export function useProviderCorrections(api,service) {
  const [correction,setCorrection]=useState(null),[checkedCodes,setCheckedCodes]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    setCorrection(null);setCheckedCodes([]);setError(false);
    if(!service?.id){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);
    api.get(`/api/providers/services/${service.id}/corrections`,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setCorrection(data.correction || null);}).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[api,service?.id,service?.updated_at,service?.status,revision]);
  return {correction,checkedCodes,setCheckedCodes,loading,error,reload:()=>setRevision(v=>v+1)};
}
export function ProviderCorrectionNote({group}) {
  const correction=useContext(ProviderCorrectionContext);
  const {t}=useTranslation();
  const codes=correction?.reasonCodes.filter(code=>CORRECTION_GROUPS[code]===group) || [];
  if(!codes.length) return null;
  const notes=correction.reasonItems?.filter(item=>codes.includes(item.code)) || [];
  return <details className="mt-2 min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" aria-label={t("provider_corrections.field_note")}><summary className="cursor-pointer font-semibold">{t("provider_corrections.field_note")} · {t(`provider_corrections.groups.${group}`)}</summary><div className="mt-2 space-y-2 whitespace-pre-wrap break-words text-xs">{notes.length?notes.map(item=><p key={item.code}>{item.text}</p>):<p>{correction.reason}</p>}</div></details>;
}
export function ProviderCorrectionPanel({state,dirty,saving,onSubmit,onNavigate,onSave}) {
  const {t}=useTranslation();
  const [busy,setBusy]=useState(false);
  if(state.loading) return <div role="status" className="rounded-xl border bg-white p-4 text-sm">{t("provider_corrections.loading")}</div>;
  if(state.error) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm"><p>{t("provider_corrections.load_error")}</p><button type="button" onClick={state.reload} className="mt-2 font-bold underline">{t("provider_corrections.retry")}</button></div>;
  const c=state.correction;
  if(!c) return null;
  const disabled=dirty || saving || busy || c.pending;
  const ready=c.reasonCodes.length>0 && c.reasonCodes.every(code=>state.checkedCodes.includes(code));
  return <section id="provider-correction-checklist" aria-label={t("provider_corrections.title")} className="min-w-0 scroll-mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
    <h2 className="text-lg font-bold text-amber-950">{t("provider_corrections.title")}</h2>
    <p className="mt-1 text-sm text-amber-900">{c.pending?t("provider_corrections.pending"):t("provider_corrections.intro")}</p>
    <details className="mt-3 rounded-xl border border-amber-200 bg-white p-3" open><summary className="cursor-pointer text-sm font-bold">{t("provider_corrections.message")}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{c.reason}</p></details>
    {!c.pending && <><fieldset className="mt-4 space-y-2"><legend className="mb-2 text-sm font-bold">{t("provider_corrections.checklist")}</legend>{c.reasonCodes.map(code=><div key={code} className="min-w-0 rounded-xl border border-amber-200 bg-white p-3"><label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" disabled={disabled} className="mt-1 shrink-0" checked={state.checkedCodes.includes(code)} onChange={()=>state.setCheckedCodes(prev=>prev.includes(code)?prev.filter(v=>v!==code):[...prev,code])}/><span className="break-words">{t(`provider_corrections.reasons.${code}`)}</span></label><button type="button" disabled={busy || saving} onClick={()=>onNavigate(CORRECTION_GROUPS[code])} className="mt-2 text-xs font-bold text-amber-900 underline">{t("provider_corrections.go_fields")}</button></div>)}</fieldset>
    <p className="mt-3 text-xs text-amber-900">{dirty?t("provider_corrections.save_first"):t("provider_corrections.confirm_hint")}</p>
    {dirty && onSave && <button type="button" disabled={saving || busy} onClick={onSave} className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:w-auto">{saving?t("saving"):t("provider_corrections.save_changes")}</button>}
    <p className="mt-2 text-sm font-semibold" role="status">{t("provider_corrections.progress",{count:state.checkedCodes.length,total:c.reasonCodes.length})}</p>
    <button type="button" disabled={disabled || !ready} onClick={async()=>{setBusy(true);try{await onSubmit({requestId:c.requestId,expected_edit_version:c.editVersion,fingerprint:c.fingerprint,checkedCodes:state.checkedCodes});}finally{setBusy(false);}}} className="mt-3 w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:w-auto">{busy?t("provider_corrections.submitting"):t("provider_corrections.submit")}</button></>}
  </section>;
}
