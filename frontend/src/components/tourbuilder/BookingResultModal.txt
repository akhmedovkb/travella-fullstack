// frontend/src/components/tourbuilder/BookingResultModal.jsx
import React from "react";
import { useTranslation } from "react-i18next";

export default function BookingResultModal({ open, result, onClose }) {
  const { t } = useTranslation();

  if (!open || !result) return null;

  const { created = 0, groupId, url } = result;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg">
        <h3 className="text-lg font-semibold mb-3">
          {t("tour_builder.result_title", "Бронирования созданы")}
        </h3>

        <div className="space-y-3 text-sm text-gray-700">
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

        <div className="flex justify-end gap-2 pt-4">
          {url && (
            <a
              href={url}
              className="px-4 py-2 rounded bg-orange-500 text-white hover:bg-orange-600 text-sm"
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
            className="px-4 py-2 rounded border text-sm"
          >
            {t("actions.ok", "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
