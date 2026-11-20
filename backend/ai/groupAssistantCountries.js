// 22 Arab League countries, UN ESCWA IAR 2023 endnotes:
// https://publications.unescwa.org/2023/iar-2023/sdgs/pdf/en/Endnotes.pdf
const ARAB_GROUPS = [
 ['Алжир','Algeria','Jazoir','DZ'],['Бахрейн','Bahrain','Bahrayn','BH'],
 ['Коморские острова','Коморы','Comoros','Komor orollari','KM'],['Джибути','Djibouti','Jibuti','DJ'],
 ['Египет','Egypt','Egipt','Misr','EG'],['Ирак','Iraq','Iroq','IQ'],['Иордания','Jordan','Iordaniya','JO'],
 ['Кувейт','Kuwait','Quvayt','KW'],['Ливан','Lebanon','Livan','LB'],['Ливия','Libya','Liviya','LY'],
 ['Мавритания','Mauritania','Mavritaniya','MR'],['Марокко','Morocco','Marokash','MA'],['Оман','Oman','OM'],
 ['Палестина','Palestine','State of Palestine','Falastin','PS'],['Катар','Qatar','QA'],
 ['Саудовская Аравия','Saudi Arabia','Saudi','Saudiya','Saudiya Arabistoni','SA'],
 ['Сомали','Somalia','Somali','SO'],['Судан','Sudan','SD'],['Сирия','Syria','Syrian Arab Republic','Suriya','SY'],
 ['Тунис','Tunisia','Tunis','TN'],['ОАЭ','UAE','U.A.E','United Arab Emirates','Объединённые Арабские Эмираты','Объединенные Арабские Эмираты','Арабские Эмираты','BAA','Birlashgan Arab Amirliklari','AE'],
 ['Йемен','Yemen','Yaman','YE'],
];
const OTHER_GROUPS = [
 ['Турция','Turkey','Türkiye','Turkiye','Turkiya','TR'],['Вьетнам','Vietnam','Viet Nam','Vyetnam','VN'],
 ['Таиланд','Тайланд','Thailand','Tailand','TH'],['Мальдивы','Maldives','Maldiv orollari','MV'],
 ['Шри Ланка','Sri Lanka','Shri Lanka','LK'],['Грузия','Georgia','Gruziya','GE'],
];
const normalizeCountry = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const ARAB_COUNTRY_ALIASES = ARAB_GROUPS.flat();
function excludedCountries(values, excludeArab) {
 const names = new Set((values || []).map(normalizeCountry).filter(Boolean));
 for (const group of [...ARAB_GROUPS, ...OTHER_GROUPS]) if (group.some(name => names.has(normalizeCountry(name)))) for (const name of group) names.add(normalizeCountry(name));
 if (excludeArab) for (const name of ARAB_COUNTRY_ALIASES) names.add(normalizeCountry(name));
 return [...names];
}
module.exports = { ARAB_COUNTRY_ALIASES, normalizeCountry, excludedCountries };
