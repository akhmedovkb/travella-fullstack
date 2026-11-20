// Local detection only: ordinary group messages are never sent to the model here.
const { redactQuestion } = require('./groupAssistantModel');
function isTourRequest(text) {
  const value = String(text || '').trim();
  if (value.length < 12 || value.length > 1500 || /^\//.test(value)) return false;
  const seeking = /у\s*кого\s*есть|есть\s*ли|кто\s*(?:может|подбер)|ищ[уе]|нуж[ен]|подбер|посовет|керак|кере|kerak|kere|bormi|qidir|looking\s*for|anyone|need/i.test(value);
  const travel = /тур|отказ|попут|билет|отел|вылет|поездк|авиа|hotel|tour|flight|hamroh|putyovka/i.test(value);
  return seeking && travel;
}
function isClarification(text) {
  return /бюджет|доллар|usd|eur|uzs|\$|на двоих|на троих|вдво[её]м|неважно|без разниц|разницы нет|кроме|исключ|завтра|послезавтра|куда угодно|farqi\s*yo|budjet|tashqari|except|anywhere|per person|two people|за одного|за весь/i.test(String(text || ''));
}
function appendAutoText(entry, text, messageId) {
  if (entry.messageIds.includes(messageId)) return;
  entry.messageIds.push(messageId);
  entry.texts.push(redactQuestion(text));
  while (entry.texts.length > 6 || entry.texts.join('\n').length > 1500) { entry.texts.splice(1, 1); entry.messageIds.splice(1, 1); }
  entry.revision++;
}
module.exports = { isTourRequest, isClarification, appendAutoText };
