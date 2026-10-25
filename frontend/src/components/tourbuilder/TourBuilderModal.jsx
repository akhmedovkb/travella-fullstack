import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function TourBuilderModal({ open, title, eyebrow = "Tour Builder", description, children, footer, onClose, maxWidth = "max-w-lg", tone = "default" }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`max-h-[88vh] w-full ${maxWidth} overflow-hidden rounded-lg border border-[#FFA07A]/50 border-t-4 border-t-[#FF5722] bg-white shadow-2xl`}>
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          {tone === "warning" && <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#FFEAD2] text-[#FF5722]"><AlertTriangle size={19} /></span>}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase text-[#FF5722]">{eyebrow}</div>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
            {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
          </div>
          {onClose && <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-[#F1F1F1] hover:text-slate-900" aria-label={t("tb.ui.close", { defaultValue: "Close" })}><X size={18} /></button>}
        </header>
        <div className="max-h-[calc(88vh-152px)] overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-[#F1F1F1]/70 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function TourBuilderNoticeModal({ notice, onClose }) {
  if (!notice) return null;
  return (
    <TourBuilderModal open title={notice.title} description={notice.message} tone={notice.tone || "warning"} onClose={onClose} footer={<><button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">{notice.cancelLabel || "OK"}</button>{notice.action && <button type="button" onClick={() => { onClose(); notice.action(); }} className="h-10 rounded-md bg-[#FF5722] px-5 text-sm font-bold text-white hover:bg-[#e84d1d]">{notice.actionLabel}</button>}</>}>
      {notice.detail && <div className="px-5 py-4 text-sm leading-6 text-slate-700">{notice.detail}</div>}
    </TourBuilderModal>
  );
}
