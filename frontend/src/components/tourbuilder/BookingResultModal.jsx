// frontend/src/components/tourbuilder/BookingResultModal.jsx
import React from "react";
import { useTranslation } from "react-i18next";
import { TourBuilderModal } from "./TourBuilderModal";

export default function BookingResultModal({ open, result, onClose }) {
  const { t } = useTranslation();

  if (!open || !result) return null;

  const { created = 0, groupId, url } = result;

  return (
    <TourBuilderModal open title={t("tour_builder.result_title")} onClose={onClose} footer={<>{url && <a href={url} className="rounded-md bg-[#FF5722] px-4 py-2 text-sm font-bold text-white hover:bg-[#e84d1d]" onClick={onClose}>{t("tour_builder.result_open_package")}</a>}<button onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">{t("actions.ok", "OK")}</button></>}>
        <div className="space-y-3 px-5 py-5 text-sm text-gray-700">
          <p>
            {t("tour_builder.result_created", {
              count: created,
            })}
          </p>

          {groupId && (
            <p className="text-xs text-gray-500">
              {t("tour_builder.result_group_id")}:{" "}
              <span className="font-mono">{groupId}</span>
            </p>
          )}

          {url && (
            <p className="text-xs text-gray-500">
              {t("tour_builder.result_hint")}
            </p>
          )}
        </div>
    </TourBuilderModal>
  );
}
