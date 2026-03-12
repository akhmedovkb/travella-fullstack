const DEFAULT_TZ = "Asia/Tashkent";

function getTZParts(date = new Date(), timeZone = DEFAULT_TZ) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const ymd = `${map.year}-${map.month}-${map.day}`;

  return {
    ymd,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

module.exports = {
  DEFAULT_TZ,
  getTZParts,
};
