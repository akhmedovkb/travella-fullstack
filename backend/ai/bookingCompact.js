const {getServiceCategoryContract,shouldSkipField}=require('../utils/serviceCategoryContract');
const {stepFieldsFor}=require('./bookingScreenshot');
const {labels,display,dateValue,validateEdit}=require('./bookingImportReview');
const {priceBases,readiness}=require('./bookingQuality');
const compactFields={
 priceBasis:{label:'💵 За что указана цена',hint:'Выберите единицу цены. Суммы поставщика и клиента относятся к одной единице.'},
 price:{label:'💰 Цена поставщика',hint:'Укажите цену поставщика в USD за выбранную единицу. Например: 1000 USD.'},
 grossPrice:{label:'💵 Цена для клиента',hint:'Укажите цену для клиента в USD за выбранную единицу. Например: 1100 USD.'},
 expiration:{label:'⏳ Срок актуальности',hint:'До какого дня предложение актуально? Введите ДД.ММ.ГГГГ или «без срока».'},
 transferIncluded:{label:'🚐 Трансфер',optional:true,boolean:true},insuranceIncluded:{label:'🛡 Страховка',optional:true,boolean:true},
 visaIncluded:{label:'🛂 Виза',optional:true,boolean:true},earlyCheckIn:{label:'🕒 Ранний заезд',optional:true,boolean:true},arrivalFastTrack:{label:'⚡ Fast Track',optional:true,boolean:true},
 halal:{label:'🍽 Halal',optional:true,boolean:true},changeable:{label:'✏️ Изменения брони',optional:true,boolean:true},
 food:{label:'🍽 Питание',optional:true,hint:'Укажите RO, BB, HB, FB, AI или UAI.'},
 roomCategory:{label:'🛏 Тип номера',optional:true,hint:'Напишите тип номера.'},
 flightDetails:{label:'✈️ Рейс и багаж',optional:true,flight:true,hint:'Напишите известные данные рейса и багажа.'},
};
function requiredMissing(d){const fields=stepFieldsFor(d.category);return [...new Set(getServiceCategoryContract(d.category,d).filter(f=>f.required&&f.createStep&&!shouldSkipField(f,d)).map(f=>fields[f.createStep]).filter(k=>{if(!k)return false;if(d[k]===undefined||d[k]===null||d[k]==='')return true;if(k.endsWith('Date')){try{validateEdit(k,d[k],d);}catch{return true;}}return false;}))];}
function validateCompact(field,text,d){
 const v=String(text).trim();if(field==='priceBasis'){if(!priceBases[v])throw Error('Выберите: за всех, за человека или за номер.');if(v==='room'&&d.category==='refused_flight')throw Error('Для авиабилета выберите за всех или за человека.');return v;}if(compactFields[field]?.boolean){if(/^(не знаю|unknown)$/i.test(v))return null;if(/^(да|нет)$/i.test(v))return v.toLowerCase()==='да';throw Error('Выберите «Включено», «Не включено» или «Не знаю».');}
 if(['price','grossPrice'].includes(field)){const clean=v.replace(/\s*USD$/i,'').replace(/\s/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(clean)||+clean<=0||+clean>10000000)throw Error('Введите положительную цену в USD, например 1100.');if(field==='grossPrice'&&+clean<Number(d.price))throw Error('Цена клиента не может быть ниже цены поставщика.');if(field==='price'&&d.grossPrice&&+clean>Number(d.grossPrice))throw Error('Цена поставщика выше цены клиента. Сначала измените цену клиента.');return +clean;}
 if(field==='expiration'){if(/^(без срока|нет)$/i.test(v))return null;const day=dateValue(v);const end=new Date(day+'T23:59:00+05:00');if(+end<Date.now())throw Error('Укажите будущую дату.');const start=d.startDate||d.departureFlightDate;if(start&&day>start)throw Error('Срок актуальности не должен быть позже начала поездки.');return end.toISOString();}
 return require('./bookingImportReview').validateEdit(field,text,d);
}
function previewText(d){const lines=['👀 Карточка перед сохранением','',d.title||'Без названия',...Object.entries(labels).filter(([k])=>k!=='title'&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(([k,label])=>label+': '+display(d[k],k).slice(0,k==='flightDetails'?600:200)),'',`👥 ${d.adt} взрослых · ${d.chd} детей · ${d.inf} младенцев`,`💵 Клиенту: ${d.grossPrice} USD ${priceBases[d.priceBasis]||'— единица не выбрана'}`,`💰 Поставщику: ${d.price} USD (внутреннее поле)`,`⏳ Актуально до: ${d.expiration?require('./bookingQuickChoices').expiryLabel(d.expiration):'без срока'}`,...Object.entries(compactFields).filter(([k,v])=>v.optional&&d[k]!==undefined&&!labels[k]).map(([k,v])=>v.label+': '+(d[k]===null?'не уточнено':display(d[k],k))),'','Фото карточки: '+(d.images?.length||0)+'. Скриншоты бронирования в публичную карточку не входят.','Доплаты и условия гала-ужина можно указать после сохранения.',readiness(d)];return lines.join('\n').slice(0,4000);}
module.exports={compactFields,requiredMissing,validateCompact,previewText};
