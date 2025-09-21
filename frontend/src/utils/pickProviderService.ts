// frontend/src/utils/pickProviderService.ts

export type ProviderService = {
  id: number;
  category: string;
  title?: string | null;
  price?: number | null;          // цена за день/услугу
  currency?: string | null;       // USD/UZS/EUR...
  is_active?: boolean;
  details?: Record<string, any> | null; // seats, city_slug, ...
};

export type PickOptions = {
  /** slug города (мы пишем его в details.city_slug при генерации из профиля) */
  citySlug?: string;
  /** пассажиров (для транспорта подберём минимальную подходящую вместимость) */
  pax?: number;
  /** допустимые категории в порядке приоритета подбора */
  categories?: string[];
  /** если true — разрешить неактивные услуги только если активных не нашлось */
  allowInactiveFallback?: boolean;
  /** если true — разрешить услуги без цены только если с ценой не нашлось */
  allowZeroPriceFallback?: boolean;
};

export type PickedService = ProviderService & {
  computed: {
    seats?: number;
    currency: string;
    unitPrice: number;  // как лежит в услуге
    totalPrice: number; // на данный момент = unitPrice (умножения не делаем)
    cityMatched: boolean;
    paxFits: boolean;
    pricePresent: boolean;
    active: boolean;
  };
};

/** Утилиты */
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const norm = (s?: string | null) => (s || "").trim().toLowerCase();

function cityMatch(s: ProviderService, citySlug?: string) {
  if (!citySlug) return true;
  const slug = norm(citySlug);
  const det = s.details || {};
  if (norm(det.city_slug) === slug) return true;

  // fallback: в названии (Samarkand, Bukhara, tashkent …)
  const t = norm(s.title);
  return !!(t && (t.includes(slug) || t.includes(slug.replace(/-/g, " "))));
}

function paxFitsTransport(s: ProviderService, pax?: number) {
  if (!pax || pax <= 0) return true; // нечего проверять
  const seats = toNum(s?.details?.seats);
  if (!Number.isFinite(seats)) return false;
  return pax <= seats;
}

/**
 * Сортировка-кандидатов.
 * Приоритет: активная > цена есть > по городу > по вместимости (минимальная подходящая) > дёшево > id
 */
function compareCandidates(a: ProviderService, b: ProviderService, opts: PickOptions) {
  const aActive = !!a.is_active;
  const bActive = !!b.is_active;
  if (aActive !== bActive) return aActive ? -1 : 1;

  const aHasPrice = Number.isFinite(toNum(a.price)) && toNum(a.price) > 0;
  const bHasPrice = Number.isFinite(toNum(b.price)) && toNum(b.price) > 0;
  if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;

  const aCity = cityMatch(a, opts.citySlug);
  const bCity = cityMatch(b, opts.citySlug);
  if (aCity !== bCity) return aCity ? -1 : 1;

  // Для транспорта: минимальная подходящая вместимость лучше
  const aSeats = toNum(a?.details?.seats);
  const bSeats = toNum(b?.details?.seats);
  const pax = opts.pax ?? 0;
  const aFits = pax > 0 ? pax <= aSeats : true;
  const bFits = pax > 0 ? pax <= bSeats : true;
  if (aFits !== bFits) return aFits ? -1 : 1;

  if (aFits && bFits && Number.isFinite(aSeats) && Number.isFinite(bSeats) && aSeats !== bSeats) {
    return aSeats - bSeats; // чем меньше, тем лучше (минимально подходящая)
  }

  const ap = Number.isFinite(toNum(a.price)) ? toNum(a.price) : Number.POSITIVE_INFINITY;
  const bp = Number.isFinite(toNum(b.price)) ? toNum(b.price) : Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;

  return (a.id || 0) - (b.id || 0);
}

/**
 * Главная функция подбора.
 * Возвращает лучшую услугу согласно каскаду или null.
 */
export function pickProviderService(
  services: ProviderService[],
  options: PickOptions = {}
): PickedService | null {
  const {
    categories = [],
    citySlug,
    pax,
    allowInactiveFallback = true,
    allowZeroPriceFallback = true,
  } = options;

  if (!Array.isArray(services) || services.length === 0) return null;

  // 1) фильтр по категориям, если заданы
  let pool = categories.length
    ? services.filter((s) => categories.includes(s.category))
    : [...services];

  if (!pool.length) return null;

  // 2) если есть pax и речь про транспорт — отсекаем те, у кого seats определён, но не помещаемся.
  const anyTransport = pool.some((s) => Number.isFinite(toNum(s?.details?.seats)));
  if (anyTransport && pax && pax > 0) {
    const withFit = pool.filter((s) => {
      const seats = toNum(s?.details?.seats);
      return !Number.isFinite(seats) || pax <= seats; // неизвестная вместимость — оставляем как “возможно подходит”
    });
    if (withFit.length) pool = withFit;
  }

  // 3) предпочтение активным и с ценой > 0, но с разумными fallback
  const active = pool.filter((s) => s.is_active !== false);
  const baseSet = active.length || !allowInactiveFallback ? active : pool;

  const priced = baseSet.filter((s) => Number.isFinite(toNum(s.price)) && toNum(s.price) > 0);
  const finalSet = priced.length || !allowZeroPriceFallback ? priced : baseSet;

  if (!finalSet.length) return null;

  // 4) сортировка по приоритетам (см. compareCandidates)
  const best = [...finalSet].sort((a, b) => compareCandidates(a, b, options))[0];

  if (!best) return null;

  const seats = toNum(best?.details?.seats);
  const unitPrice = Number.isFinite(toNum(best.price)) ? toNum(best.price) : 0;
  const currency = String(best.currency || "USD");
  const picked: PickedService = {
    ...best,
    computed: {
      seats: Number.isFinite(seats) ? seats : undefined,
      currency,
      unitPrice,
      totalPrice: unitPrice, // при необходимости умножите снаружи на дни/кол-во
      cityMatched: cityMatch(best, citySlug),
      paxFits: paxFitsTransport(best, pax),
      pricePresent: unitPrice > 0,
      active: best.is_active !== false,
    },
  };
  return picked;
}
