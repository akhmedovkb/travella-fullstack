const hasAny = (...values) =>
  values.some((value) =>
    Array.isArray(value) ? value.some(Boolean) : Boolean(String(value || "").trim())
  );

const normalizeLocations = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const raw = String(value || "").trim();
  if (!raw) return [];
  const pgArray = raw.match(/^\{(.+)\}$/);
  return pgArray
    ? pgArray[1].split(",").map((item) => item.replace(/^"|"$/g, "").trim()).filter(Boolean)
    : [raw];
};

const activeFleet = (profile) =>
  Array.isArray(profile?.car_fleet) &&
  profile.car_fleet.some(
    (car) =>
      car &&
      car.is_active !== false &&
      hasAny(car.model, car.seats, car.images)
  );

const roleProfileCheck = (profile, providerType) => {
  if (["guide", "agent", "tour_agent"].includes(providerType)) {
    return {
      key: "languages",
      label: "Владение языками",
      ok: hasAny(profile.languages, profile.langs, profile.languageSkills),
      fixKey: "languages",
    };
  }

  if (providerType === "transport") {
    return {
      key: "transport",
      label: "Автопарк",
      ok:
        activeFleet(profile) ||
        hasAny(
          profile.transport,
          profile.hasTransport,
          profile.transportAvailable,
          profile.transport_name,
          profile.cars,
          profile.fleet,
          profile.vehicleFleet
        ),
      fixKey: "transport",
    };
  }

  if (providerType === "hotel") {
    return {
      key: "details",
      label: "Данные отеля",
      ok: hasAny(profile.name) && hasAny(profile.address, profile.location),
      fixKey: "details",
    };
  }

  return {
    key: "details",
    label: "Данные профиля",
    ok: hasAny(profile.name),
    fixKey: "details",
  };
};

export function getProviderTrust(profile = {}, stats = {}) {
  const providerType = String(profile?.type || "").trim().toLowerCase();
  const telegramOk = hasAny(
    profile.telegram_username,
    profile.telegramUsername,
    profile.telegram_user,
    profile.telegram_connected,
    profile.telegramLinked,
    profile.telegram_chat_id,
    profile.tg_chat_id,
    profile.telegramChatId,
    profile.social
  );

  const checks = [
    {
      key: "contacts",
      label: "Контакты для клиентов",
      ok: hasAny(profile.phone) && telegramOk,
      weight: 20,
      fixKey: "contacts",
    },
    {
      key: "logo",
      label: "Логотип / фото",
      ok: hasAny(
        profile.logo,
        profile.logoUrl,
        profile.logo_url,
        profile.avatar,
        profile.photo,
        profile.photoUrl,
        profile.image,
        profile.imageUrl,
        profile.image_url
      ),
      weight: 15,
      fixKey: "logo",
    },
    {
      key: "certificate",
      label: "Сертификат",
      ok: hasAny(
        profile.certificate,
        profile.certificateUrl,
        profile.certificate_url,
        profile.certUrl
      ),
      weight: 20,
      fixKey: "certificate",
    },
    {
      key: "telegram",
      label: "Telegram",
      ok: telegramOk,
      weight: 15,
      fixKey: "telegram",
    },
    {
      key: "location",
      label: "География работы",
      ok: normalizeLocations(profile.location).length > 0,
      weight: 10,
      fixKey: "location",
    },
    { ...roleProfileCheck(profile, providerType), weight: 10 },
    {
      key: "activity",
      label: "Активность",
      ok: Number(stats?.requests_total || stats?.bookings_total || stats?.completed || 0) > 0,
      weight: 10,
      fixKey: "activity",
    },
  ];

  const score = checks.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0);
  return { score: Math.max(0, Math.min(100, score)), checks };
}
