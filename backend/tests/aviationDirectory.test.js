const test=require('node:test'),assert=require('node:assert/strict');
const {buildDirectory}=require('../scripts/build-aviation-directory.cjs');
const {displayCity,displayAirport,displayAirline,displayBookingTitle}=require('../utils/aviationDirectory');
test('global directory expands multiple countries and both IATA and ICAO without altering free text',()=>{
 for(const [code,name]of Object.entries({TAS:'Ташкент',MLE:'Мале',PQC:'Фукуок',IST:'Стамбул',JFK:'Нью-Йорк',LON:'Лондон',DXB:'Дубай',BKK:'Бангкок',CDG:'Париж',SIN:'Сингапур'}))assert.equal(displayCity(code),name);
 assert.equal(displayAirline('HY'),'Uzbekistan Airways');assert.equal(displayAirline('SQ'),'Singapore Airlines');assert.equal(displayAirline('LH'),'Lufthansa');assert.equal(displayAirline('DLH'),'Lufthansa');assert.equal(displayCity('KJFK'),'Нью-Йорк');assert.ok(displayAirport('JFK')!=='JFK');
 assert.equal(displayCity('Ташкент'),'Ташкент');assert.equal(displayCity('QQQQ'),'QQQQ');assert.equal(displayAirline('HY123'),'HY123');assert.equal(displayAirline('<unknown>'),'<unknown>');assert.equal(displayCity('__proto__'),'__proto__');assert.equal(displayBookingTitle('Отказной тур — BKK'),'Отказной тур — Бангкок');assert.equal(displayBookingTitle('TEST BKK villa'),'TEST BKK villa');
});
test('import excludes expired and future codes and avoids guessing when two current companies share a code',()=>{
 const por='iata_code^icao_code^envelope_id^name^date_from^date_until^location_type^alt_name_section^city_code_list^city_name_list\nABC^KABC^^Example Airport^^^A^^ABC^Example\nABC^^^Example^^^C^ru|Пример|^^\nDEF^^^^^^C^ru|Неизвестный|^^';
 const air='2char_code^3char_code^env_id^name^validity_from^validity_to^type\nAA^AAA^^Expired^^2020-01-01^P\nAA^BBB^^Current^2021-01-01^^P\nBB^CCC^^One^^^P\nBB^DDD^^Two^^^P\nCC^EEE^^Future^2099-01-01^^P\nDD^FFF^^Cargo^^^C\nDD^GGG^^Passenger^^^P';
 const d=buildDirectory(por,air,{asOf:'2026-11-22',revision:'test'});assert.equal(d.cities.ABC,'Пример');assert.equal(d.citiesIcao.KABC,'Пример');assert.equal(d.airlines.AA,'Current');assert.equal(d.airlines.BB,undefined);assert.ok(d.ambiguous.airlines.includes('BB'));assert.equal(d.airlines.CC,undefined);assert.equal(d.airlines.DD,'Passenger');assert.equal(d.airlinesIcao.FFF,'Cargo');
});
