// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";

/* ==== helpers ==== */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const token = () => localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${token()}` } });

function tryParseJSON(val) {
  if (!val) return null;
  if (Array.isArray(val) || typeof val === "object") return val;
  try { return JSON.parse(String(val)); } catch { return null; }
}
function asArray(x) {
  if (!x) return [];
  const v = tryParseJSON(x) ?? x;
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
}
function isImage(att) {
  const type = att?.type || "";
  const url  = att?.url  || att;
  return /(^image\/)|(.(png|jpe?g|webp|gif|bmp)(\?|$))/i.test(`${type}`) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(`${url}`);
}

/* ==== Attachments block ==== */
function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);

  if (!files.length) return null;
  return (
    <div className="mt-2">
      <div className="text-xs text-gray-500 mb-1">
        {t("bookings.attachments", { defaultValue: "Вложения" })}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw, name: raw.split("/").pop() } : raw;
          const url = att.url || att.src || att.href || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;

          if (isImage(att)) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-28 h-20 rounded border overflow-hidden"
                title={name}
              >
                <img src={url} alt={name} className="w-full h-full object-cover" />
              </a>
            );
          }
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 text-sm rounded border bg-gray-50 hover:bg-gray-100"
            >
              {name || t("bookings.file", { defaultValue: "файл" })}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ==== Page ==== */
export default function ProviderBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/bookings/provider`, cfg());
      const rows = Array.isArray(res.data) ? res.data : res.data?.items || [];
      setList(rows);
    } catch (e) {
      console.error("load provider bookings failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const accept = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${id}/accept`, {}, cfg());
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };
  const reject = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${id}/reject`, {}, cfg());
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };
  const cancel = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${id}/cancel`, {}, cfg());
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    }
    if (!list.length) {
      return <div className="text-gray-500">{t("bookings.empty", { defaultValue: "Пока нет бронирований." })}</div>;
    }
    return (
      <div className="space-y-4">
        {list.map((b) => (
          <div key={b.id} className="border rounded-xl p-3">
            <BookingRow
              booking={b}
              viewerRole="provider"
              onAccept={(bk) => accept(bk.id)}
              onReject={(bk) => reject(bk.id)}
              onCancel={(bk) => cancel(bk.id)}
            />
            <AttachmentList items={b.attachments} />
          </div>
        ))}
      </div>
    );
  }, [list, loading, t]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">
        {t("bookings.title_provider", { defaultValue: "Бронирования (Поставщик)" })}
      </h1>
      {content}
    </div>
  );
}
