// Типы упрощённые под текущий API
export type ProviderService = {
  id: number;
  category: string;
  title?: string | null;
  price?: number | null;      // цена за услугу (для транспорта — за машину)
  currency?: string | null;
  is_active?: boolean;
  details?: {
    seats?: number;
    city_slug?: string;
    [k: string]: any;
  };
};

type PickOpts = {
  citySlug: string;       // выбранный город пользователем (slug)
  pax: number;            // кол-во пассажиров
  categories: string[];   // приорит. список категорий, напр. ["city_tour_transport"] либо ["city_tour_guide"]
};

// жёстко считаем, что транспортная категория — цена за машину.
// если нужно «за человека», поменяй расчёт ниже.
const TRANSPORT_CATEGORIES = new Set([
  "city_tour_transport",
  "mountain_tour_transport",
  "one_way_transfer",
  "dinner_transfer",
  "border_transfer",
]);

export function pickProviderService(
  services: ProviderService[],
  { citySlug, pax, categories }: PickOpts
) {
  const base = (services || [])
    .filter((s) => s?.is_active !== false)
    .filter((s) => categories.includes(s.category))
    .filter((s) => (citySlug ? s?.details?.city_slug === citySlug : true));

  if (!base.length) return null;

  const isTransport = (svc: ProviderService) => TRANSPORT_CATEGORIES.has(svc.category);

  // ТРАНСПОРТ: выбираем машину с seats >= pax, иначе с максимальными seats
  const transport = base.filter(isTransport);
  if (transport.length) {
    const enough = transport
      .filter((s) => (s.details?.seats ?? 0) >= pax)
      .sort((a, b) => (a.details?.seats ?? 0) - (b.details?.seats ?? 0));
    const fallback = transport.sort((a, b) => (b.details?.seats ?? 0) - (a.details?.seats ?? 0));
    const chosen = enough[0] || fallback[0] || transport[0];

    // цена за машину. если нужно умножать на кол-во машин = ceil(pax/seats) — раскомментируй:
    // const seats = chosen.details?.seats || pax;
    // const carsNeeded = Math.max(1, Math.ceil(pax / seats));
    // const totalPrice = (chosen.price || 0) * carsNeeded;

    return {
      ...chosen,
      computed: {
        // totalPrice,
        totalPrice: chosen.price || 0,
        currency: chosen.currency || "USD",
        seats: chosen.details?.seats ?? null,
      },
    };
  }

  // ГИД: берём первую подходящую по категории услугу (обычно цена за группу)
  const guide = base.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const chosen = guide[0];
  return chosen
    ? {
        ...chosen,
        computed: {
          totalPrice: chosen.price || 0,
          currency: chosen.currency || "USD",
          seats: null,
        },
      }
    : null;
}
