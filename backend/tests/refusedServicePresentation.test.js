const test = require("node:test");
const assert = require("node:assert/strict");

const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { getServiceUrgency } = require("../utils/serviceUrgency");
const { buildServiceMessage } = require("../utils/telegramServiceCard");

const fixedNow = new Date("2026-09-17T10:00:00+05:00");

test("refused service actuality covers active and inactive lifecycle states", () => {
  const future = { category: "refused_tour", status: "published" };
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, future), true);
  assert.equal(isServiceActual({ isActive: false, startDate: "2030-10-03" }, future), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2020-09-01" }, future), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, { ...future, status: "archived" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, { ...future, status: "deleted" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, { ...future, status: "inactive" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, { ...future, status: "expired" }), false);
  assert.equal(isServiceActual({ isActive: true, startDate: "2030-10-03" }, { ...future, status: "cancelled" }), false);
});

test("urgency scale covers every expiration band", () => {
  assert.equal(getServiceUrgency(null, fixedNow).code, "unknown");
  assert.equal(getServiceUrgency("2026-09-20T11:00:00+05:00", fixedNow).code, "normal");
  assert.equal(getServiceUrgency("2026-09-19T10:00:00+05:00", fixedNow).code, "medium");
  assert.equal(getServiceUrgency("2026-09-18T09:00:00+05:00", fixedNow).code, "high");
  assert.equal(getServiceUrgency("2026-09-17T15:00:00+05:00", fixedNow).code, "critical");
  assert.equal(getServiceUrgency("2026-09-17T09:00:00+05:00", fixedNow).code, "expired");
});

test("Telegram card respects explicit per-person price and inferred DBL audience", () => {
  const card = buildServiceMessage(
    {
      id: 1113,
      title: "ОТКАЗНОЙ ТУР В ШАРМ",
      category: "refused_tour",
      status: "published",
      details: {
        isActive: true,
        startDate: "2030-10-03",
        endDate: "2030-10-09",
        expiration: "2030-09-24T04:59:00+05:00",
        persons: "2",
        accommodation: "DBL",
        grossPrice: "2500",
        priceFor: "за 1 человека",
        pricePerPerson: "1 250 USD",
      },
    },
    "refused_tour",
    "client",
    { unlocked: true }
  );

  assert.match(card.text, /2500 USD<\/b> <i>за 2 человека<\/i>/);
  assert.match(card.text, /за 1 человека:<\/b> 1 250 USD/);
  assert.doesNotMatch(card.text, /2500 USD<\/b> <i>за 1 человека<\/i>/);
});

test("Telegram card renders lifecycle labels without false urgency", () => {
  const base = {
    id: 1,
    title: "Тестовый отказной тур",
    category: "refused_tour",
    details: {
      isActive: true,
      startDate: "2030-10-03",
      expiration: "2030-09-24T04:59:00+05:00",
      grossPrice: "1000",
    },
  };
  const render = (patch = {}) => buildServiceMessage(
    { ...base, ...patch, details: { ...base.details, ...(patch.details || {}) } },
    "refused_tour",
    "client",
    { unlocked: true }
  ).text;

  assert.match(render({ status: "published" }), /🟢 Актуально/);
  assert.doesNotMatch(render({ status: "published" }), /⚡ срочно/i);
  assert.match(render({ status: "pending" }), /🟠 на модерации/);
  assert.match(render({ status: "draft" }), /📝 черновик/);
  assert.match(render({ status: "rejected" }), /⛔ отклонено/);
  assert.match(render({ status: "archived" }), /📦 архив/);
  assert.match(render({ status: "deleted" }), /🗑 удалено/);
  assert.match(render({ status: "cancelled" }), /⛔ отменено/);
  assert.match(render({ status: "expired" }), /🔴 истекло/);
  assert.match(render({ status: "inactive" }), /🔴 неактуально/);
  assert.match(render({ status: "published", details: { isActive: false } }), /🔴 неактуально/);
});

test('explicit screenshot price basis overrides legacy DBL audience inference',()=>{
 const card=buildServiceMessage({id:42,title:'TEST',category:'refused_tour',details:{accommodation:'DBL',adt:2,grossPrice:125,pricePerPerson:125,priceBasis:'person',priceFor:'за 1 человека'}},'refused_tour','client',{unlocked:true});
 assert.match(card.text,/125 USD<\/b> <i>за 1 человека<\/i>/);assert.doesNotMatch(card.text,/125 USD<\/b> <i>за 2/);
});

test('inline refused tour card shows room type and meals separately from occupancy',()=>{
 for(const fields of [{details:{roomCategory:'Deluxe',food:'BB'}},{room_category:'Deluxe',food:'BB',details:{}}]){
  const card=buildServiceMessage({id:42,title:'TEST',category:'refused_tour',...fields},'refused_tour','client');
  assert.match(card.text,/🛏 <b>Тип номера:<\/b> Deluxe/);assert.match(card.text,/🍽 <b>Питание:<\/b> BB/);
 }
 const card=buildServiceMessage({id:42,title:'TEST',category:'refused_tour',details:{}},'refused_tour','client');
 assert.doesNotMatch(card.text,/Тип номера:|Питание:/);
});

test('tour card does not repeat meals in inclusions or the hotel title',()=>{
 const card=buildServiceMessage({id:42,title:'RADISSON BLU RESORT PHU QUOC',category:'refused_tour',details:{hotel:'RADISSON BLU RESORT PHU QUOC',roomCategory:'Deluxe',food:'BB',transferIncluded:true,insuranceIncluded:true}},'refused_tour','client');
 assert.equal((card.text.match(/BB/g)||[]).length,1);
 assert.equal((card.text.match(/RADISSON BLU RESORT PHU QUOC/gi)||[]).length,1);
 assert.match(card.text,/Тип номера/);assert.match(card.text,/трансфер/);assert.match(card.text,/страховка/);
});

test('hotel cards render hotel, meals and occupancy once while retaining distinct room category and dates',()=>{
 for(const role of ['client','provider']){
  const service={id:42,title:'TEST HOTEL',category:'refused_hotel',details:{hotel:'TEST HOTEL',roomCategory:'DBL',accommodation:'DBL',food:'BB',city:'Dubai',country:'Dubai',checkInDate:'2099-12-01',checkOutDate:'2099-12-08'}};
  const text=buildServiceMessage(service,service.category,role,{forceRefused:true}).text;
  for(const value of ['TEST HOTEL','DBL','BB','Dubai','01.12.2099','08.12.2099'])assert.equal(text.toLowerCase().split(value.toLowerCase()).length-1,1,value);
  const detailed=buildServiceMessage({...service,details:{...service.details,roomCategory:'Deluxe'}},service.category,role,{forceRefused:true}).text;
  assert.match(detailed,/Deluxe/);assert.match(detailed,/DBL/);
 }
});
test('flight cards avoid title duplicates but retain distinct outbound and return flight details',()=>{
 for(const role of ['client','provider']){
  const service={id:42,title:'Uzbekistan Airways HY101 ECONOMY 20 kg',category:'refused_flight',details:{directionFrom:'Tashkent',directionTo:'London',airline:'Uzbekistan Airways',flightNumber:'HY101',cabinClass:'ECONOMY',baggage:'20 kg',departureTime:'08:00',arrivalTime:'12:00',returnFlightNumber:'HY102',returnFlightTime:'15:00',departureFlightDate:'2099-12-01',returnFlightDate:'2099-12-08'}};
  const text=buildServiceMessage(service,service.category,role,{forceRefused:true}).text;
  for(const value of ['Uzbekistan Airways','HY101','20 kg'])assert.equal(text.toLowerCase().split(value.toLowerCase()).length-1,1,value);
  assert.match(text,/HY102/);assert.match(text,/08:00/);assert.match(text,/12:00/);assert.match(text,/15:00/);
 }
});

test('similar flight numbers are not mistaken for duplicates',()=>{
 const text=buildServiceMessage({id:42,title:'Flight HY101',category:'refused_flight',details:{flightNumber:'HY10',returnFlightNumber:'HY102'}},'refused_flight','client').text;
 assert.match(text,/№ HY10(?:[^0-9]|$)/);assert.match(text,/HY102/);
});

test('a destination-only tour title is not repeated above its location',()=>{
 const service={id:42,title:'Фукуок',category:'refused_tour',details:{directionTo:'Фукуок',country:'Вьетнам',hotel:'TEST HOTEL',food:'BB',roomCategory:'Deluxe'}};
 const text=buildServiceMessage(service,service.category,'client').text;
 assert.equal(text.split('Фукуок').length-1,1);assert.match(text,/Вьетнам/);assert.match(text,/Deluxe/);
 const named=buildServiceMessage({...service,title:'Особый тур на Фукуок'},service.category,'client').text;assert.match(named,/Особый тур/);
});
