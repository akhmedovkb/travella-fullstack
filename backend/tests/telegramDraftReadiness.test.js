const test=require('node:test'),assert=require('node:assert/strict');
const {draftReadiness}=require('../utils/telegramDraftReadiness');
const flight={category:'refused_flight',title:'TEST flight',price:100,images:[],details:{directionFrom:'TAS',directionTo:'PQC',flightType:'one_way',departureFlightDate:'2099-12-01',flightDetails:'HY123',netPrice:100,grossPrice:120}};
test('optional fields do not lower readiness and public photos do not count as private proof',()=>{
 const text=draftReadiness(flight);assert.match(text,/Основные данные заполнены/);assert.doesNotMatch(text,/\d+%|\d+\/\d+|Осталось заполнить/);assert.match(text,/подтверждение/);
 assert.match(draftReadiness({...flight,images:['public-photo']}),/подтверждение/);
 assert.doesNotMatch(draftReadiness({...flight,details:{...flight.details,proofImages:['private-proof']}}),/добавьте подтверждение/);
});
test('missing required data and expired sale remain visible',()=>{
 const text=draftReadiness({...flight,details:{...flight.details,grossPrice:null,expiration:'2000-01-01'}});assert.match(text,/цена для туристов/);assert.match(text,/Срок продажи истёк/);assert.doesNotMatch(text,/Основные данные заполнены/);
});
