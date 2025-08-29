// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError } from "../shared/toast";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("clientToken") ||
  localStorage.getItem("token") ||
  localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const arrify = (x) => (Array.isArray(x) ? x : x?.items || x?.data || x?.list || []);
const tryParse = (v) => {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};
const asArray = (x) => {
  const v = tryParse(x) ?? x;
  if (!v) return [];
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
};
const isImg = (att) => {
  const type = att?.type || "";
  const url = att?.url || att?.src || att?.href || att;
  return /(^image\/)/i.test(String(type)) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""));
};
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "");

/* последовательная попытка списка путей */
async function hitMany(method, urls, body) {
  let lastErr;
  for (const u of urls) {
    const full = u.startsWith("http") ? u : `${API_BASE}${u}`;
    try {
      if (method === "GET") {
        const { data } = await axios.get(full, cfg());
        return data;
      } else if (method === "POST") {
        const { data } = await axios.post(full, body ?? {}, cfg());
        return data;
      } else if (method === "PUT") {
        const { data } = await axios.put(full, body ?? {}, cfg());
        return data;
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;
  return (
    <div className="mt-2">
      <div className="text-xs text-gray-500 mb-1">{t("bookings.attachments", { defaultValue: "Вложения" })}</div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw, name: raw.split("/").pop() } : raw || {};
          const url = att.url || att.src || att.href || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;
          return isImg(att) ? (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="block w-28 h-20 rounded border overflow-hidden bg-gray-50" title={name}>
              <img src={url} alt={name} className="w-full h-full object-cover" />
            </a>
          ) : (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="px-2 py-1 text-sm rounded border bg-gray-50 hover:bg-gray-100">
              {name || t("bookings.file", { defaultValue: "файл" })}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function ClientBookings({ refreshKey }) {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await hitMany("GET", [
        "/api/bookings/my",
        "/api/bookings/mine",
        "/api/my/bookings",
        "/api/client/bookings",
        "/api/clients/bookings",
        "/api/bookings?mine=1",
        "/api/bookings?me=1",
      ]);
      setList(arrify(data));
    } catch (e) {
      console.error
