const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { normalizeQueueRequest, selectQueuePage, queueCandidateQuery, readModerationQueue } = require("../utils/adminModerationQueue");
const { analyzeModerationService } = require("../utils/moderationQueueAnalysis");
const frontend = () => import("../../frontend/src/utils/moderationQueue.js");
const published = (id, extra = {}) => ({ id, published_at: "2026-01-01T00:00:00Z", views_count: id, contact_unlocks_count: 0, quick_requests_count: 0, ...extra });
test("server pages cover more than 200 rows with stable tie order and no duplicates", () => {
  const rows = Array.from({ length:305 },(_,i)=>published(i+1));
  const ids=[];
  for(let page=1;page<=26;page++) ids.push(...selectQueuePage(rows,{ status:"published",page,limit:12 }).ids);
  assert.equal(ids.length,305);assert.equal(new Set(ids).size,305);assert.deepEqual(ids.slice(-5),[5,4,3,2,1]);
  const last=selectQueuePage(rows,{status:"published",page:999,limit:12});assert.equal(last.pagination.page,26);assert.equal(last.pagination.total,305);
});
test("server filters and metric sorts apply before slicing a page",()=>{
  const rows=Array.from({length:50},(_,i)=>published(i+1,{quick_requests_count:i%2,contact_unlocks_count:i%3}));
  const page=selectQueuePage(rows,{status:"published",filter:"hasRequests",sort:"views",limit:12});
  assert.equal(page.pagination.total,25);assert.equal(page.metrics.total,50);assert.equal(page.ids[0],50);assert.ok(page.ids.every(id=>id%2===0));
});
test("locating an edited service finds its new page after sorting",()=>{
  const rows=Array.from({length:305},(_,i)=>published(i+1));
  const result=selectQueuePage(rows,{status:"published",page:1,limit:12,focus_id:1});
  assert.equal(result.pagination.page,26);assert.equal(result.focusFound,true);assert.ok(result.ids.includes(1));
  assert.equal(selectQueuePage(rows,{status:"published",focus_id:999}).focusFound,false);
});
test("search is bound across ID, provider and service fields with escaped wildcard text",()=>{
  const result=queueCandidateQuery({status:"published",q:"#rare%_\\"});
  assert.ok(result.sql.includes("p.name"));assert.ok(result.sql.includes("s.details->>'hotel'"));assert.ok(result.sql.includes("ILIKE $1"));assert.ok(!result.sql.includes("LIMIT 200"));assert.ok(!result.sql.includes("rare"));
  assert.ok(result.params[0].includes("\\%"));assert.ok(result.params[0].includes("\\_"));
  const invalid=queueCandidateQuery({status:"published'; DROP TABLE services;--",q:"' OR true --"});assert.ok(!invalid.sql.includes("DROP TABLE"));assert.ok(!invalid.sql.includes("' OR true"));
});
test("invalid URL/request options fall back to safe bounded defaults",()=>{
  const state=normalizeQueueRequest({status:"bad",page:"nope",limit:999,filter:"bad",sort:"bad",focus_id:0});
  assert.equal(state.status,"pending");assert.equal(state.page,1);assert.equal(state.limit,12);assert.equal(state.filter,"all");assert.equal(state.sort,"priority");assert.equal(state.focusId,null);
});
test("server readiness classification matches the browser for representative legacy records",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/AdminModeration.jsx"),"utf8");
  const names=["parseJsonSafe","normalizeDetails","normalizeImages","pickFirst","hasText","getPublicServiceImages","parseMoneyValue","parseDateValue","getModerationReadiness","getDangerIssues","editFormFromService","analyzeModerationService"];
  const declarations=names.map(name=>{const match=source.match(new RegExp("function "+name+"\\([\\s\\S]*?\\n\\}","m"));assert.ok(match,name);return match[0];}).join("\n");
  const browser=vm.runInNewContext('const fmt=n=>String(n);'+declarations+';analyzeModerationService',{Date,Intl});
  const ready={id:1,title:"Tour",price:"120",images:["https://example.com/photo.jpg"],provider_telegram_chat_id:"100",details:{directionTo:"City",startDate:"2099-01-01",grossPrice:"120",netPrice:"100",proofImages:["https://example.com/proof.jpg"]}};
  for(const item of [ready,{...ready,images:[],details:{}},{...ready,details:{...ready.details,grossPrice:"90"}},{...ready,details:JSON.stringify(ready.details)},{...ready,last_moderation_action:"rejected",status:"pending"}]){
    const server=analyzeModerationService(item),client=browser(item);
    assert.equal(server.ready,client.ready);assert.equal(server.priority,client.priority);assert.deepEqual(server.dangerIssues.map(x=>x.key),Array.from(client.dangerIssues,x=>x.key));
  }
});
function poolFixture({rows,missingPage=false,mismatch=false}){
  const calls=[];const client={release(){calls.push({sql:"RELEASE"});},async query(sql,args){calls.push({sql,args});
    if(sql.startsWith("SELECT COUNT"))return{rows:[{pending:0,rejected:0,published:rows.length+(mismatch?1:0)}]};
    if(sql.includes("ANY($1"))return{rows:args[0].slice(missingPage?1:0).map(id=>rows.find(r=>r.id===id))};
    if(sql.startsWith("SELECT s.id"))return{rows};return{rows:[]};}};
  return{pool:{connect:async()=>client},calls};
}
test("summary, membership and page payload use one read-only repeatable snapshot",async()=>{
  const fixture=poolFixture({rows:Array.from({length:30},(_,i)=>published(i+1))});
  const result=await readModerationQueue(fixture.pool,{status:"published",page:2,limit:12});
  assert.equal(result.items.length,12);assert.equal(result.pagination.total,30);assert.ok(fixture.calls[0].sql.includes("REPEATABLE READ READ ONLY"));assert.ok(fixture.calls.some(q=>q.sql==="COMMIT"));assert.equal(fixture.calls.at(-1).sql,"RELEASE");
  assert.equal(fixture.calls.find(q=>q.sql.includes("ANY($1")).args[0].length,12);
});
test("inconsistent counts or partial payload cause rollback instead of a false empty result",async()=>{
  for(const config of [{mismatch:true},{missingPage:true}]){const f=poolFixture({rows:[published(1)],...config});await assert.rejects(readModerationQueue(f.pool,{status:"published"}),/QUEUE_/);assert.ok(f.calls.some(q=>q.sql==="ROLLBACK"));assert.ok(!f.calls.some(q=>q.sql==="COMMIT"));assert.equal(f.calls.at(-1).sql,"RELEASE");}
});
test("queue URL round-trip preserves Operations tab and unrelated parameters",async()=>{
  const {writeQueueLocation,readQueueLocation}=await frontend();
  const params=writeQueueLocation(new URLSearchParams("tab=moderation&other=keep"),{status:"published",q:"Египет #12",filter:"noUnlocks",sort:"views",page:8,pageSize:24,focus:1207});
  assert.equal(params.get("tab"),"moderation");assert.equal(params.get("other"),"keep");assert.deepEqual(readQueueLocation(params),{status:"published",q:"Египет #12",filter:"noUnlocks",sort:"views",page:8,pageSize:24,focus:1207});
  const reset=writeQueueLocation(params,{q:"",page:1,filter:"all",focus:null});assert.equal(reset.has("m_q"),false);assert.equal(reset.has("m_page"),false);assert.equal(reset.has("m_focus"),false);assert.equal(reset.get("tab"),"moderation");
});
const response=(overrides={})=>({ok:true,items:[{id:1}],counts:{pending:0,rejected:0,published:1},metrics:{total:1},pagination:{page:1,limit:12,total:1,pages:1},...overrides});
test("HTML, unexpected JSON, contradictory empty lists and partial pages are errors",async()=>{
  const {fetchModerationQueue}=await frontend();const state={status:"published",q:"",filter:"all",page:1,pageSize:12,sort:"newest"};
  for(const data of ["<html>SPA fallback</html>",{},response({items:[]}),response({items:[],metrics:{total:0},pagination:{page:1,limit:12,total:0,pages:1}})])await assert.rejects(fetchModerationQueue({get:async()=>({data})},{state}));
  assert.equal((await fetchModerationQueue({get:async()=>({data:response()})},{state})).items.length,1);
  const emptySearch=response({items:[],metrics:{total:0},pagination:{page:1,limit:12,total:0,pages:1}});assert.equal((await fetchModerationQueue({get:async()=>({data:emptySearch})},{state:{...state,q:"absent"}})).items.length,0);
});
test("new requests abort old ones; late success/error never replace the active queue",async()=>{
  const {createQueueRunner}=await frontend();let pending={},received=[],errors=[],loading=[];
  const runner=createQueueRunner({request:(state,signal)=>new Promise((resolve,reject)=>pending[state]={resolve,reject,signal}),onData:d=>received.push(d),onError:e=>errors.push(e),onLoading:v=>loading.push(v)});
  const old=runner.run("old"),latest=runner.run("latest");assert.equal(pending.old.signal.aborted,true);pending.latest.resolve("active");await latest;pending.old.resolve("stale");await old;assert.deepEqual(received,["active"]);
  const stale=runner.run("stale-error"),current=runner.run("current");pending["stale-error"].reject(new Error("old"));await stale;assert.equal(errors.length,0);assert.equal(loading.at(-1),true);pending.current.resolve("current");await current;assert.equal(loading.at(-1),false);
  const cancelled=runner.run("cancelled");runner.cancel();pending.cancelled.resolve("unmounted");await cancelled;assert.deepEqual(received,["active","current"]);
});
test("a failed refresh preserves prior data and supports retry",async()=>{
  const {createQueueRunner}=await frontend();let data="last good",errors=0,fail=true;
  const runner=createQueueRunner({request:async()=>{if(fail)throw new Error("network");return"recovered";},onData:v=>data=v,onError:()=>errors++,onLoading:()=>{}});
  await runner.run({});assert.equal(data,"last good");assert.equal(errors,1);fail=false;await runner.run({});assert.equal(data,"recovered");
});

test("a hash-prefixed ID is exact and oversized IDs safely return no matches",()=>{
  const exact=queueCandidateQuery({status:"published",q:"#1207"});assert.ok(exact.sql.includes("s.id = $1::bigint"));assert.deepEqual(exact.params,["1207"]);assert.ok(!exact.sql.includes("ILIKE"));
  const oversized=queueCandidateQuery({q:"#999999999999999999999999999999"});assert.ok(oversized.sql.includes("AND FALSE"));assert.deepEqual(oversized.params,[]);
});

test("next decision follows surviving queue order and crosses a filled page",async()=>{
 const {nextModerationService}=await frontend();
 const rows=ids=>ids.map(id=>({id}));
 assert.equal(nextModerationService(rows([1,2,3]),2,rows([1,3,4])),3);
 assert.equal(nextModerationService(rows([1,2,3]),3,rows([1,2,4])),4);
 assert.equal(nextModerationService(rows([1]),1,[]),null);
 assert.equal(nextModerationService(rows([1,2]),2,rows([2])),null);
 assert.equal(nextModerationService(rows([1,2]),1,rows([7,8])),7);
});
