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

test('provider card leads with tourist price and calculates its per-person equivalent',()=>{
 const {buildServiceMessage}=require('../utils/telegramServiceCard');
 const card=buildServiceMessage({id:42,category:'refused_tour',title:'TEST',details:{price:4010,grossPrice:4180,accommodation:'DBL',adt:2}},'refused_tour','provider',{forceRefused:true});
 assert.match(card.text,/4180 USD<\/b> <i>за 2/);assert.match(card.text,/Цена для коллег: 4010 USD/);assert.match(card.text,/2.090 USD/);assert.doesNotMatch(card.text,/2.005 USD/);
});

test('clients and shareable inline cards never reveal colleague price regardless of sender role',()=>{
 const {buildServiceMessage}=require('../utils/telegramServiceCard');
 for(const category of ['refused_tour','refused_hotel','refused_flight'])for(const [role,options]of [['client',{}],['provider',{isInline:true,forceRefused:true}],['provider',{publicSafe:true,forceRefused:true}],['provider',{priceAudience:'tourist',forceRefused:true}]]){
  const text=buildServiceMessage({id:42,title:'TEST',category,details:{price:4010,netPrice:4010,grossPrice:4180,accommodation:'DBL',adt:2}},category,role,options).text;
  assert.doesNotMatch(text,/4010|4.010|коллег|поставщика|2.005/);assert.match(text,/4180/);assert.match(text,/Цена для туристов/);
 }
});

test('missing tourist price never falls back to internal colleague price',()=>{
 const {buildServiceMessage}=require('../utils/telegramServiceCard');
 for(const category of ['refused_tour','refused_hotel','refused_flight']){
 const text=buildServiceMessage({id:42,title:'TEST',category,price:4010,details:{price:4010,netPrice:4010}},category,'client').text;
 assert.doesNotMatch(text,/4010|4.010/);assert.match(text,/Цена для туристов:<\/b> уточните/);
 }
});
