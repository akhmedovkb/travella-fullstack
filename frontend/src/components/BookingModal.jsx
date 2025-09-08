import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

const readFilesAsDataUrls = (files) =>
  Promise.all(
    [...files].map(
      (f) =>
        new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve({ name: f.name, type: f.type, dataUrl: fr.result });
          fr.readAsDataURL(f);
        })
    )
  );

export default function BookingModal({ open, onClose, token, providerId, serviceId, dates }) {
  const { t, i18n } = useTranslation();
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const ymd = (d) => d.toISOString().slice(0, 10);

  // человекочитаемый вывод дат в текущей локали
  const fmt = new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
  const humanDates = dates
    .map((d) => {
      const [y, m, dd] = ymd(d).split("-").map(Number);
      return fmt.format(new Date(Date.UTC(y, m - 1, dd)));
    })
    .join(", ");

  const submit = async () => {
    try {
      setSending(true);
      const attachments = await readFilesAsDataUrls(files);
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const body = {
        provider_id: providerId,
        service_id: serviceId ?? null,
        dates: dates.map(ymd),
        message,
        attachments,
      };
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/bookings`, body, config);
      toast.success(t("messages.booking_created"));
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.message || t("errors.booking_create"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg">
        <h3 className="text-lg font-semibold mb-3">{t("booking.title")}</h3>

        <div className="space-y-3">
          <div>
            <div className="text-sm text-gray-500">{t("booking.selected_dates", "Выбранные даты")}</div>
            <div className="text-sm">{humanDates}</div>
          </div>

          <textarea
            className="w-full border rounded-lg p-3"
            rows={5}
            placeholder={t("common.note_optional")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <div>
            <div className="text-sm text-gray-500 mb-1">
              {t("booking.attachments_hint", "Вложения (PDF, Word, Excel, PPT, изображения и т.д.)")}
            </div>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="block"
              aria-label={t("select_files")}
            />
            <div className="text-xs text-gray-500 mt-1">
              {files?.length ? t("file_chosen") : t("no_files_selected")}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => onClose(false)}
              className="px-4 py-2 rounded border"
              disabled={sending}
            >
              {t("actions.cancel")}
            </button>
            <button
              onClick={submit}
              className="px-4 py-2 rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
              disabled={sending}
            >
              {sending ? t("common.sending") : t("booking.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
