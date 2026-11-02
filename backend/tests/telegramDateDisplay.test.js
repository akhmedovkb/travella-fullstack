const test=require('node:test'),assert=require('node:assert/strict');
const {formatTelegramExpiration:f}=require('../utils/telegramDateDisplay');
test('UTC expiry renders in Tashkent with correct day rollover',()=>{const text=f('2026-11-05T23:59:00.000Z');assert.match(text,/6 ноября 2026/);assert.match(text,/04:59/);assert.match(text,/Ташкент/);assert.ok(!text.includes('000Z'));});
test('explicit offsets represent the same instant',()=>{assert.equal(f('2026-11-06T04:59:00+05:00'),f('2026-11-05T23:59:00Z'));});
test('calendar values keep their original date and time without host timezone conversion',()=>{assert.match(f('2026-11-05 23:59'),/5 ноября 2026.*23:59/);assert.match(f('2026-11-05'),/5 ноября 2026/);assert.ok(!f('2026-11-05').includes('00:00'));});
test('empty and malformed values do not expose a raw technical date',()=>{assert.equal(f(null),'не указано');for(const value of ['bad','2026-02-30','2026-11-05 25:00'])assert.equal(f(value),'дата не распознана');});
