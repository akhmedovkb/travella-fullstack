// frontend/src/components/ConfirmModal.jsx

import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

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
  onConfirm,
  onClose,
  hideCancel = false,
}) {
  const { t } = useTranslation();
  const confirmRef = useRef(null);

  const tt = (k, d) => t(k, { defaultValue: d });

  useEffect(() => {
    if (open && confirmRef.current) {
      const id = setTimeout(() => confirmRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  const confirmClass = danger
    ? "bg-rose-600 hover:bg-rose-700 focus:ring-rose-200"
    : "bg-slate-950 hover:bg-slate-800 focus:ring-slate-200";

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

      <div className="relative w-[92vw] max-w-md overflow-hidden rounded-[2rem] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.25)]">
        <div className="border-b border-orange-100 bg-gradient-to-r from-orange-50 via-white to-orange-50 px-6 py-5">
          <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600 ring-1 ring-orange-100">
            TRAVELLA.UZ
          </div>

          {title && (
            <div className="mt-3 text-xl font-black tracking-[-0.02em] text-slate-950">
              {title}
            </div>
          )}

          {message && (
            <div className="mt-2 text-sm font-medium leading-6 text-slate-600">
              {typeof message === "string" ? message : message}
            </div>
          )}
        </div>

        <div className="flex gap-3 p-5">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelLabel ?? tt("actions.cancel", "Отмена")}
            </button>
          )}

          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm ?? onClose}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black text-white transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? tt("common.sending", "Отправка…") : (confirmLabel ?? tt("actions.ok", "ОК"))}
          </button>
        </div>
      </div>
    </div>
  );
}
