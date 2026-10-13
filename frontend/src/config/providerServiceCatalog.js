export const GUIDE_SERVICE_GROUPS = [
  {
    id: "guide_tours",
    label: "Экскурсии",
    services: [
      { id: "city_tour_guide", label: "Обзорная экскурсия по городу" },
      { id: "thematic_tour_guide", label: "Тематическая экскурсия" },
      { id: "attraction_tour_guide", label: "Экскурсия по достопримечательности" },
      { id: "countryside_tour_guide", label: "Загородная экскурсия" },
      { id: "mountain_tour_guide", label: "Горный тур" },
      { id: "desert_tour_guide", label: "Пустынный тур" },
      { id: "safari_tour_guide", label: "Сафари-тур" },
    ],
  },
  {
    id: "guide_support",
    label: "Сопровождение",
    services: [
      { id: "group_escort", label: "Сопровождение группы" },
      { id: "meet", label: "Встреча гостей" },
      { id: "seeoff", label: "Проводы гостей" },
      { id: "translation", label: "Услуги переводчика" },
      { id: "event_coordinator", label: "Координатор мероприятия" },
      { id: "shopping_assistance", label: "Шопинг-сопровождение" },
    ],
  },
];

export const TRANSPORT_SERVICE_GROUPS = [
  {
    id: "hotel_transfers",
    label: "Трансферы аэропорт, вокзал и отель",
    services: [
      { id: "airport_to_hotel_transfer", label: "Аэропорт → отель" },
      { id: "hotel_to_airport_transfer", label: "Отель → аэропорт" },
      { id: "station_to_hotel_transfer", label: "Вокзал → отель" },
      { id: "hotel_to_station_transfer", label: "Отель → вокзал" },
      { id: "hotel_transfer", label: "Отельный трансфер (общее направление)" },
    ],
  },
  {
    id: "tour_transport",
    label: "Транспорт для экскурсий",
    services: [
      { id: "city_tour_transport", label: "Транспорт для сити-тура" },
      { id: "countryside_tour_transport", label: "Транспорт для загородного тура" },
      { id: "mountain_tour_transport", label: "Транспорт для горного маршрута" },
      { id: "desert_tour_transport", label: "Транспорт для пустынного тура" },
      { id: "safari_tour_transport", label: "Транспорт для сафари" },
    ],
  },
  {
    id: "route_transfers",
    label: "Междугородние и маршрутные трансферы",
    services: [
      { id: "intercity_transfer", label: "Междугородний трансфер" },
      { id: "border_transfer", label: "Пограничный трансфер" },
      { id: "one_way_transfer", label: "Трансфер в одну сторону" },
    ],
  },
  {
    id: "vehicle_hire",
    label: "Автомобиль с водителем",
    services: [
      { id: "hourly_driver", label: "Почасовая аренда с водителем" },
      { id: "half_day_driver", label: "Автомобиль на полдня" },
      { id: "full_day_driver", label: "Автомобиль на полный день" },
      { id: "vip_transfer", label: "VIP-трансфер" },
      { id: "group_bus", label: "Групповой автобус" },
    ],
  },
  {
    id: "transport_extras",
    label: "Дополнительные транспортные услуги",
    services: [
      { id: "dinner_transfer", label: "Трансфер в ресторан и обратно" },
      { id: "meet_with_sign", label: "Встреча с табличкой" },
      { id: "extra_waiting", label: "Дополнительное ожидание" },
    ],
  },
];

export const GUIDE_CATEGORY_IDS = GUIDE_SERVICE_GROUPS.flatMap((group) => group.services.map((service) => service.id));
export const TRANSPORT_CATEGORY_IDS = TRANSPORT_SERVICE_GROUPS.flatMap((group) => group.services.map((service) => service.id));
export const PROVIDER_SERVICE_LABELS = Object.fromEntries(
  [...GUIDE_SERVICE_GROUPS, ...TRANSPORT_SERVICE_GROUPS]
    .flatMap((group) => group.services)
    .map((service) => [service.id, service.label])
);

export const TOUR_BUILDER_TYPES = [
  { id: "city", label: "Обзорный", guideCategories: ["city_tour_guide"], transportCategories: ["city_tour_transport"] },
  { id: "thematic", label: "Тематический", guideCategories: ["thematic_tour_guide"], transportCategories: ["city_tour_transport"] },
  { id: "attraction", label: "По объекту", guideCategories: ["attraction_tour_guide"], transportCategories: ["city_tour_transport"] },
  { id: "countryside", label: "Загородный", guideCategories: ["countryside_tour_guide"], transportCategories: ["countryside_tour_transport"] },
  { id: "mountain", label: "Горный", guideCategories: ["mountain_tour_guide"], transportCategories: ["mountain_tour_transport"] },
  { id: "desert", label: "Пустынный", guideCategories: ["desert_tour_guide"], transportCategories: ["desert_tour_transport"] },
  { id: "safari", label: "Сафари", guideCategories: ["safari_tour_guide"], transportCategories: ["safari_tour_transport"] },
  { id: "shopping", label: "Шопинг", guideCategories: ["shopping_assistance"], transportCategories: ["city_tour_transport"] },
  { id: "support_escort", label: "Сопровождение группы", guideCategories: ["group_escort"], transportCategories: [], guideOnly: true },
  { id: "support_meet", label: "Встреча гостей", guideCategories: ["meet"], transportCategories: [], guideOnly: true },
  { id: "support_seeoff", label: "Проводы гостей", guideCategories: ["seeoff"], transportCategories: [], guideOnly: true },
  { id: "support_translation", label: "Переводчик", guideCategories: ["translation"], transportCategories: [], guideOnly: true },
  { id: "support_coordinator", label: "Координатор", guideCategories: ["event_coordinator"], transportCategories: [], guideOnly: true },
];

export const GUIDE_SUPPORT_BUILDER_TYPES = [
  { id: "escort", label: "Сопровождение группы", guideCategories: ["group_escort"] },
  { id: "meet", label: "Встреча гостей", guideCategories: ["meet"] },
  { id: "seeoff", label: "Проводы гостей", guideCategories: ["seeoff"] },
  { id: "translation", label: "Переводчик", guideCategories: ["translation"] },
  { id: "coordinator", label: "Координатор", guideCategories: ["event_coordinator"] },
];

export const TRANSPORT_BUILDER_TYPES = [
  { id: "international", label: "Авиабилеты", categories: [] },
  { id: "hotel", label: "Отельный трансфер", categories: ["airport_to_hotel_transfer", "hotel_to_airport_transfer", "station_to_hotel_transfer", "hotel_to_station_transfer", "hotel_transfer"] },
  { id: "intercity", label: "Междугородний", categories: ["intercity_transfer", "border_transfer", "one_way_transfer"] },
];

export const findServiceGroup = (category, groups) =>
  groups.find((group) => group.services.some((service) => service.id === category)) || null;
