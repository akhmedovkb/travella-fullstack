function normalizeHotelIdentityPart(value, { stripRating = false } = {}) {
  let text = String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').trim();
  if (stripRating) {
    text = text.replace(/\s*[1-5]\s*(?:\*|★|stars?|зв(?:езды?|ёзды?))\s*$/iu, '');
  }
  return text
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function areLikelySameHotel(left = {}, right = {}) {
  const leftName = normalizeHotelIdentityPart(left.name, { stripRating: true });
  const rightName = normalizeHotelIdentityPart(right.name, { stripRating: true });
  if (!leftName || leftName !== rightName) return false;

  const leftCity = normalizeHotelIdentityPart(left.city || left.location);
  const rightCity = normalizeHotelIdentityPart(right.city || right.location);
  const leftCountry = normalizeHotelIdentityPart(left.country);
  const rightCountry = normalizeHotelIdentityPart(right.country);
  const sameCity = !!leftCity && leftCity === rightCity;
  const compatibleCountry = !leftCountry || !rightCountry || leftCountry === rightCountry;

  const leftAddress = normalizeHotelIdentityPart(left.address);
  const rightAddress = normalizeHotelIdentityPart(right.address);
  const sameAddress = !!leftAddress && leftAddress === rightAddress;

  return (sameCity && compatibleCountry) || sameAddress;
}

module.exports = {
  normalizeHotelIdentityPart,
  areLikelySameHotel,
};
