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

        const loc = Array.isArray(p.location)
          ? p.location
          : p.location
          ? [p.location]
          : [];
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

  return (
    <div className="w-full max-w-6xl mx-auto bg-white p-6 rounded-xl shadow-md flex flex-col min-w-0">
      <div id="anchor-profile-left" />

      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        {/* Левая колонка: фото, телефон, адрес, карта, пароль, logout */}
        <div className="flex flex-col items-center w-full md:w-1/2 h-full">
          {/* Фото */}
          <div className="relative flex flex-col items-center">
            <div id="anchor-logo" />
            <img
              src={
                newPhoto ||
                profile.photo ||
                "https://placehold.co/96x96"
              }
              className="w-24 h-24 rounded-full object-cover mb-2"
              alt="Фото"
            />
            {isEditing && (
              <>
                <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm">
                  {t("choose_files", {
                    defaultValue: "Выбрать файлы",
                  })}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </label>
                <div className="text-sm text-gray-600 mt-1">
                  {newPhoto
                    ? t("file_chosen")
                    : t("no_files_selected")}
                </div>
              </>
            )}
          </div>

          {/* Телефон */}
          <h3 className="font-semibold text-lg mt-6 mb-2">
            {t("phone")}
          </h3>
          {isEditing ? (
            <input
              type="tel"
              placeholder={t("phone")}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="border px-3 py-2 mb-2 rounded w-full"
            />
          ) : (
            <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
              {profile.phone || t("not_specified")}
            </div>
          )}

          {/* Email (только просмотр) */}
          <h3 className="font-semibold text-lg mb-2">
            {t("email", { defaultValue: "Email" })}
          </h3>
          <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
            {profile.email || t("not_specified")}
          </div>

          {/* Адрес */}
          <h3 className="font-semibold text-lg mb-2">
            {t("address")}
          </h3>
          {isEditing ? (
            <input
              type="text"
              placeholder={t("address")}
              value={newAddress}
              onChange={(e) =>
                setNewAddress(e.target.value)
              }
              className="border px-3 py-2 mb-2 rounded w-full"
            />
          ) : (
            <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
              {profile.address || t("not_specified")}
            </div>
          )}

          {/* Карта */}
          {profile.address && !isEditing && (
            <div className="w-full mb-4">
              <iframe
                title="provider-map"
                width="100%"
                height="200"
                frameBorder="0"
                scrolling="no"
                marginHeight="0"
                marginWidth="0"
                className="rounded"
                src={`https://www.google.com/maps?q=${encodeURIComponent(
                  profile.address
                )}&output=embed`}
              />
            </div>
          )}

          {/* Смена пароля */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPwdOpen((v) => !v)}
              className="w-full flex items-center justify-between rounded-lg border px-4 py-2 font-semibold hover:bg-gray-50"
              aria-expanded={pwdOpen}
              aria-controls="pwd-collapse"
            >
              <span>{t("change_password")}</span>
              <svg
                className={`h-5 w-5 transition-transform ${
                  pwdOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <div
              id="pwd-collapse"
              className={`grid transition-all duration-300 ease-in-out overflow-hidden ${
                pwdOpen
                  ? "grid-rows-[1fr] mt-3"
                  : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0">
                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder={
                      t("current_password") ||
                      "Текущий пароль"
                    }
                    value={oldPassword}
                    onChange={(e) =>
                      setOldPassword(e.target.value)
                    }
                    className="w-full border px-3 py-2 rounded"
                  />
                  <input
                    type="password"
                    placeholder={t("new_password")}
                    value={newPassword}
                    onChange={(e) =>
                      setNewPassword(e.target.value)
                    }
                    className="w-full border px-3 py-2 rounded"
                  />
                  <button
                    onClick={handleChangePassword}
                    className="w-full bg-orange-500 text-white py-2 rounded font-bold"
                  >
                    {t("change")}
                  </button>
                </div>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={() => {
                if (typeof localStorage !== "undefined") {
                  localStorage.removeItem("token");
                  localStorage.removeItem("provider_id");
                }
                window.location.href = "/login";
              }}
              className="mt-3 w-full bg-red-600 text-white px-4 py-2 rounded font-semibold"
            >
              {t("logout")}
            </button>
          </div>
        </div>

        {/* Правая колонка: общие данные, регионы, автопарк, соцсети, языки, сертификат */}
        <div className="w-full md:w-1/2 space-y-3 min-w-0">
          <div>
            <label className="block font-medium">
              {t("name")}
            </label>
            <div className="border px-3 py-2 rounded bg-gray-100">
              {profile.name}
            </div>
          </div>

          <div>
            <label className="block font-medium">
              {t("type")}
            </label>
            <div className="border px-3 py-2 rounded bg-gray-100">
              {t(profile.type)}
            </div>
          </div>

          <div>
            <label className="block font-medium">
              {t("location")}{" "}
              <span className="text-xs text-gray-500">
                {t("location_hint", {
                  defaultValue: (i18n?.language || "").startsWith(
                    "ru"
                  )
                    ? "(вводите название города только на английском)"
                    : (i18n?.language || "").startsWith("uz")
                    ? "(shahar nomini faqat ingliz tilida kiriting)"
                    : "(enter the city name in English only)",
                })}
              </span>
            </label>
            {isEditing ? (
              <AsyncCreatableSelect
                isMulti
                cacheOptions
                defaultOptions
                {...ASYNC_MENU_PORTAL}
                loadOptions={loadCities}
                noOptionsMessage={ASYNC_I18N.noOptionsMessage}
                loadingMessage={ASYNC_I18N.loadingMessage}
                placeholder={t(
                  "profile.regions_placeholder",
                  {
                    defaultValue:
                      "Start typing city name (EN)…",
                  }
                )}
                value={regions}
                onChange={(vals) =>
                  setRegions(vals || [])
                }
              />
            ) : (
              <div className="border px-3 py-2 rounded bg-gray-100">
                {Array.isArray(profile.location)
                  ? profile.location.join(", ")
                  : profile.location ||
                    t("not_specified")}
              </div>
            )}
          </div>

          {(profile.type === "guide" ||
            profile.type === "transport") && (
            <div className="mt-3">
              <div id="anchor-transport" />
              <label className="block font-medium mb-2">
                {t("car_fleet") || "Автопарк"}
              </label>

              {isEditing ? (
                <>
                  <div className="space-y-3">
                    {carFleet.map((car, idx) => (
                      <div
                        key={idx}
                        className="border rounded p-3"
                      >
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            className="border rounded px-3 py-2"
                            placeholder="Модель (например, Chevrolet Lacetti)"
                            value={car.model}
                            onChange={(e) =>
                              updateCar(idx, {
                                model: e.target.value,
                              })
                            }
                          />
                          <input
                            className="border rounded px-3 py-2"
                            type="number"
                            min={1}
                            placeholder="Вместимость, мест"
                            value={car.seats}
                            onChange={(e) =>
                              updateCar(idx, {
                                seats: e.target.value,
                              })
                            }
                          />
                        </div>

                        <div className="mt-2 flex items-center gap-3">
                          <label className="inline-block bg-orange-500 text-white px-3 py-1.5 rounded cursor-pointer text-sm">
                            {t("choose_files", {
                              defaultValue: "Выбрать файлы",
                            })}
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={async (e) => {
                                const files = Array.from(
                                  e.target.files || []
                                );
                                const out = [];
                                for (const f of files.slice(
                                  0,
                                  10
                                )) {
                                  try {
                                    out.push(
                                      await resizeImageFile(
                                        f,
                                        1200,
                                        800,
                                        0.85,
                                        "image/jpeg"
                                      )
                                    );
                                  } catch {
                                    /* ignore */
                                  }
                                }
                                updateCarImage(
                                  idx,
                                  [
                                    ...(car.images || []),
                                    ...out,
                                  ].slice(0, 10)
                                );
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={
                                car.is_active !== false
                              }
                              onChange={(e) =>
                                updateCar(idx, {
                                  is_active:
                                    e.target.checked,
                                })
                              }
                            />
                            <span>{t("is_active")}</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              removeCar(idx)
                            }
                            className="ml-auto text-red-600 text-sm"
                          >
                            {t("delete")}
                          </button>
                        </div>

                        {car.images?.length ? (
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            {car.images.map(
                              (src, i) => (
                                <div
                                  key={i}
                                  className="relative"
                                >
                                  <img
                                    src={src}
                                    alt=""
                                    className="w-full h-20 object-cover rounded border"
                                  />
                                </div>
                              )
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addCar}
                    className="mt-2 rounded border px-3 py-1.5 text-sm"
                  >
                    + {t("add") || "Добавить авто"}
                  </button>
                </>
              ) : (
                <div className="space-y-2">
                  {(Array.isArray(profile.car_fleet)
                    ? profile.car_fleet
                    : []
                  ).map((c, i) => (
                    <div
                      key={i}
                      className="border rounded p-2 flex items-center gap-3"
                    >
                      <div className="font-medium">
                        {c.model}
                      </div>
                      <div className="text-sm text-gray-600">
                        • {c.seats} мест
                      </div>
                      {c.images?.[0] ? (
                        <img
                          src={c.images[0]}
                          alt=""
                          className="ml-auto w-12 h-12 object-cover rounded"
                        />
                      ) : null}
                    </div>
                  ))}
                  {!profile?.car_fleet?.length && (
                    <div className="text-gray-500">
                      {t("not_specified")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Соцсети + Telegram-линк */}
          <div>
            <label className="block font-medium">
              {t("social")}
            </label>
            {isEditing ? (
              <input
                value={newSocial}
                onChange={(e) =>
                  setNewSocial(e.target.value)
                }
                className="w-full border px-3 py-2 rounded"
              />
            ) : (
              <div className="border px-3 py-2 rounded bg-gray-100">
                {profile.social || t("not_specified")}
              </div>
            )}

            <div id="anchor-telegram" />
            {!isTgLinked && tgDeepLink && (
              <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-200">
                <div className="font-medium mb-1">
                  {t("tg.title", {
                    defaultValue: (i18n?.language || "").startsWith(
                      "uz"
                    )
                      ? "Telegram orqali bildirishnomalar"
                      : (i18n?.language || "").startsWith(
                          "en"
                        )
                      ? "Notifications in Telegram"
                      : "Уведомления в Telegram",
                  })}
                </div>
                <div className="mb-2">
                  {t("tg.subtitle", {
                    defaultValue: (i18n?.language || "").startsWith(
                      "uz"
                    )
                      ? "Telegram’ni bog‘lab, so‘rovlar va bronlar haqida xabarnomalarni oling."
                      : (i18n?.language || "").startsWith(
                          "en"
                        )
                      ? "Link your Telegram to receive notifications about requests and bookings."
                      : "Нажмите, чтобы связать Telegram и получать уведомления о заявках и бронированиях.",
                  })}
                </div>
                <a
                  href={tgDeepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
                >
                  {t("tg.connect", {
                    defaultValue: (i18n?.language || "").startsWith(
                      "uz"
                    )
                      ? "Telegram’ni ulash"
                      : (i18n?.language || "").startsWith(
                          "en"
                        )
                      ? "Connect Telegram"
                      : "Подключить Telegram",
                  })}
                </a>
              </div>
            )}
          </div>

          {/* Языки */}
          {["guide", "transport", "agent"].includes(
            profile.type
          ) && (
            <div className="mt-4">
              <div id="anchor-languages" />
              <ProviderLanguages
                ref={langRef}
                token={token}
                editing={isEditing}
              />
            </div>
          )}

          {/* Сертификат */}
          <div>
            <div id="anchor-certificate" />
            <label className="block font-medium">
              {t("certificate")}
            </label>

            {isEditing ? (
              <div className="flex flex-col gap-2">
                <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm w-fit">
                  {t("choose_files", {
                    defaultValue: "Выбрать файлы",
                  })}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleCertificateChange}
                    className="hidden"
                  />
                </label>
                {newCertificate ? (
                  newCertificate.startsWith("data:image") ? (
                    <img
                      src={newCertificate}
                      alt="Certificate preview"
                      className="w-32 h-32 object-cover border rounded"
                    />
                  ) : (
                    <div className="text-sm text-gray-600">
                      📄 {t("file_chosen")}
                    </div>
                  )
                ) : (
                  <div className="text-sm text-gray-600">
                    {t("no_files_selected")}
                  </div>
                )}
              </div>
            ) : certObjectUrl ? (
              <div className="flex items-center gap-4">
                <a
                  href={certObjectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  {t("view_certificate")}
                </a>
              </div>
            ) : (
              <div className="text-gray-500">
                {t("not_specified")}
              </div>
            )}
          </div>

          {/* Кнопка сохранить/редактировать */}
          <button
            onClick={
              isEditing
                ? handleSaveProfile
                : () => setIsEditing(true)
            }
            className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
          >
            {isEditing ? t("save") : t("edit")}
          </button>

          <ProviderCompleteness
            profile={profile}
            onFix={scrollToProfilePart}
          />
        </div>
      </div>

      {/* Статистика */}
      <div className="px-6 mt-6">
        <ProviderStatsHeader
          rating={Number(profile?.rating) || 0}
          stats={{
            requests_total:
              Number(stats?.requests_total) || 0,
            requests_active:
              Number(stats?.requests_active) || 0,
            bookings_total:
              Number(stats?.bookings_total) || 0,
            completed:
              Number(stats?.completed) || 0,
            cancelled:
              Number(stats?.cancelled) || 0,
            points:
              Number(
                stats?.points ?? stats?.completed ?? 0
              ),
          }}
          bonusTarget={500}
          t={t}
        />
      </div>

      {/* Отзывы */}
      <div className="px-6 mt-6">
        <div className="rounded-xl border bg-white p-4 sm:p-6">
          <div
            className="
              min-w-0 max-w-full overflow-hidden
              break-words [text-wrap:pretty]
              [&_*]:min-w-0 [&_*]:break-words
              [&_time]:whitespace-nowrap [&_.review-date]:whitespace-nowrap [&_.rv-date]:whitespace-nowrap
            "
          >
            {hasProviderId ? (
              <ProviderReviews providerId={providerId} t={t} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderProfile;
