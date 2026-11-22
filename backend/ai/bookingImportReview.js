const {bookingTitle,stepFieldsFor}=require('./bookingScreenshot');
const {getServiceCategoryContract}=require('../utils/serviceCategoryContract');
const labels={title:'Название',country:'Страна',fromCity:'Город вылета',toCity:'Город прибытия',startDate:'Заезд / начало',endDate:'Выезд / окончание',departureFlightDate:'Дата вылета',returnFlightDate:'Обратный вылет',hotel:'Отель',roomCategory:'Тип номера',accommodation:'Размещение',food:'Питание',transferIncluded:'Трансфер',insuranceIncluded:'Страховка',flightType:'Тип перелёта',flightDetails:'Рейс и багаж'};
const fieldIcons={title:'📝',country:'🌍',fromCity:'🛫',toCity:'📍',startDate:'📅',endDate:'📅',departureFlightDate:'🛫',returnFlightDate:'🛬',hotel:'🏨',roomCategory:'🛏',accommodation:'👥',food:'🍽',transferIncluded:'🚐',insuranceIncluded:'🛡',flightType:'✈️',flightDetails:'✈️'};
const reasons={unreadable:'не удалось разобрать — заполните вручную',partial:'часть данных плохо видна — проверьте',ambiguous:'значение неоднозначно — проверьте',departure_time_unclear:'время вылета плохо видно — проверьте',arrival_time_unclear:'время прилёта плохо видно — проверьте'};
const dateKeys=['startDate','endDate','departureFlightDate','returnFlightDate'];
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'?a.trim().replace(/\s+/g,' ').toLowerCase()===b.trim().replace(/\s+/g,' ').toLowerCase():a===b;
function display(value,key){if(value===undefined||value===null||value==='')return 'не указано';if(typeof value==='boolean')return value?'Да':'Нет';if(key==='flightType')return value==='one_way'?'В одну сторону':'Туда-обратно';if(dateKeys.includes(key))return value.split('-').reverse().join('.');return require('./bookingPresentation').decoded(value,key)||String(value);}
function refreshTitle(s){if(!s.manualFields?.includes('title')){const title=bookingTitle(s.draft);if(title)s.draft.title=title;else delete s.draft.title;}if(s.draft.flightType==='one_way'){delete s.draft.returnFlightDate;s.conflicts=(s.conflicts||[]).filter(c=>c.field!=='returnFlightDate');s.warnings=(s.warnings||[]).filter(w=>w.field!=='returnFlightDate');}}
function mergeRecognition(s,incoming,source){
 s.conflicts=s.conflicts||[];s.warnings=s.warnings||[];s.manualFields=s.manualFields||[];s.fieldSources=s.fieldSources||{};
 if(!s.draft)s.draft={category:incoming.category,images:[]};
 if(incoming.bookingFlightDates?.length&&!s.manualFields.includes('flightDetails'))s.draft.bookingFlightDates=[...new Set([...(s.draft.bookingFlightDates||[]),...incoming.bookingFlightDates])];
 for(const [field,value]of Object.entries(incoming)){
  if(!labels[field]||field==='title'||value==null||value==='')continue;
  if(s.manualFields.includes(field))continue;
  const old=s.draft[field];
  if(old===undefined){s.draft[field]=value;s.fieldSources[field]=source;continue;}if(eq(old,value))continue;
  if(field==='flightDetails'){
   if(old.includes(value))continue;if(value.includes(old)){s.draft[field]=value;continue;}
   const numbers=v=>[...v.matchAll(/\b(?:[A-Z]{2,3}|[A-Z][0-9]|[0-9][A-Z])\s?\d{1,5}\b/g)].map(m=>m[0]);
   const a=numbers(old),b=numbers(value);
   if(a.length&&b.length&&!a.some(n=>b.includes(n))&&old.length+value.length<3200){s.draft[field]=old+'\n'+value;continue;}
  }
  let conflict=s.conflicts.find(c=>c.field===field);
  if(!conflict){conflict={field,values:[{value:old,source:s.fieldSources[field]||1}]};s.conflicts.push(conflict);}
  if(!conflict.values.some(v=>eq(v.value,value)))conflict.values.push({value,source});
 }
 for(const warning of incoming.bookingWarnings||[]){if(s.manualFields.includes(warning.field))continue;if(!s.warnings.some(w=>w.field===warning.field))s.warnings.push(warning);}
 refreshTitle(s);
}
function dateValue(text){let v=text.trim();if(/^\d{2}[./]\d{2}[./]\d{4}$/.test(v))v=v.split(/[./]/).reverse().join('-');if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('📅 Введите дату: ДД.ММ.ГГГГ.');const d=new Date(v+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw Error('📅 Такой даты не существует.');return v;}
function validateEdit(field,text,draft){
 let value=String(text||'').replace(/\s+/g,' ').trim();if(!value)throw Error('✍️ Введите значение.');
 if(dateKeys.includes(field)){
  value=dateValue(value);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(value<today)throw Error('📅 Дата уже прошла. Выберите будущую дату.');
 }else if(['transferIncluded','insuranceIncluded'].includes(field)){
  if(!/^(да|нет|yes|no)$/i.test(value))throw Error('👇 Напишите «да» или «нет».');value=/^(да|yes)$/i.test(value);
 }else if(field==='flightType'){
  if(/^(в одну сторону|one_way|one way|1)$/i.test(value))value='one_way';else if(/^(туда.?обратно|round_trip|round trip|2)$/i.test(value))value='round_trip';else throw Error('Напишите «в одну сторону» или «туда-обратно».');
 }else if(field==='food'){
  value=value.toUpperCase();if(!['RO','BB','HB','FB','AI','UAI'].includes(value))throw Error('Укажите RO, BB, HB, FB, AI или UAI.');
 }else if(field==='accommodation'){
  value=value.toUpperCase();if(!['SGL','DBL','TRPL','QDRPL'].includes(value))throw Error('Укажите SGL, DBL, TRPL или QDRPL.');
 }else if(value.length<(field==='flightDetails'?1:2)||value.length>(field==='flightDetails'?2000:200))throw Error('Проверьте длину значения: от 2 до 200 символов.');
 const next={...draft,[field]:value};
 if(next.startDate&&next.endDate&&next.startDate>next.endDate)throw Error('⚠️ Окончание раньше начала.\n📅 Сначала исправьте связанную дату.');
 if(next.departureFlightDate&&next.returnFlightDate&&next.flightType!=='one_way'&&next.departureFlightDate>next.returnFlightDate)throw Error('⚠️ Обратный вылет раньше вылета туда.');
 return value;
}
function setField(s,field,value){if(field==='flightDetails')delete s.draft.bookingFlightDates;s.draft[field]=value;s.manualFields=[...new Set([...(s.manualFields||[]),field])];s.conflicts=(s.conflicts||[]).filter(c=>c.field!==field);s.warnings=(s.warnings||[]).filter(w=>w.field!==field);delete s.duplicateAck;refreshTitle(s);}
function missingFields(draft){
 const fields=stepFieldsFor(draft.category);const out=[];
 for(const f of getServiceCategoryContract(draft.category,draft))if(f.required&&f.createStep){const key=fields[f.createStep];if(key&&(draft[key]===undefined||draft[key]===''))out.push(labels[key]||f.label);}
 if(!draft.bookingPartyConfirmed)out.push(draft.category==='refused_flight'?'Состав пассажиров':'Состав гостей');
 if(!draft.price)out.push('Цена для коллег');if(!draft.grossPrice)out.push('Цена для туристов');if(!Object.hasOwn(draft,'expiration'))out.push('Срок актуальности');return [...new Set(out)];
}
function reviewText(s,categoryLabel,showMissing=true){
 const d=s.draft;const filled=Object.keys(labels).filter(k=>d[k]!==undefined&&d[k]!==null&&d[k]!=='');const lines=filled.map(k=>{const value=display(d[k],k),limit=k==='flightDetails'?280:k==='title'?120:60;return `${s.warnings?.some(w=>w.field===k)?'⚠️':fieldIcons[k]||'📌'} ${labels[k]}: ${value.length>limit?value.slice(0,limit)+'…':value}`;});
 const missing=missingFields(d);const warnings=(s.warnings||[]).map(w=>`⚠️ ${labels[w.field]}: ${reasons[w.reason]||reasons.ambiguous}`);
 return ['📝 Проверьте данные · '+categoryLabel,`📸 Заполнено полей: ${filled.filter(k=>k!=='title').length} · Скриншотов распознано: ${s.files.filter(f=>f.processed).length} из ${s.files.length}`,'',...lines,'',...(warnings.length?warnings:[]),...(s.conflicts?.length?['⚠️ Различаются данные: '+s.conflicts.map(c=>labels[c.field]).join(', ')]:[]),'',showMissing?(missing.length?'✍️ Осталось заполнить: '+missing.join(', ')+'.':'✅ Основные поля заполнены.'):null,d.bookingPartyConfirmed?`👥 Состав: взрослые — ${d.adt}, дети — ${d.chd}, младенцы — ${d.inf}.`:null,'', '💾 Сохраним черновик. Публикация — после проверки модератором.'].filter(x=>x!==null).join('\n');
}
module.exports={labels,reasons,display,mergeRecognition,validateEdit,setField,missingFields,reviewText,refreshTitle,dateValue,fieldIcons};
