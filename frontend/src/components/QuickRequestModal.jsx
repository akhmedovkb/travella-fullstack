import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export default function QuickRequestModal({ open, onClose, onSubmit }) {
  const { t } = useTranslation();
  const noteRef = useRef(null);
  const boxRef = useRef(null);

  // safe translate (чтобы не показывать ключи)
  const tt = (k, def) => {
    const v = t(k);
    return v === k ? def : v;
  };

  useEffect(() => {
    if (open) setTimeout(() => noteRef.current?.focus(), 40);
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose?.();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const note = noteRef.current?.value?.trim() || undefined;
      onSubmit?.(note);
    }
  };

  const handleSubmit = () => {
    const note = noteRef.current?.value?.trim() || undefined;
    onSubmit?.(note);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      aria-modal="true"
      role="dialog"
      aria-labelledby="qr-title"
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* modal */}
      <div
        ref={boxRef}
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="qr-title" className="text-lg font-semibold mb-3">
          {tt("actions.quick_request", "Quick request")}
        </div>

        <label className="block text-sm text-gray-600 mb-1" htmlFor="quick-note">
          {tt("common.note_optional", "Request note (optional):")}
        </label>

        <textarea
          id="quick-note"
          ref={noteRef}
          rows={4}
          className="w-full resize-none rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500"
          placeholder={tt("common.comment", "Comment")}
        />

        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-gray-50"
          >
            {tt("actions.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            {tt("actions.send", "SEND")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
