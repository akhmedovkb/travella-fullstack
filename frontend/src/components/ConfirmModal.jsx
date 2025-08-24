import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

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
  hideCancel = false
}) {
  const { t } = useTranslation();
  const confirmRef = useRef(null);

  const tt = (k, def) => {
    const v = t(k);
    return v === k ? def : v;
  };

  useEffect(() => {
    if (open) setTimeout(() => confirmRef.current?.focus(), 40);
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose?.();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onConfirm?.();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {!!title && (
          <div id="confirm-title" className="text-lg font-semibold mb-3">
            {title}
          </div>
        )}

        <div className="text-sm text-gray-700 whitespace-pre-line">
          {message}
        </div>

        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-gray-50"
          >
            {cancelLabel ?? tt("actions.cancel", "Отмена")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`px-3 py-2 rounded-xl font-semibold text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 hover:bg-black"
            } disabled:opacity-60`}
          >
            {busy ? tt("common.sending", "Отправка…") : (confirmLabel ?? tt("actions.ok", "ОК"))}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
