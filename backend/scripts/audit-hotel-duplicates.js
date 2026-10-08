const { areLikelySameHotel, normalizeHotelIdentityPart } = require('../utils/hotelIdentity');

const BASE_URL = String(process.env.TRAVELLA_PUBLIC_URL || 'https://travella.uz').replace(/\/$/, '');

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

function similarity(left, right) {
  const length = Math.max(left.length, right.length);
  return length ? 1 - editDistance(left, right) / length : 1;
}

async function main() {
  const first = await getJson('/api/hotels/search?format=paged&page=1&limit=50&ext=0');
  const pages = Number(first.pagination?.pages || 1);
  const items = [...(first.items || [])];
  for (let page = 2; page <= pages; page += 1) {
    const data = await getJson(`/api/hotels/search?format=paged&page=${page}&limit=50&ext=0`);
    items.push(...(data.items || []));
  }

  const normalized = items.map((hotel) => ({
    hotel,
    name: normalizeHotelIdentityPart(hotel.name, { stripRating: true }),
    city: normalizeHotelIdentityPart(hotel.city),
  }));
  const candidatePairs = [];
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left];
      const b = normalized[right];
      const sameName = a.name && a.name === b.name;
      const closeNameInSameCity = a.city && a.city === b.city
        && Math.min(a.name.length, b.name.length) >= 6
        && similarity(a.name, b.name) >= 0.88;
      if (sameName || closeNameInSameCity) {
        candidatePairs.push({ left: a.hotel, right: b.hotel, reason: sameName ? 'same_name' : 'similar_name_same_city' });
      }
    }
  }

  const candidateIds = [...new Set(candidatePairs.flatMap((pair) => [pair.left.id, pair.right.id]))];
  const hotelDetails = new Map((await Promise.all(candidateIds.map((id) => getJson(`/api/hotels/${id}`))))
    .map((hotel) => [Number(hotel.id), hotel]));
  const detailed = [];
  for (const candidate of candidatePairs) {
    const left = hotelDetails.get(Number(candidate.left.id));
    const right = hotelDetails.get(Number(candidate.right.id));
    detailed.push({
      ids: [left.id, right.id],
      reason: candidate.reason,
      likely_same: areLikelySameHotel(left, right),
      name_similarity: Number(similarity(normalizeHotelIdentityPart(left.name, { stripRating: true }), normalizeHotelIdentityPart(right.name, { stripRating: true })).toFixed(3)),
      names: [left.name, right.name],
      cities: [left.city || left.location, right.city || right.location],
      addresses: [left.address || null, right.address || null],
      providers: [left.provider_id || null, right.provider_id || null],
    });
  }

  console.log(JSON.stringify({
    scanned: items.length,
    candidate_pairs: detailed.length,
    likely_duplicate_pairs: detailed.filter((pair) => pair.likely_same),
    review_pairs: detailed.filter((pair) => !pair.likely_same),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
