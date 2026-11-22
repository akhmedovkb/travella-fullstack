const test=require('node:test'),assert=require('node:assert/strict');
const {bookingLabelOptions}=require('../utils/telegramBookingLabels');
test('booking keys are bold with correct UTF16 offsets after emoji; values stay plain',()=>{
 const text='📝 Название: TEST <villa> & море\n🛫 Город вылета: TAS\n📸 Заполнено полей: 7 · Скриншотов распознано: 1 из 1\n✈️ Рейс и багаж: HY 07:50 → 14:10\n💰 Цена для туристов: 1200 USD';
 const result=bookingLabelOptions(text,{reply_markup:{inline_keyboard:[]}});
 assert.deepEqual(result.entities.map(e=>text.slice(e.offset,e.offset+e.length)),['📝 Название:','🛫 Город вылета:','📸 Заполнено полей:','Скриншотов распознано:','✈️ Рейс и багаж:','💰 Цена для туристов:']);
 assert.ok(result.entities.every(e=>e.type==='bold'));assert.ok(result.reply_markup);assert.equal(result.parse_mode,undefined);
});
test('existing rich text is preserved and colons in user values or flight times are not styled',()=>{
 const html={parse_mode:'HTML'};assert.equal(bookingLabelOptions('<b>Название:</b> TEST',html),html);
 assert.deepEqual(bookingLabelOptions('TEST: value\nHY123 07:50 → 14:10'),{});
 const extra={entities:[{type:'bold',offset:0,length:4}]};assert.equal(bookingLabelOptions('TEST',extra),extra);
});

test('HTML cards preserve bold keys while escaping user values',()=>{const {bookingLabelHtml}=require('../utils/telegramBookingLabels');assert.equal(bookingLabelHtml('🛫 Вылет: 07:50\n🏷 Рейс / авиакомпания: <TEST> & HY'),'<b>🛫 Вылет:</b> 07:50\n<b>🏷 Рейс / авиакомпания:</b> &lt;TEST&gt; &amp; HY');});
