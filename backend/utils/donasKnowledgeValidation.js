const KINDS = ['business-concept', 'product-bible'];
const STATUSES = ['draft', 'rd', 'approved'];
function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`Некорректное поле: ${name}`);
  return value.trim();
}
function validateVersion(body) {
  if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw invalid('Укажите текущую ревизию');
  if (!STATUSES.includes(body.status)) throw invalid('Некорректный статус');
  if (!Array.isArray(body.sections) || !body.sections.length || body.sections.length > 40) throw invalid('Требуется от 1 до 40 разделов');
  const keys = new Set();
  const sections = body.sections.map(s => {
    if (!s || typeof s !== 'object') throw invalid('Некорректный раздел');
    const key = text(s.key, 'ключ раздела', 80);
    if (!/^[a-z0-9-]+$/.test(key) || keys.has(key)) throw invalid('Ключи разделов должны быть уникальными');
    keys.add(key);
    if (!STATUSES.includes(s.status)) throw invalid('Некорректный статус раздела');
    return { key, title: text(s.title, 'название раздела', 200), content: text(s.content, 'содержание', 30000), status: s.status };
  });
  if (body.status === 'approved' && sections.some(s => s.status !== 'approved')) throw invalid('Сначала утвердите каждый раздел');
  const result = {
    expectedRevision: body.expectedRevision, title: text(body.title, 'название', 200),
    edition: text(body.edition, 'версия', 40), status: body.status, sections,
    change_note: text(body.change_note, 'описание изменений', 1000),
  };
  if (JSON.stringify(result).length > 250000) throw invalid('Документ слишком большой');
  return result;
}
module.exports = { KINDS, STATUSES, invalid, validateVersion };
