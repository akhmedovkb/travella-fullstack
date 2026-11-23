const test=require('node:test'),assert=require('node:assert/strict');
const {createAssistantContactResolver,contactLines}=require('../ai/groupAssistantContacts');
test('contacts require private actor context, allowed service and explicit unlocked access',async()=>{
 const ctx={chat:{id:7,type:'private'},from:{id:7}},calls=[];
 let unlocked=false,status='published',id=42;
 const resolve=createAssistantContactResolver({resolveAudience:async()=>({role:'admin',privileged:false}),loadService:async(...args)=>{calls.push(args);return {unlocked,service:{id,status,moderation_status:'approved'}};},pickContacts:()=>({name:'TEST <supplier>',telegram:'@test_supplier',phone:'+998900000000'}),normalizeTelegram:v=>v.replace('@','')});
 assert.equal(await resolve(ctx,42),null);assert.equal(calls[0][1],'client');unlocked=true;assert.equal((await resolve(ctx,42)).telegram,'test_supplier');assert.equal((await resolve(ctx,42)).phone,'+998900000000');status='draft';assert.equal(await resolve(ctx,42),null);status='published';id=43;assert.equal(await resolve(ctx,42),null);
 const n=calls.length;assert.equal(await resolve({...ctx,chat:{id:-100,type:'supergroup'}},42),null);assert.equal(calls.length,n);
});
test('contact rendering accepts safe Telegram handles and phones only',()=>{
 assert.match(contactLines({name:'TEST',telegram:'test_supplier',phone:'+998900000000'}).join('\n'),/https:\/\/t.me\/test_supplier/);
 assert.doesNotMatch(contactLines({telegram:'javascript:bad',phone:'https://bad.invalid'}).join('\n'),/javascript|bad.invalid/);
 assert.match(contactLines(null,'ru',2).join('\n'),/в варианте 2/);
});
