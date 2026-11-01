const test = require("node:test");
const assert = require("node:assert/strict");
const { providerProfileText, replyProviderProfile } = require("../utils/telegramProviderProfile");
test("profile bounds fields, labels missing values and omits private account metadata", () => {
  const text=providerProfileText({name:"<Company>",type:"agent",phone:"+998",password:"secret",email:"private",location:"Ташкент",social:"@supplier"});
  assert.match(text,/Турагент/); assert.match(text,/@supplier/); assert.ok(!text.includes("secret")); assert.ok(!text.includes("private"));
  assert.match(providerProfileText({}),/Не указано/); assert.ok(providerProfileText({name:"x".repeat(10000)}).length<1000);
});
test("group requests never resolve identity or read profile",async()=>{
  const replies=[];
  await replyProviderProfile({chat:{id:-1,type:"group"},from:{id:7},reply:async text=>replies.push(text)},{resolveProviderId:async()=>{throw Error("must not resolve");},pool:{query:async()=>{throw Error("must not read");}}});
  assert.match(replies[0],/личный чат/);
});
test("private profile resolves actor rather than trusting a session provider id",async()=>{
  const replies=[];
  await replyProviderProfile({chat:{id:7,type:"private"},from:{id:7},session:{providerId:999},reply:async(...args)=>replies.push(args)},{resolveProviderId:async id=>{assert.equal(id,7);return 42;},pool:{query:async(sql,args)=>{assert.deepEqual(args,[42]);assert.ok(!sql.includes("*"));return {rows:[{name:"Supplier"}]};}},siteUrl:"https://travella.uz/"});
  assert.match(replies[0][0],/Supplier/);assert.equal(replies[0][1].reply_markup.inline_keyboard[0][0].url,"https://travella.uz/dashboard/profile");assert.equal(replies[0][1].parse_mode,undefined);
});
test("unlinked account does not query guessed provider",async()=>{
  const replies=[];
  await replyProviderProfile({chat:{id:7,type:"private"},from:{id:7},reply:async text=>replies.push(text)},{resolveProviderId:async()=>null,pool:{query:async()=>{throw Error("must not read");}},siteUrl:"https://travella.uz"});
  assert.match(replies[0],/привязанный профиль/);
});
