export function detectSeason(dateISO, seasons, defaultSeason = 'low') {
  // dateISO: 'YYYY-MM-DD'
  const d = new Date(dateISO + 'T00:00:00Z');
  for (const s of seasons) {
    const a = new Date(s.start_date + 'T00:00:00Z');
    const b = new Date(s.end_date   + 'T23:59:59Z'); // включительно
    if (d >= a && d <= b) return s.label; // 'low' | 'high'
  }
  return defaultSeason;
}
