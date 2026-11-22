const test=require('node:test'),assert=require('node:assert/strict');
const {formatFlightDetails}=require('../utils/bookingFlightDisplay');
test('flight legs have readable dates, separate times and known baggage only',()=>{
 const raw='HY · TAS · MLE · 2026-12-02 · 07:50 · 14:10\nHY · MLE · TAS · 2026-12-09 · 15:40 · 21:25 · Багаж 23 кг · Ручная кладь 8 кг';
 const text=formatFlightDetails(raw);assert.match(text,/TAS → MLE\n📅 Дата: 02.12.2026/);assert.match(text,/🛫 Вылет: 07:50\n🛬 Прилёт: 14:10/);assert.match(text,/\n\n✈️ MLE → TAS/);assert.match(text,/🧳 Багаж: 23 кг\n🎒 Ручная кладь: 8 кг/);assert.equal((text.match(/Багаж:/g)||[]).length,1);assert.doesNotMatch(text,/Туда|Обратно/);
});
test('ambiguous times, connecting legs and free text are not invented or dropped',()=>{
 assert.match(formatFlightDetails('HY · TAS · MLE · 2026-12-02 · 07:50'),/Время: 07:50 · вылет или прилёт — уточните/);
 assert.equal(formatFlightDetails('Уточнить рейс, багаж 23 кг'), 'Уточнить рейс, багаж 23 кг');
 const invalid='HY · TAS · MLE · 2026-02-31 · 07:50 · 14:10';assert.equal(formatFlightDetails(invalid),invalid);
 const raw=['HY · TAS · IST · 2026-12-02 · 07:50 · 10:10','TK · IST · MLE · 2026-12-02 · 14:00 · 23:10','HY · MLE · TAS · 2026-12-09 · 15:40 · 21:25'].join('\n');
 const text=formatFlightDetails(raw);assert.match(text,/TAS → IST/);assert.match(text,/IST → MLE/);assert.match(text,/MLE → TAS/);assert.doesNotMatch(text,/Обратно/);
});
