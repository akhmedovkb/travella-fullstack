//frontend/src/components/ProviderProfile.jsx
  
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import AsyncCreatableSelect from "react-select/async-creatable";

import ProviderLanguages from "./ProviderLanguages";
import ProviderCompleteness from "./ProviderCompleteness";
import ProviderStatsHeader from "./ProviderStatsHeader";
import ProviderReviews from "./ProviderReviews";
import { tSuccess, tError, tInfo, tWarn } from "../shared/toast";

/** ================= Helpers ================= */

function normalizeLocationList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  const raw = String(value || "").trim();
  if (!raw) return [];

  const pgArrayMatch = raw.match(/^\{(.+)\}$/);
  if (pgArrayMatch) {
    return pgArrayMatch[1]
      .split(",")
      .map((item) => item.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }

  return [raw];
}

// data: → blob: (для сертификата)
function dataUrlToBlobUrl(dataUrl) {
  try {
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:"))
      return null;
    const [head, b64] = dataUrl.split(",");
    const mime =
      (head.match(/^data:(.*?);base64$/) || [])[1] || "application/octet-stream";
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// resize для фото авто (и можно использовать ещё где-то)
function resizeImageFile(
  file,
  targetW = 1600,
  targetH = 1000,
  quality = 0.86,
  mime = "image/jpeg"
) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!String(file.type || "").startsWith("image/")) {
        reject(new Error("Not an image"));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const srcW = img.width,
          srcH = img.height;
        const targetAR = targetW / targetH;
        const srcAR = srcW / srcH;

        let sx, sy, sw, sh;
        if (srcAR > targetAR) {
          sh = srcH;
          sw = sh * targetAR;
          sx = Math.max(0, (srcW - sw) / 2);
          sy = 0;
        } else {
          sw = srcW;
          sh = sw / targetAR;
          sx = 0;
          sy = Math.max(0, (srcH - sh) / 2);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL(mime, quality));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Универсально достаём текст ошибки из разных форматов
const extractApiErrorText = (err) => {
  const d = err?.response?.data;
  if (!d) return "";
  if (typeof d === "string") return d;

  const msgs = [];
  if (d.message) msgs.push(String(d.message));
  if (typeof d.error === "string") msgs.push(d.error);

  if (Array.isArray(d.errors)) {
    msgs.push(
      ...d.errors
        .map((e) =>
          e?.message ||
          e?.msg ||
          e?.error ||
          (e?.field
            ? `${e.field}: ${e?.reason || e?.error || "invalid"}`
            : "")
        )
        .filter(Boolean)
    );
  }

  if (Array.isArray(d?.error?.details)) {
    msgs.push(
      ...d.error.details.map(
        (x) =>
          x?.message ||
          `${x?.path?.join?.(".")}: ${x?.message || ""}`
      )
    );
  }
  if (Array.isArray(d.details)) {
    msgs.push(...d.details.map((x) => x?.message || String(x)));
  }
  return msgs.filter(Boolean).join("\n");
};

// RU/UZ/EN приоритет: i18n → navigator → en
const makePickGeoLang = (i18n) => () => {
  const allowed = ["ru", "uz", "en"];
  const fromI18n = (i18n?.language || "").slice(0, 2).toLowerCase();
  if (allowed.includes(fromI18n)) return fromI18n;
  const nav =
    typeof navigator !== "undefined"
      ? (navigator.languages || [navigator.language])
      : [];
  const langs = nav
    .filter(Boolean)
    .map((l) => String(l).slice(0, 2).toLowerCase());
  return langs.find((l) => allowed.includes(l)) || "en";
};

/** Debounced + cancellable loader for AsyncSelect/AsyncCreatableSelect */
function useDebouncedLoader(asyncFn, delay = 400) {
  const timerRef = useRef(null);
  const ctrlRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (ctrlRef.current) ctrlRef.current.abort();
    };
  }, []);

  return useCallback(
    (inputValue) =>
      new Promise((resolve, reject) => {
        const text = (inputValue || "").trim();

        if (text.length < 2) {
          if (timerRef.current) clearTimeout(timerRef.current);
          if (ctrlRef.current) ctrlRef.current.abort();
          resolve([]);
          return;
        }

        if (timerRef.current) clearTimeout(timerRef.current);
        if (ctrlRef.current) ctrlRef.current.abort();

        const controller = new AbortController();
        ctrlRef.current = controller;

        timerRef.current = setTimeout(async () => {
          try {
            const out = await asyncFn(text, controller.signal);
            resolve(out);
          } catch (e) {
            if (
              e?.name === "AbortError" ||
              e?.code === "ERR_CANCELED" ||
              e?.message === "canceled"
            ) {
              resolve([]);
              return;
            }
            reject(e);
          }
        }, delay);
      }),
    [asyncFn, delay]
  );
}

const makeAsyncSelectI18n = (t) => ({
  noOptionsMessage: ({ inputValue }) => {
    const s = (inputValue || "").trim();
    if (s.length < 2) {
      return t("select.type_more", {
        defaultValue: "Введите минимум 2 символа",
      });
    }
    return t("select.no_options", {
      defaultValue: "Ничего не найдено",
    });
  },
  loadingMessage: () =>
    t("select.loading", { defaultValue: "Загрузка…" }),
});


function providerTypeLabel(type, t) {
  const key = String(type || "").trim().toLowerCase();

  const labels = {
    agent: t("provider_type.agent", { defaultValue: "Турагент" }),
    agency: t("provider_type.agent", { defaultValue: "Турагент" }),
    touragent: t("provider_type.agent", { defaultValue: "Турагент" }),
    hotel: t("provider_type.hotel", { defaultValue: "Отель" }),
    guide: t("provider_type.guide", { defaultValue: "Гид" }),
    transport: t("provider_type.transport", { defaultValue: "Транспорт" }),
    transfer: t("provider_type.transport", { defaultValue: "Транспорт" }),
  };

  if (labels[key]) return labels[key];
  if (!key) return t("not_specified", { defaultValue: "Не указан" });

  return String(type)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ================= Component ================= */

const ProviderProfile = () => {
  const { t, i18n } = useTranslation();

  const token =
    (typeof localStorage !== "undefined" &&
      localStorage.getItem("token")) ||
    "";
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API_BASE });
    instance.interceptors.request.use((cfg) => {
      const tok = localStorage.getItem("token");
      if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
      return cfg;
    });
    return instance;
  }, [API_BASE]);

  // якоря для ProviderCompleteness
  const idMap = useRef({
    languages: "anchor-languages",
    transport: "anchor-transport",
    certificate: "anchor-certificate",
    logo: "anchor-logo",
    telegram: "anchor-telegram",
    fallback: "anchor-profile-left",
  }).current;

  const scrollToProfilePart = useCallback(
    (key) => {
      const id = idMap[key] || idMap.fallback;
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [idMap]
  );

  const pickGeoLang = useMemo(
    () => makePickGeoLang(i18n),
    [i18n]
  );

  const ASYNC_I18N = useMemo(
    () => makeAsyncSelectI18n(t),
    [t]
  );
  const ASYNC_MENU_PORTAL = {
    menuPortalTarget:
      typeof document !== "undefined" ? document.body : null,
    styles: {
      menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    },
  };

  // ---------- СТЕЙТ ПРОФИЛЯ ----------
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);

  const [newPhoto, setNewPhoto] = useState(null);
  const [newCertificate, setNewCertificate] = useState(null);
  const [newAddress, setNewAddress] = useState("");
  const [regions, setRegions] = useState([]); // [{value,label}, ...] EN
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdOpen, setPwdOpen] = useState(false);
  const [stats, setStats] = useState(null);

  const langRef = useRef(null);

  // автопарк
  const emptyCar = useMemo(
    () => ({ model: "", seats: "", images: [], is_active: true }),
    []
  );
  const [carFleet, setCarFleet] = useState([]);
  const addCar = () =>
    setCarFleet((v) => [...v, { ...emptyCar }]);
  const removeCar = (idx) =>
    setCarFleet((v) => v.filter((_, i) => i !== idx));
  const updateCar = (idx, patch) =>
    setCarFleet((v) =>
      v.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );
  const updateCarImage = (idx, imgs) =>
    updateCar(idx, { images: imgs });

  // providerId для отзывов
  const providerIdRaw =
    profile?.id ??
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("provider_id") ||
        localStorage.getItem("id")
      : null);
  const providerId =
    providerIdRaw != null ? Number(providerIdRaw) : null;
  const hasProviderId =
    Number.isFinite(providerId) && providerId > 0;

  // Telegram deep-link
  const botUser = import.meta.env.VITE_TG_BOT_USERNAME || "";
  const isTgLinked = Boolean(
    profile?.telegram_chat_id || profile?.tg_chat_id
  );
  const tgDeepLink = useMemo(() => {
    if (!botUser || !hasProviderId) return null;
    return `https://t.me/${botUser}?start=p_${providerId}`;
  }, [botUser, hasProviderId, providerId]);

  // ---------- ЗАГРУЗКА ГОРОДОВ ДЛЯ РЕГИОНОВ ----------
  const loadCitiesRaw = useCallback(
    async (inputValue, signal) => {
      if (!inputValue) return [];
      try {
        const { data } = await axios.get(
          "https://secure.geonames.org/searchJSON",
          {
            params: {
              name_startsWith: inputValue,
              q: inputValue,
              featureClass: "P",
              maxRows: 10,
              fuzzy: 0.9,
              style: "FULL",
              username: import.meta.env.VITE_GEONAMES_USERNAME,
              lang: pickGeoLang(),
            },
            signal,
          }
        );
        return (data.geonames || []).map((city) => ({
          value: city.name,
          label: city.name,
        }));
      } catch (error) {
        if (error?.code === "ERR_CANCELED") return [];
        console.error("Ошибка загрузки городов:", error);
        return [];
      }
    },
    [pickGeoLang]
  );

  const loadCities = useDebouncedLoader(loadCitiesRaw, 400);

  // ---------- ЗАГРУЗКА ПРОФИЛЯ + СТАТЫ ----------
  useEffect(() => {
    const c1 = new AbortController();
    const c2 = new AbortController();

    // профиль
    api
      .get(`/api/providers/profile`, { signal: c1.signal })
      .then((res) => {
        const p = res.data || {};
        setProfile(p);

        const loc = normalizeLocationList(p.location);
        setRegions(loc.map((c) => ({ value: c, label: c })));
        setNewSocial(p.social || "");
        setNewPhone(p.phone || "");
        setNewAddress(p.address || "");
        setCarFleet(Array.isArray(p.car_fleet) ? p.car_fleet : []);
      })
      .catch((err) => {
        if (err?.code === "ERR_CANCELED") return;
        console.error("Ошибка загрузки профиля", err);
        tError(
          t("profile_load_error") ||
            "Не удалось загрузить профиль"
        );
      });

    // статистика
    api
      .get(`/api/providers/stats`, { signal: c2.signal })
      .then((res) => setStats(res.data || {}))
      .catch((err) => {
        if (err?.code === "ERR_CANCELED") return;
        setStats({});
      });

    return () => {
      c1.abort();
      c2.abort();
    };
  }, [api, t]);

  // сохраняем provider_id в localStorage
  useEffect(() => {
    if (profile?.id && typeof localStorage !== "undefined") {
      localStorage.setItem("provider_id", String(profile.id));
    }
  }, [profile?.id]);

  // сертификат: поддержка data: → blob:
  const certObjectUrl = useMemo(() => {
    const src = profile?.certificate || newCertificate || "";
    return src && src.startsWith("data:")
      ? dataUrlToBlobUrl(src)
      : src || null;
  }, [profile?.certificate, newCertificate]);

  useEffect(() => {
    return () => {
      if (
        certObjectUrl &&
        typeof certObjectUrl === "string" &&
        certObjectUrl.startsWith("blob:")
      ) {
        URL.revokeObjectURL(certObjectUrl);
      }
    };
  }, [certObjectUrl]);

  // ---------- HANDLERS ПРОФИЛЯ ----------

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const handleCertificateChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewCertificate(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = () => {
    const updated = {};

    // location как массив строк
    const nextLocations = regions
      .map((r) => r.value)
      .filter(Boolean);
    const sameLocations =
      Array.isArray(profile.location) &&
      profile.location.length === nextLocations.length &&
      profile.location.every(
        (x, i) => x === nextLocations[i]
      );
    if (!sameLocations) updated.location = nextLocations;

    if (newSocial !== profile.social) updated.social = newSocial;
    if (newPhone !== profile.phone) updated.phone = newPhone;
    if (newAddress !== profile.address)
      updated.address = newAddress;
    if (newPhoto) updated.photo = newPhoto;
    if (newCertificate) updated.certificate = newCertificate;

    updated.car_fleet = (carFleet || [])
      .map((c) => ({
        model: String(c.model || "").trim(),
        seats: Number.parseInt(c.seats, 10) || null,
        images: Array.isArray(c.images)
          ? c.images.slice(0, 10)
          : [],
        is_active: c.is_active !== false,
      }))
      .filter((c) => c.model && c.seats);

    // языки из ProviderLanguages
    try {
      const nextLangs = Array.isArray(
        langRef.current?.getValue()
      )
        ? langRef.current.getValue()
        : [];
      const prevLangs = Array.isArray(profile.languages)
        ? profile.languages
        : [];
      const sameLangs =
        nextLangs.length === prevLangs.length &&
        nextLangs.every((x, i) => x === prevLangs[i]);
      if (!sameLangs) {
        updated.languages = nextLangs;
      }
    } catch {
      /* ignore */
    }

    if (Object.keys(updated).length === 0) {
      tInfo(t("no_changes") || "Изменений нет");
      return;
    }

    api
      .put(`/api/providers/profile`, updated)
      .then((res) => {
        const p = res?.data?.provider;
        if (p) {
          setProfile(p);
          setRegions(
            Array.isArray(p.location)
              ? p.location.map((c) => ({
                  value: c,
                  label: c,
                }))
              : []
          );
          setCarFleet(
            Array.isArray(p.car_fleet)
              ? p.car_fleet
              : []
          );
        } else {
          setProfile((prev) => ({ ...prev, ...updated }));
        }
        setNewPhoto(null);
        setNewCertificate(null);
        setIsEditing(false);
        tSuccess(
          t("profile_updated") || "Профиль обновлён"
        );
      })
      .catch((err) => {
        console.error("Ошибка обновления профиля", err);
        tError(
          extractApiErrorText(err) ||
            t("update_error") ||
            "Ошибка обновления профиля"
        );
      });
  };

  const handleChangePassword = () => {
    if (!oldPassword) {
      tWarn(
        t("enter_current_password") ||
          "Введите текущий пароль"
      );
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      tWarn(
        t("password_too_short") ||
          "Минимум 6 символов"
      );
      return;
    }

    api
      .put(`/api/providers/password`, {
        oldPassword,
        newPassword,
      })
      .then(() => {
        setOldPassword("");
        setNewPassword("");
        tSuccess(
          t("password_changed") || "Пароль обновлён"
        );
        setPwdOpen(false);
      })
      .catch((err) => {
        console.error("Ошибка смены пароля", err);
        tError(
          extractApiErrorText(err) ||
            t("password_error") ||
            "Ошибка смены пароля"
        );
      });
  };

  // ---------- RENDER ----------

  const publicName = profile?.name || "Travella";
  const typeLabel = providerTypeLabel(profile?.type, t) || t("not_specified");
  const locationsText = normalizeLocationList(profile.location).join(", ");
  const heroPhoto = newPhoto || profile.photo || "https://placehold.co/160x160?text=Travella";
  const contactReady = Boolean(profile?.phone && (profile?.social || profile?.telegram_username || profile?.telegramUsername));

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5 px-3 sm:px-4 lg:px-0">
      <div id="anchor-profile-left" />

      {/* Product hero */}
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.10)]">
        <div className="relative bg-[radial-gradient(circle_at_18%_20%,rgba(255,115,22,0.28),transparent_32%),linear-gradient(135deg,#070b1d_0%,#111827_48%,#7c2d12_100%)] p-5 text-white sm:p-7">
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/15" />
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="relative shrink-0">
                <div id="anchor-logo" />
                <img
                  src={heroPhoto}
                  className="h-24 w-24 rounded-3xl border border-white/20 object-cover shadow-2xl ring-4 ring-white/10"
                  alt="Provider logo"
                />
                <span className="absolute -bottom-2 -right-2 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow-lg">
                  {t("profile.verified", { defaultValue: "Active" })}
                </span>
              </div>

              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-100 ring-1 ring-white/10">
                  Travella provider profile
                </div>
                <h1 className="mt-3 truncate text-3xl font-black tracking-[-0.04em] sm:text-4xl">
                  {publicName}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-white/80">
                  <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/10">{typeLabel}</span>
                  {locationsText ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/10">📍 {locationsText}</span>
                  ) : null}
                  {contactReady ? (
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-100 ring-1 ring-emerald-300/20">✅ Контакты заполнены</span>
                  ) : (
                    <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-100 ring-1 ring-amber-300/20">⚠️ Контакты нужно проверить</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-600"
                  >
                    💾 {t("save", { defaultValue: "Сохранить" })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setNewPhoto(null);
                      setNewCertificate(null);
                      setNewSocial(profile.social || "");
                      setNewPhone(profile.phone || "");
                      setNewAddress(profile.address || "");
                      setRegions(normalizeLocationList(profile.location).map((c) => ({ value: c, label: c })));
                      setCarFleet(Array.isArray(profile.car_fleet) ? profile.car_fleet : []);
                    }}
                    className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    {t("cancel", { defaultValue: "Отмена" })}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:bg-orange-50"
                >
                  ✏️ {t("edit", { defaultValue: "Редактировать" })}
                </button>
              )}
            </div>
          </div>
        </div>

        {isEditing && (
          <div className="border-b border-slate-100 bg-orange-50/70 px-5 py-3 text-sm font-semibold text-orange-900 sm:px-7">
            Режим редактирования включён. После изменений нажмите “Сохранить”.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-5">
          {/* Logo / contacts / map */}
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Основные контакты</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Эти данные помогают клиентам быстрее связаться с вами после открытия контактов.</p>
              </div>
            </div>

            {isEditing && (
              <div className="mb-5 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                <div className="text-sm font-black text-orange-900">Логотип / фото профиля</div>
                <label className="mt-3 inline-flex cursor-pointer items-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600">
                  {t("choose_files", { defaultValue: "Выбрать файл" })}
                  <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                </label>
                <div className="mt-2 text-xs font-semibold text-orange-800/80">
                  {newPhoto ? t("file_chosen") : t("no_files_selected")}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ProfileInfoBox label={t("phone", { defaultValue: "Телефон" })} icon="📞">
                {isEditing ? (
                  <input type="tel" placeholder={t("phone")} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />
                ) : (
                  <span>{profile.phone || t("not_specified")}</span>
                )}
              </ProfileInfoBox>

              <ProfileInfoBox label={t("email", { defaultValue: "Email" })} icon="✉️">
                <span>{profile.email || t("not_specified")}</span>
              </ProfileInfoBox>
            </div>

            <div className="mt-4">
              <ProfileInfoBox label={t("address", { defaultValue: "Адрес" })} icon="📍">
                {isEditing ? (
                  <input type="text" placeholder={t("address")} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />
                ) : (
                  <span>{profile.address || t("not_specified")}</span>
                )}
              </ProfileInfoBox>
            </div>

            {profile.address && !isEditing && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <iframe
                  title="provider-map"
                  width="100%"
                  height="230"
                  frameBorder="0"
                  scrolling="no"
                  marginHeight="0"
                  marginWidth="0"
                  className="block"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(profile.address)}&output=embed`}
                />
              </div>
            )}
          </section>

          {/* Business info */}
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Данные поставщика</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ProfileInfoBox label={t("name", { defaultValue: "Наименование" })} icon="🏢">
                <span>{profile.name || t("not_specified")}</span>
              </ProfileInfoBox>
              <ProfileInfoBox label={t("type", { defaultValue: "Тип поставщика" })} icon="🧭">
                <span>{typeLabel || t("not_specified")}</span>
              </ProfileInfoBox>
            </div>

            <div className="mt-4">
              <ProfileInfoBox
                label={t("location", { defaultValue: "Регионы / города работы" })}
                icon="🌍"
                hint={t("location_hint", { defaultValue: "вводите название города только на английском" })}
              >
                {isEditing ? (
                  <AsyncCreatableSelect
                    isMulti
                    cacheOptions
                    defaultOptions
                    {...ASYNC_MENU_PORTAL}
                    loadOptions={loadCities}
                    noOptionsMessage={ASYNC_I18N.noOptionsMessage}
                    loadingMessage={ASYNC_I18N.loadingMessage}
                    placeholder={t("profile.regions_placeholder", { defaultValue: "Start typing city name (EN)…" })}
                    value={regions}
                    onChange={(vals) => setRegions(vals || [])}
                  />
                ) : (
                  <span>{locationsText || t("not_specified")}</span>
                )}
              </ProfileInfoBox>
            </div>

            <div className="mt-4">
              <div id="anchor-telegram" />
              <ProfileInfoBox label={t("social", { defaultValue: "Telegram / соцсети" })} icon="💬">
                {isEditing ? (
                  <input value={newSocial} onChange={(e) => setNewSocial(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="@username или ссылка" />
                ) : (
                  <span>{profile.social || profile.telegram_username || t("not_specified")}</span>
                )}
              </ProfileInfoBox>

              {!isTgLinked && tgDeepLink && (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
                  <div className="font-black">{t("tg.title", { defaultValue: "Уведомления в Telegram" })}</div>
                  <p className="mt-1 font-medium text-blue-900/80">{t("tg.subtitle", { defaultValue: "Свяжите Telegram и получайте уведомления о заявках, открытиях контактов и бронированиях." })}</p>
                  <a href={tgDeepLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-700">
                    {t("tg.connect", { defaultValue: "Подключить Telegram" })}
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Car fleet */}
          {(profile.type === "guide" || profile.type === "transport") && (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div id="anchor-transport" />
              <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">{t("car_fleet") || "Автопарк"}</h2>

              {isEditing ? (
                <div className="mt-5 space-y-3">
                  {carFleet.map((car, idx) => (
                    <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="Модель" value={car.model} onChange={(e) => updateCar(idx, { model: e.target.value })} />
                        <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" type="number" min={1} placeholder="Мест" value={car.seats} onChange={(e) => updateCar(idx, { seats: e.target.value })} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="cursor-pointer rounded-xl bg-orange-500 px-3 py-2 text-sm font-black text-white transition hover:bg-orange-600">
                          {t("choose_files", { defaultValue: "Выбрать файлы" })}
                          <input type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
                            const files = Array.from(e.target.files || []);
                            const out = [];
                            for (const f of files.slice(0, 10)) {
                              try { out.push(await resizeImageFile(f, 1200, 800, 0.85, "image/jpeg")); } catch {}
                            }
                            updateCarImage(idx, [...(car.images || []), ...out].slice(0, 10));
                            e.target.value = "";
                          }} />
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <input type="checkbox" checked={car.is_active !== false} onChange={(e) => updateCar(idx, { is_active: e.target.checked })} />
                          <span>{t("is_active")}</span>
                        </label>
                        <button type="button" onClick={() => removeCar(idx)} className="ml-auto text-sm font-black text-red-600">{t("delete")}</button>
                      </div>
                      {car.images?.length ? (
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {car.images.map((src, i) => (
                            <img key={i} src={src} alt="" className="h-16 w-full rounded-xl object-cover" />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <button type="button" onClick={addCar} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-700 hover:bg-orange-100">
                    + {t("add") || "Добавить авто"}
                  </button>
                </div>
              ) : (
                <div className="mt-5 grid gap-3">
                  {(Array.isArray(profile.car_fleet) ? profile.car_fleet : []).map((c, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {c.images?.[0] ? <img src={c.images[0]} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-xl">🚗</div>}
                      <div className="min-w-0">
                        <div className="font-black text-slate-950">{c.model}</div>
                        <div className="text-sm font-semibold text-slate-500">{c.seats} мест</div>
                      </div>
                    </div>
                  ))}
                  {!profile?.car_fleet?.length && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm font-semibold text-slate-400">{t("not_specified")}</div>}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <ProviderCompleteness profile={profile} onFix={scrollToProfilePart} />

          {/* Languages */}
          {['guide', 'transport', 'agent'].includes(profile.type) && (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div id="anchor-languages" />
              <ProviderLanguages ref={langRef} token={token} editing={isEditing} />
            </section>
          )}

          {/* Certificate */}
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div id="anchor-certificate" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">{t("certificate", { defaultValue: "Сертификат" })}</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Документы повышают доверие к профилю и услугам.</p>
              </div>
              <span className={certObjectUrl ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100" : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100"}>
                {certObjectUrl ? "Загружен" : "Нужен"}
              </span>
            </div>

            {isEditing ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                <label className="inline-flex cursor-pointer rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600">
                  {t("choose_files", { defaultValue: "Выбрать файл" })}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleCertificateChange} className="hidden" />
                </label>
                <div className="mt-3 text-sm font-semibold text-slate-500">{newCertificate ? `📄 ${t("file_chosen")}` : t("no_files_selected")}</div>
                {newCertificate?.startsWith("data:image") ? <img src={newCertificate} alt="Certificate preview" className="mt-3 h-32 w-32 rounded-2xl border object-cover" /> : null}
              </div>
            ) : certObjectUrl ? (
              <a href={certObjectUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800">
                {t("view_certificate", { defaultValue: "Посмотреть сертификат" })}
              </a>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm font-semibold text-slate-400">{t("not_specified")}</div>
            )}
          </section>

          {/* Security */}
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <button type="button" onClick={() => setPwdOpen((v) => !v)} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left font-black text-slate-950 transition hover:bg-slate-100" aria-expanded={pwdOpen} aria-controls="pwd-collapse">
              <span>🔐 {t("change_password", { defaultValue: "Сменить пароль" })}</span>
              <svg className={`h-5 w-5 transition-transform ${pwdOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
            </button>
            <div id="pwd-collapse" className={`grid overflow-hidden transition-all duration-300 ease-in-out ${pwdOpen ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="min-h-0 space-y-2">
                <input type="password" placeholder={t("current_password") || "Текущий пароль"} value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />
                <input type="password" placeholder={t("new_password")} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />
                <button onClick={handleChangePassword} className="w-full rounded-xl bg-orange-500 py-2.5 font-black text-white transition hover:bg-orange-600">{t("change")}</button>
              </div>
            </div>
            <button onClick={() => {
              if (typeof localStorage !== "undefined") {
                localStorage.removeItem("token");
                localStorage.removeItem("provider_id");
              }
              window.location.href = "/login";
            }} className="mt-3 w-full rounded-2xl bg-red-600 px-4 py-3 font-black text-white transition hover:bg-red-700">
              {t("logout", { defaultValue: "Выйти" })}
            </button>
          </section>
        </aside>
      </div>

      {/* Статистика */}
      <div className="mt-6">
        <ProviderStatsHeader
          rating={Number(profile?.rating) || 0}
          stats={{
            requests_total: Number(stats?.requests_total) || 0,
            requests_active: Number(stats?.requests_active) || 0,
            bookings_total: Number(stats?.bookings_total) || 0,
            completed: Number(stats?.completed) || 0,
            cancelled: Number(stats?.cancelled) || 0,
            points: Number(stats?.points ?? stats?.completed ?? 0),
          }}
          bonusTarget={500}
          t={t}
        />
      </div>

      {/* Отзывы */}
      <div className="mt-6">
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="min-w-0 max-w-full overflow-hidden break-words [text-wrap:pretty] [&_*]:min-w-0 [&_*]:break-words [&_time]:whitespace-nowrap [&_.review-date]:whitespace-nowrap [&_.rv-date]:whitespace-nowrap">
            {hasProviderId ? <ProviderReviews providerId={providerId} t={t} /> : null}
          </div>
        </div>
      </div>
    </div>
  );

  function ProfileInfoBox({ label, icon, hint, children }) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
            <span>{icon}</span>
            <span>{label}</span>
          </div>
        </div>
        {hint ? <div className="mb-2 text-xs font-medium text-slate-400">{hint}</div> : null}
        <div className="text-sm font-bold leading-6 text-slate-800">{children}</div>
      </div>
    );
  }

};

export default ProviderProfile;
