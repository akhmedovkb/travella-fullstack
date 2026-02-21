// backend/scripts/airport-cities-import.js
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const CSV_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";

function downloadFollow(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doReq = (u, redirectsLeft) => {
      https
        .get(u, (res) => {
          // follow redirects
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            const loc = res.headers.location;
            if (!loc) return reject(new Error(`Redirect without Location for ${u}`));
            if (redirectsLeft <= 0) return reject(new Error(`Too many redirects for ${url}`));
            const next = loc.startsWith("http") ? loc : new URL(loc, u).toString();
            res.resume();
            return doReq(next, redirectsLeft - 1);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed: ${res.statusCode} ${u}`));
          }

          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
          file.on("error", reject);
        })
        .on("error", reject);
    };

    doReq(url, maxRedirects);
  });
}

// минимальный CSV-парсер (под ourairports.csv хватает)
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[’'`"]/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF\u0600-\u06FF\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const tmpDir = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const csvPath = path.join(tmpDir, "airports.csv");

  console.log("↓ downloading", CSV_URL);
  await downloadFollow(CSV_URL, csvPath);

  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);

  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const cityMap = new Map();

  // фильтр: только “реальные” аэропорты с IATA (обычно то что нужно для продаж)
  const allowedTypes = new Set(["large_airport", "medium_airport"]);

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const type = row[idx.type];
    const iata = (row[idx.iata_code] || "").trim();
    const country = (row[idx.iso_country] || "").trim();
    const municipality = (row[idx.municipality] || "").trim();

    if (!allowedTypes.has(type)) continue;
    if (!iata) continue;
    if (!country || !municipality) continue;

    const key = `${country}||${municipality.toLowerCase()}`;
    const existing = cityMap.get(key) || {
      country_code: country,
      name_en: municipality,
      iata_codes: new Set(),
    };
    existing.iata_codes.add(iata);
    cityMap.set(key, existing);
  }

  console.log("✓ cities with airports:", cityMap.size);

  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    keepAlive: true,
    statement_timeout: 0,
    query_timeout: 0,
  });
  await db.connect();

  // чистим таблицу перед импортом (production-safe)
  await db.query("TRUNCATE airport_cities RESTART IDENTITY;");

  for (const it of cityMap.values()) {
    const iatas = Array.from(it.iata_codes).sort();
    const slug = slugify(`${it.country_code}-${it.name_en}`);

    const searchText = [
      it.name_en,
      it.name_ru || "",
      it.name_uz || "",
      it.country_code,
      iatas.join(" "),
    ]
      .join(" | ")
      .toLowerCase();

    await db.query(
      `
      INSERT INTO airport_cities (
        geoname_id, slug, country_code, name_en, name_ru, name_uz,
        iata_codes, population, search_text
      )
      VALUES (NULL, $1, $2, $3, NULL, NULL, $4, NULL, $5)
      ON CONFLICT (slug) DO UPDATE SET
        country_code = EXCLUDED.country_code,
        name_en = EXCLUDED.name_en,
        iata_codes = EXCLUDED.iata_codes,
        search_text = EXCLUDED.search_text
      `,
      [slug, it.country_code, it.name_en, iatas, searchText]
    );
  }

  console.log("🎉 airport_cities import DONE");
  await db.end();
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e);
  process.exit(1);
});
