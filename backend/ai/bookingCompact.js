const {stayText,customerPrice,extraCosts}=require('./bookingPresentation');
const {getServiceCategoryContract,shouldSkipField}=require('../utils/serviceCategoryContract');
const {stepFieldsFor}=require('./bookingScreenshot');
const {labels,fieldIcons,display,dateValue,validateEdit}=require('./bookingImportReview');
const {priceBases,readiness}=require('./bookingQuality');
const compactFields={
 pricePeriod:{label:'⏱ Период основной цены',hint:'👇 Выберите, за какой период указаны обе основные цены.'},
 surcharges:{label:'➕ Доплаты'},
 priceBasis:{label:'💵 За что указана цена',hint:'👇 За что указаны обе цены — для коллег и туристов?'},
 price:{label:'💰 Цена для коллег',hint:'💰 Цена для коллег в USD. Например: 1000.\n🔒 Туристы её не увидят.'},
 grossPrice:{label:'💵 Цена для туристов',hint:'💵 Цена для туристов в USD. Например: 1100.\n👀 Покажем её в карточке.'},
 expiration:{label:'⏳ Срок актуальности',hint:'📅 До какого дня можно купить предложение? Напишите ДД.ММ.ГГГГ или «без срока».'},
 transferIncluded:{label:'🚐 Трансфер',optional:true,boolean:true},insuranceIncluded:{label:'🛡 Страховка',optional:true,boolean:true},
 visaIncluded:{label:'🛂 Виза',optional:true,boolean:true},earlyCheckIn:{label:'🕒 Ранний заезд',optional:true,boolean:true},arrivalFastTrack:{label:'⚡ Fast Track',optional:true,boolean:true},
 halal:{label:'🍽 Halal',optional:true,boolean:true},changeable:{label:'✏️ Изменения брони',optional:true,boolean:true},
 food:{label:'🍽 Питание',optional:true,hint:'Укажите RO, BB, HB, FB, AI или UAI.'},
 roomCategory:{label:'🛏 Тип номера',optional:true,hint:'Напишите тип номера.'},
 flightDetails:{label:'✈️ Рейс и багаж',optional:true,flight:true,hint:'Напишите известные данные рейса и багажа.'},
};
function requiredMissing(d){const fields=stepFieldsFor(d.category);return [...new Set(getServiceCategoryContract(d.category,d).filter(f=>f.required&&f.createStep&&!shouldSkipField(f,d)).map(f=>fields[f.createStep]).filter(k=>{if(!k)return false;if(d[k]===undefined||d[k]===null||d[k]==='')return true;if(k.endsWith('Date')){try{validateEdit(k,d[k],d);}catch{return true;}}return false;}))];}
function validateCompact(field,text,d){
 const v=String(text).trim();if(field==='pricePeriod')return require('./bookingPricing').validatePeriod(v,d);if(field==='priceBasis'){if(!priceBases[v])throw Error('Выберите: за всех, за человека или за номер.');if(v==='room'&&d.category==='refused_flight')throw Error('Для авиабилета выберите за всех или за человека.');return v;}if(compactFields[field]?.boolean){if(/^(не знаю|unknown)$/i.test(v))return null;if(/^(да|нет)$/i.test(v))return v.toLowerCase()==='да';throw Error('Выберите «Включено», «Не включено» или «Не знаю».');}
 if(['price','grossPrice'].includes(field)){const clean=v.replace(/\s*USD$/i,'').replace(/\s/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(clean)||+clean<=0||+clean>10000000)throw Error('💰 Нужна сумма больше нуля. Например: 1100 USD.');if(field==='grossPrice'&&+clean<Number(d.price))throw Error('⚠️ Цена для туристов ниже цены для коллег. Проверьте сумму.');return +clean;}
 if(field==='expiration'){if(/^(без срока|нет)$/i.test(v))return null;const day=dateValue(v);const end=new Date(day+'T23:59:00+05:00');if(+end<Date.now())throw Error('📅 Эта дата уже прошла. Выберите будущую дату.');const start=d.startDate||d.departureFlightDate;if(start&&day>start)throw Error('📅 Срок продажи позже начала поездки. Выберите более раннюю дату.');return end.toISOString();}
 return require('./bookingImportReview').validateEdit(field,text,d);
}
function pendingFields(d){return [...new Set([...(!d.bookingPartyConfirmed?['party']:[]),...requiredMissing(d),...(!d.price?['price']:[]),...(!d.grossPrice?['grossPrice']:[]),...(!d.priceBasis?['priceBasis']:[]),...(!d.pricePeriod?['pricePeriod']:[]),...(!d.surchargesStatus?['surcharges']:[]),...(!Object.hasOwn(d,'expiration')?['expiration']:[])])];}
function progressText(d){const pending=pendingFields(d),names=pending.map(k=>k==='party'?'состав туристов':(labels[k]||compactFields[k]?.label||k).replace(/^[^А-Яа-яA-Za-z]+/u,'').toLowerCase());return pending.length?'📊 Осталось заполнить: '+names.join(', ')+'.':'✅ Все обязательные поля заполнены. Проверьте карточку перед сохранением.';}
function priceSummary(d){return `💰 Для коллег: ${d.price||'—'} USD (не видно туристам)\n💵 Для туристов: ${d.grossPrice||'—'} USD\n👥 Обе суммы: ${priceBases[d.priceBasis]||'выберите, за кого указана цена'}`;}
function previewText(d){const stay=stayText(d);const facts=Object.entries(labels).filter(([k])=>k!=='title'&&!(stay&&['startDate','endDate'].includes(k))&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(([k,label])=>(fieldIcons[k]||'📌')+' '+label+': '+(k==='flightDetails'?'\n\n':'')+display(d[k],k).slice(0,k==='flightDetails'?1400:100));const lines=['👀 Карточка перед сохранением','',...require('../utils/aviationCodeWarnings').aviationCodeMessages(d).map(x=>'⚠️ '+x),display(d.title||'Без названия','title').slice(0,200),'',customerPrice(d,priceBases),...extraCosts(d),'',...(stay?[stay]:[]),...facts,'',`👥 ${d.adt} взрослых · ${d.chd} детей · ${d.inf} младенцев`,`💰 Для коллег: ${d.price} USD (внутреннее поле)`,`⏳ Актуально до: ${d.expiration?require('./bookingQuickChoices').expiryLabel(d.expiration):'без срока'}`,...Object.entries(compactFields).filter(([k,v])=>v.optional&&d[k]!==undefined&&!labels[k]).map(([k,v])=>v.label+': '+(d[k]===null?'не уточнено':display(d[k],k))),'','🖼 Фото карточки: '+(d.images?.length||0)+'. Скриншоты бронирования останутся непубличными.',readiness(d)];return lines.join('\n').slice(0,4000);}

module.exports={compactFields,requiredMissing,validateCompact,previewText,pendingFields,progressText,priceSummary};
