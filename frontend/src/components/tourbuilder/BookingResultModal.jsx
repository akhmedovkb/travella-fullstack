// frontend/src/components/tourbuilder/BookingResultModal.jsx
import React from "react";
import { useTranslation } from "react-i18next";

export default function BookingResultModal({ open, result, onClose }) {
  const { t } = useTranslation();

  if (!open || !result) return null;

  const { created = 0, groupId, url } = result;

  return (
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="booking-result-title">
      <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-xs font-bold uppercase text-orange-600">Tour Builder</div>
        <h3 id="booking-result-title" className="mt-1 text-xl font-bold text-slate-950">
          {t("tour_builder.result_title", "Бронирования созданы")}
        </h3></div>

        <div className="space-y-3 px-5 py-5 text-sm text-gray-700">
          <p>
            {t("tour_builder.result_created", {
              count: created,
              defaultValue: "Создано бронирований: {{count}}.",
            })}
          </p>

          {groupId && (
            <p className="text-xs text-gray-500">
              {t("tour_builder.result_group_id", "ID пакета")}:{" "}
              <span className="font-mono">{groupId}</span>
            </p>
          )}

          {url && (
            <p className="text-xs text-gray-500">
              {t(
                "tour_builder.result_hint",
                "Вы можете открыть пакет в разделе бронирований."
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          {url && (
            <a
              href={url}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-500"
              onClick={onClose}
            >
              {t(
                "tour_builder.result_open_package",
                "Открыть пакет в Dashboard"
              )}
            </a>
          )}

          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {t("actions.ok", "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
