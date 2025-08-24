//frontend/src/components/ConfirmModal.jsx
  
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * Универсальная модалка подтверждения.
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
  hideCancel = false, // <— если true, показываем только кнопку ОК
}) {
  const { t } = useTranslation();
  const confirmRef = useRef(null);

  const tt = (k, d) => t(k, { defaultValue: d });

  useEffect(() => {
    if (open && confirmRef.current) {
      // небольшой таймаут, чтобы фокус сработал после mount
      const id = setTimeout(() => confirmRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* modal */}
      <div className="relative max-w-lg w-[92vw] bg-white rounded-2xl shadow-xl p-5 md:p-6">
        {title && <div className="text-lg font-semibold mb-2">{title}</div>}

        {typeof message === "string" ? (
          <div className="text-gray-700">{message}</div>
        ) : (
          message
        )}

        <div className="mt-4 flex gap-2 justify-end">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl border hover:bg-gray-50"
            >
              {cancelLabel ?? tt("actions.cancel", "Отмена")}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm ?? onClose}
            className={`px-3 py-2 rounded-xl font-semibold text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 hover:bg-black"
            } disabled:opacity-60`}
          >
            {busy ? tt("common.sending", "Отправка…") : (confirmLabel ?? tt("actions.ok", "ОК"))}
          </button>
        </div>
      </div>
    </div>
  );
}
