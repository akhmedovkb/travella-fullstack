const {stepFieldsFor}=require('./bookingScreenshot');
const {getServiceWizardSteps}=require('../utils/serviceWizardEngine');

const names={
 country:'🌍 Страна',fromCity:'🛫 Откуда',toCity:'📍 Куда',hotel:'🏨 Название отеля',
 startDate:'📅 Начало',endDate:'📅 Окончание',roomCategory:'🛏 Тип номера',accommodation:'👥 Размещение',
 food:'🍽 Питание',transferIncluded:'🚐 Трансфер',insuranceIncluded:'🛡 Страховка',
 flightType:'↔️ Тип перелёта',departureFlightDate:'📅 Дата вылета',returnFlightDate:'📅 Обратный вылет',flightDetails:'✈️ Рейс и багаж',
};
const groups={
 refused_hotel:[['country','toCity'],['hotel'],['startDate','endDate'],['roomCategory','accommodation'],['food','insuranceIncluded']],
 refused_flight:[['fromCity','toCity'],['flightType'],['departureFlightDate','returnFlightDate'],['flightDetails']],
 refused_tour:[['country','fromCity'],['toCity','hotel'],['startDate','endDate'],['flightDetails'],['roomCategory','accommodation'],['food','transferIncluded'],['insuranceIncluded']],
};
function editableBookingSteps(draft){
 const contract=new Set(getServiceWizardSteps(draft.category,'',draft));
 return Object.entries(stepFieldsFor(draft.category)).filter(([step,key])=>contract.has(step)&&names[key]);
}
function bookingEditRows(draft){
 const byField=new Map(editableBookingSteps(draft).map(([step,key])=>[key,step]));
 const labels={...names};
 if(draft.category==='refused_hotel')Object.assign(labels,{toCity:'📍 Город',startDate:'📅 Заезд',endDate:'📅 Выезд'});
 if(draft.category==='refused_flight')labels.toCity='🛬 Куда';
 const rows=(groups[draft.category]||groups.refused_tour).map(group=>group.filter(key=>byField.has(key)).map(key=>[labels[key],'fix_'+byField.get(key)])).filter(row=>row.length);
 rows.push([['✅ Подтвердить данные','accept']],[['⬅️ К проверке','review'],['✖️ Отменить','cancel']]);
 return rows;
}
module.exports={bookingEditRows,editableBookingSteps};
