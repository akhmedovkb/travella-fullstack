function localDay(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
function expiryChoice(kind,draft,now=Date.now()){
 let time;if(kind==='evening')time=+new Date(localDay(now)+'T23:59:00+05:00');else if(kind==='24h')time=now+86400000;else throw Error('Выберите срок.');
 const start=draft.startDate||draft.departureFlightDate;if(start&&time>+new Date(start+'T23:59:00+05:00'))throw Error('Этот срок позже начала поездки. Выберите другую дату.');if(time<=now)throw Error('Укажите будущий срок.');return new Date(time).toISOString();
}
function expiryLabel(value){if(value===undefined)return 'не указано';return value?new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Tashkent',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+' (Ташкент)':'без срока';}
function calendarRows(month,draft,now=Date.now()){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Неверный месяц.');const [y,m]=month.split('-').map(Number);if(y<2020||y>2100)throw Error('Выберите другой месяц.');const first=new Date(Date.UTC(y,m-1,1)),days=new Date(Date.UTC(y,m,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7,rows=[[['Пн','noop'],['Вт','noop'],['Ср','noop'],['Чт','noop'],['Пт','noop'],['Сб','noop'],['Вс','noop']]],today=localDay(now),last=draft.startDate||draft.departureFlightDate;
 let row=[];for(let i=0;i<offset+days;i++){if(i<offset)row.push(['·','noop']);else{const day=String(i-offset+1).padStart(2,'0'),iso=month+'-'+day,allowed=iso>=today&&(!last||iso<=last);row.push([allowed?String(i-offset+1):'—',allowed?'expday_'+iso:'noop']);}if(row.length===7){rows.push(row);row=[];}}if(row.length)rows.push(row);const prev=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);rows.push([['←','calmonth_'+prev],[first.toLocaleDateString('ru-RU',{timeZone:'UTC',month:'long',year:'numeric'}),'noop'],['→','calmonth_'+next]],[['✍️ Ввести дату вручную','manualexpiry']],[['⬅️ К сводке','review']]);return rows;
}
module.exports={expiryChoice,expiryLabel,calendarRows,localDay};
