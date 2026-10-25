const amount = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const dateKey = (value) => String(value || "").slice(0, 10);

function validateRateVariants(details = {}) {
  const variants = Array.isArray(details.rate_variants) ? details.rate_variants : [];
  const normalized = variants.map((variant) => ({
    from: dateKey(variant.valid_from) || "0000-01-01",
    to: dateKey(variant.valid_to) || "9999-12-31",
    min: Math.max(1, amount(variant.min_guests, 1)),
    max: amount(variant.max_guests) > 0 ? amount(variant.max_guests) : Infinity,
    price: amount(variant.price),
    audience: String(variant.resident_type || "all").toLowerCase(),
  }));
  for (const variant of normalized) {
    if (variant.price <= 0) return "rate_variant_price_invalid";
    if (variant.from > variant.to) return "rate_variant_dates_invalid";
    if (variant.min > variant.max) return "rate_variant_guests_invalid";
  }
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const dateOverlap = normalized[left].from <= normalized[right].to && normalized[right].from <= normalized[left].to;
      const guestOverlap = normalized[left].min <= normalized[right].max && normalized[right].min <= normalized[left].max;
      const audienceOverlap = normalized[left].audience === "all" || normalized[right].audience === "all" || normalized[left].audience === normalized[right].audience;
      if (dateOverlap && guestOverlap && audienceOverlap) return "rate_variants_overlap";
    }
  }
  return null;
}

function selectRateVariant(details = {}, date, pax, residentType = "nrs") {
  const targetDate = dateKey(date);
  const guests = Math.max(1, amount(pax, 1));
  return (Array.isArray(details.rate_variants) ? details.rate_variants : [])
    .filter((variant) => {
      const from = dateKey(variant.valid_from);
      const to = dateKey(variant.valid_to);
      const min = Math.max(1, amount(variant.min_guests, 1));
      const max = amount(variant.max_guests) > 0 ? amount(variant.max_guests) : Infinity;
      const audience = String(variant.resident_type || "all").toLowerCase();
      return amount(variant.price) > 0
        && (audience === "all" || audience === residentType)
        && (!from || targetDate >= from)
        && (!to || targetDate <= to)
        && guests >= min
        && guests <= max;
    })
    .sort((a, b) => amount(b.min_guests, 1) - amount(a.min_guests, 1))[0] || null;
}

function durationForDate(timeSlots = [], date) {
  return timeSlots.filter((slot) => dateKey(slot.date) === dateKey(date)).reduce((total, slot) => {
    const [startHour, startMinute] = String(slot.start_time || "").split(":").map(Number);
    const [endHour, endMinute] = String(slot.end_time || "").split(":").map(Number);
    const minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    return total + (Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0);
  }, 0);
}

function priceForDate(service, date, pax, timeSlots = [], residentType = "nrs") {
  const details = service?.details || {};
  const variant = selectRateVariant(details, date, pax, residentType);
  const basePrice = amount(variant?.price, amount(service?.price));
  const mode = String(details.pricing_mode || "fixed").toLowerCase();
  const hours = Math.max(amount(details.minimum_hours, 1), durationForDate(timeSlots, date));
  if (mode === "hourly") return { amount: basePrice * Math.max(hours, 1), unitAmount: basePrice, variant };
  if (mode === "packages") {
    const halfHours = Math.max(1, amount(details.half_day_hours, 4));
    const fullHours = Math.max(halfHours, amount(details.full_day_hours, 8));
    const halfPrice = amount(details.half_day_price, basePrice);
    const fullPrice = amount(details.full_day_price, halfPrice || basePrice);
    const extraHourPrice = amount(details.extra_hour_price, basePrice);
    if (hours <= halfHours) return { amount: halfPrice, unitAmount: halfPrice, variant: null };
    if (hours <= fullHours) return { amount: fullPrice, unitAmount: fullPrice, variant: null };
    return { amount: fullPrice + (hours - fullHours) * extraHourPrice, unitAmount: fullPrice, variant: null };
  }
  return { amount: basePrice, unitAmount: basePrice, variant };
}

function quoteProviderService({ service, dates = [], pax = 1, timeSlots = [], residentType = "nrs" }) {
  const uniqueDates = [...new Set(dates.map(dateKey).filter(Boolean))].sort();
  const breakdown = uniqueDates.map((date) => ({ date, ...priceForDate(service, date, pax, timeSlots, residentType) }));
  return {
    amount: breakdown.reduce((total, item) => total + item.amount, 0),
    unitAmount: breakdown[0]?.unitAmount || amount(service?.price),
    units: uniqueDates.length,
    breakdown: breakdown.map((item) => ({ date: item.date, amount: item.amount, unit_amount: item.unitAmount, variant_id: item.variant?.id || null, resident_type: residentType })),
  };
}

module.exports = { selectRateVariant, priceForDate, quoteProviderService, validateRateVariants };
