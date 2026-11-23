const test=require('node:test'),assert=require('node:assert/strict');
const {aviationCodeIssues,aviationCodeMessages}=require('../utils/aviationCodeWarnings');
test('unknown and ambiguous city and airline codes are reported with their editable fields',()=>{
 const d={fromCity:'ZZZ',toCity:'AMS',flightDetails:'XX · ZZZ · AMS · 2026-12-04 · 10:00 · 20:00\nQ9 · AMS · IST · 2026-12-05 · 09:00 · 16:00'};
 const issues=aviationCodeIssues(d);assert.deepEqual(issues.map(x=>[x.code,x.status]),[['ZZZ','unknown'],['AMS','ambiguous'],['XX','unknown'],['Q9','ambiguous']]);assert.deepEqual(issues[0].fields,['fromCity','flightDetails']);assert.equal(aviationCodeMessages(d).length,2);
});
test('full names, known codes and flight numbers do not produce false warnings',()=>{
 assert.deepEqual(aviationCodeIssues({fromCity:'Ташкент',toCity:'Мале',flightDetails:'HY123 · Uzbekistan Airways · TAS · MLE · 2026-12-04 · 07:50 · 14:10'}),[]);
 assert.deepEqual(aviationCodeIssues({fromCity:'SIN',toCity:'CDG',flightDetails:'SQ · SIN · CDG · 2026-12-04 · 07:50 · 14:10'}),[]);
 assert.match(aviationCodeMessages({flightDetails:'XX123 · ZZZ · MLE · 2026-12-04'})[1],/XX/);
});
