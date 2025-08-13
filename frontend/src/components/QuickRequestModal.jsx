import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export default function QuickRequestModal({ open, onClose, onSubmit }) {
  const { t } = useTranslation();
  const noteRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => noteRef.current?.focus(), 40);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* modal */}
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border p-5">
        <div className="text-lg font-semibold mb-3">
          {t("actions.quick_request") || "Quick request"}
        </div>

        <label
          className="block text-sm text-gray-600 mb-1"
          htmlFor="quick-note"
        >
          {t("common.note_optional") ||
            "Request note (optional):"}
        </label>

        <textarea
          id="quick-note"
          ref={noteRef}
          rows={4}
          className="w-full resize-none rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500"
          placeholder={t("common.comment") || "Comment"}
        />

        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl border hover:bg-gray-50"
          >
            {t("actions.cancel") || "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => onSubmit(noteRef.current?.value || undefined)}
            className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            {t("actions.send") || "SEND"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
