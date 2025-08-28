import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

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
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);

  if (!open) return null;

  const submit = async () => {
    try {
      const attachments = await readFilesAsDataUrls(files);
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const body = {
        provider_id: providerId,
        service_id: serviceId ?? null,
        dates: dates.map((d) => d.toISOString().slice(0, 10)),
        message,
        attachments,
      };
      await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/bookings`, body, config);
      toast.success("Заявка отправлена провайдеру");
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.message || "Не удалось создать бронь");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg">
        <h3 className="text-lg font-semibold mb-3">Бронирование</h3>

        <div className="space-y-3">
          <div>
            <div className="text-sm text-gray-500">Даты</div>
            <div className="text-sm">
              {dates.map((d) => d.toISOString().slice(0, 10)).join(", ")}
            </div>
          </div>

          <textarea
            className="w-full border rounded-lg p-3"
            rows={5}
            placeholder="Пожелания, детали поездки…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <input
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="block"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => onClose(false)} className="px-4 py-2 rounded border">
              Отмена
            </button>
            <button
              onClick={submit}
              className="px-4 py-2 rounded bg-orange-500 text-white hover:bg-orange-600"
            >
              Забронировать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
