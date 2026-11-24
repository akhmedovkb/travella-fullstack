const test=require('node:test'),assert=require('node:assert/strict');
const {publicPriceExtras,flightItineraryText}=require('../utils/publicCardPresentation');
test('public totals require confirmed currency, basis, period and extras',()=>{
 const d={grossPrice:100,price:80,priceBasis:'total',pricePeriod:'full',surchargesStatus:'known',surcharges:[{name:'Transfer',amount:20,currency:'USD',basis:'total',period:'once',required:true},{name:'Seat',amount:5,currency:'USD',basis:'total',period:'once',required:false}]};
 const text=publicPriceExtras(d,'refused_tour',100);assert.match(text,/120 USD/);assert.match(text,/Обязательно/);assert.match(text,/По желанию/);assert.doesNotMatch(text,/80 USD/);
 assert.doesNotMatch(publicPriceExtras({...d,currency:'EUR'},'refused_tour',100),/Итого/);
 assert.doesNotMatch(publicPriceExtras(d,'refused_tour',80),/Итого/);
 assert.doesNotMatch(publicPriceExtras({...d,pricePeriod:undefined},'refused_tour',100),/Итого с/);
});
test('confirmed return legs are separate and stopovers are not called return flights',()=>{
 const raw='HY · TAS · MLE · 2026-12-02 · 07:50 · 14:10\nHY · MLE · TAS · 2026-12-09 · 15:40 · 21:25';
 const text=flightItineraryText({flightDetails:raw});assert.match(text,/Туда/);assert.match(text,/Обратно/);assert.match(text,/Uzbekistan Airways/);assert.match(text,/Ташкент/);
 assert.doesNotMatch(flightItineraryText({flightDetails:raw.replace('MLE · TAS','MLE · DXB')}),/Обратно/);
});
test('legacy round trip text retains flight numbers, times and next-day arrival',()=>{
 const text=flightItineraryText({flightDetails:'752OD , 193OD\n23:20-17:00 +1\n\n192OD , 751OD\n12:10-21:40',departureFlightDate:'2026-11-25',returnFlightDate:'2026-12-07'});
 assert.match(text,/Туда/);assert.match(text,/Обратно/);assert.match(text,/Прилёт: 17:00 \+1/);assert.match(text,/192OD/);assert.doesNotMatch(text,/Багаж/);
 assert.equal(flightItineraryText({flightDetails:'Уточнить у поставщика'}),'✈️ Информация о перелёте\nУточнить у поставщика');
});
