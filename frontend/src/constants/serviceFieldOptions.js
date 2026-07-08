// frontend/src/constants/serviceFieldOptions.js
// Зеркало backend/utils/serviceFieldOptions.js для синхронного UI web/bot.
// Если меняете варианты в одном месте, синхронно обновите второе.

export const SERVICE_FIELD_OPTIONS = Object.freeze({

  destinationCountry: Object.freeze([
    'Турция',
    'ОАЭ',
    'Вьетнам',
    'Таиланд',
    'Египет',
    'Мальдивы',
    'Узбекистан',
  ]),
  departureCity: Object.freeze([
    'Ташкент',
    'Самарканд',
    'Бухара',
    'Ургенч',
    'Наманган',
    'Фергана',
  ]),
  accommodation: Object.freeze([
    { code: 'SGL', label: 'одноместное' },
    { code: 'DBL', label: 'двухместное' },
    { code: 'TRPL', label: 'трёхместное' },
    { code: 'QDRPL', label: 'четырёхместное' },
  ]),
  meal: Object.freeze([
    { code: 'RO', label: 'без питания' },
    { code: 'BB', label: 'завтраки' },
    { code: 'HB', label: 'завтрак + ужин' },
    { code: 'FB', label: 'полный пансион' },
    { code: 'AI', label: 'всё включено' },
    { code: 'UAI', label: 'ультра всё включено' },
  ]),
  roomCategory: Object.freeze(['Standard', 'Superior', 'Deluxe', 'Family Room', 'Suite', 'Villa']),
  hotelTransfer: Object.freeze([
    { code: 'individual', label: 'Индивидуальный' },
    { code: 'group', label: 'Групповой' },
    { code: 'none', label: 'Отсутствует' },
  ]),
  airline: Object.freeze([
    { code: 'HY', label: 'Uzbekistan Airways' },
    { code: 'HH', label: 'Qanot Sharq' },
    { code: 'C6', label: 'Centrum Air' },
    { code: 'TK', label: 'Turkish Airlines' },
    { code: 'FZ', label: 'Flydubai' },
    { code: 'G9', label: 'Air Arabia' },
    { code: 'LO', label: 'LOT' },
    { code: 'KC', label: 'Air Astana' },
  ]),
});
