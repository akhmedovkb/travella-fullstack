// frontend/src/pages/ClientProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

/* helpers */
function makeTgHref(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").replace(/^t\.me\//i, "");
  return `https://t.me/${s}`;
}
function cleanPhone(v) {
  return String(v || "").replace(/[^+\d]/g, "");
}

export default function ClientProfile() {
  const { id } = useParams();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token");
  const config = useMemo(
    () => ({ headers: token ? { Authorization: `Bearer ${token}` } : undefined }),
    [token]
  );

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);

  // пробуем несколько эндпоинтов: /api/profile/client/:id затем /api/clients/:id
  const fetchProfile = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const tryUrls = [
        `${API_BASE}/api/profile/client/${id}`,
        `${API_BASE}/api/clients/${id}`,
      ];
      let data = null;
      for (const url of tryUrls) {
        try {
          const r = await axios.get(url, config);
          if (r?.data) {
            data = r.data;
            break;
          }
        } catch {}
      }
      setProfile(data || {});
    } catch (e) {
      console.error("load client profile failed:", e?.response?.data || e?.message);
      setProfile({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // Поддержка разных ключей из БД/АПИ
  const avatar =
    profile?.avatar ||
    profile?.avatar_url ||
    profile?.photo ||
    profile?.photo_url ||
    profile?.image ||
    null;

  const name =
    profile?.name ||
    profile?.title ||
    profile?.full_name ||
    profile?.display_name ||
    "—";

  const phone =
    profile?.phone ||
    profile?.contacts?.phone ||
    profile?.contact_phone ||
    null;

  const telegram =
    profile?.telegram ||
    profile?.social ||
    profile?.contacts?.telegram ||
    profile?.contact_telegram ||
    null;

  const telHref = phone ? `tel:${cleanPhone(phone)}` : null;
  const tgHref = telegram ? makeTgHref(telegram) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
      {/* Шапка */}
      <div className="bg-white rounded-xl border p-4 md:p-6">
        <div className="flex items-start gap-4">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
            {avatar ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt
              <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                Нет фото
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="text-2xl font-semibold">
              Клиент: <span className="break-words">{name}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
              <div>
                Телефон:{" "}
                {telHref ? (
                  <a className="underline hover:no-underline break-all" href={telHref}>
                    {phone}
                  </a>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
              <div>
                Telegram:{" "}
                {tgHref ? (
                  <a
                    className="underline hover:no-underline break-all"
                    href={tgHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {String(telegram).startsWith("@") ? telegram : "@" + String(telegram)}
                  </a>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Отзывы — заглушка (как у провайдера, без ломания логики) */}
      <div className="mt-6 bg-white rounded-xl border p-4 md:p-6">
        <div className="text-lg font-semibold mb-2">Отзывы</div>
        <div className="text-sm text-gray-500">Пока нет отзывов.</div>
      </div>

      {/* Форма оставить отзыв — заглушка (чтобы не ломать существующую разметку) */}
      <div className="mt-6 bg-white rounded-xl border p-4 md:p-6">
        <div className="text-lg font-semibold mb-3">Оставить отзыв</div>
        <div className="text-sm text-gray-500">
          Форма будет доступна после подключения API отзывов.
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/5 pointer-events-none">
          <div className="absolute bottom-4 right-4 text-sm bg-white border rounded px-3 py-2 shadow">
            Загрузка…
          </div>
        </div>
      )}
    </div>
  );
}
