// frontend/src/components/ConfirmModal.jsx

import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";

/**
 * Универсальная брендовая модалка подтверждения Travella.
 * Поддерживает режим одной кнопки (hideCancel), когда показываем только ОК.
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  busyLabel,
  onConfirm,
  onClose,
  hideCancel = false,
}) {
  const { t } = useTranslation();
  const confirmRef = useRef(null);

  const tt = (k, d) => t(k, { defaultValue: d });

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => confirmRef.current?.focus(), 10);
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  const confirmClass = danger
    ? "bg-red-600 hover:bg-red-700 focus:ring-red-100"
    : "bg-orange-500 hover:bg-orange-600 focus:ring-orange-100";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose?.();
        }}
        aria-hidden="true"
      />

      <div className="relative w-[92vw] max-w-md overflow-hidden rounded-lg border border-slate-200 border-t-4 border-t-orange-500 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
        <div className="flex items-start gap-4 px-6 py-5">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${danger ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"}`}>
            <AlertTriangle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase text-orange-600">TRAVELLA</div>
            {title ? <h2 className="mt-1 text-lg font-black text-slate-950">{title}</h2> : null}
            {message ? <div className="mt-2 text-sm font-medium leading-6 text-slate-600">{message}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label={tt("actions.close", "Закрыть")}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-10 min-w-24 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelLabel ?? tt("actions.cancel", "Отмена")}
            </button>
          )}

          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm ?? onClose}
            className={`inline-flex h-10 min-w-28 items-center justify-center rounded-lg px-4 text-sm font-black text-white transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? (busyLabel ?? tt("common.sending", "Отправка…")) : (confirmLabel ?? tt("actions.ok", "ОК"))}
          </button>
        </div>
      </div>
    </div>
  );
}
