// backend/scripts/airport-cities-import.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const unzipper = require("unzipper");
const readline = require("readline");
const { Client } = require("pg");

const TMP = process.env.TMPDIR || process.env.TEMP || "/tmp";
const WORKDIR = path.join(TMP, "travella-airport-cities");

function mkdirp(p) {
  return fs.promises.mkdir(p, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log("↓ downloading", url);
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => reject(err));
  });
}

// minimal CSV parser that supports quotes
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normCity(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/[().,'"]/g, "")
    .trim();
}

function slugify(s) {
  return normCity(s)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-а-яёқғҳў]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function streamZipTxt(zipPath, wantFileName) {
  // returns a readable stream for a file inside zip
  const zip = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    const name = entry.path;
    if (name === wantFileName) return entry;
    entry.autodrain();
  }
  throw new Error(`File ${wantFileName} not found in zip ${zipPath}`);
}

async function ensureSchema(db) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS airport_cities (
      geoname_id BIGINT PRIMARY KEY,
      slug TEXT UNIQUE,
      country_code TEXT,
      name_en TEXT,
      name_ru TEXT,
      name_uz TEXT,
      iata_codes TEXT[],
      population BIGINT,
      search_text TEXT
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS airport_cities_search_trgm
      ON airport_cities USING gin (search_text gin_trgm_ops);
  `);
}

async function loadAirportCityKeys(airportsCsvPath) {
  // Use OurAirports airports.csv
  // We keep only rows with iata_code + municipality
  const cityKeys = new Set(); // key = country|cityNorm
  const cityIatas = new Map(); // key -> Set(iata)
  const buf = await fs.promises.readFile(airportsCsvPath, "utf8");
  const lines = buf.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("airports.csv empty");

  const header = parseCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);

  const iIata = idx("iata_code");
  const iMunicipality = idx("municipality");
  const iCountry = idx("iso_country");
  const iType = idx("type");
  const iScheduled = idx("scheduled_service");

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const iata = String(cols[iIata] || "").trim().toUpperCase();
    const city = String(cols[iMunicipality] || "").trim();
    const cc = String(cols[iCountry] || "").trim().toUpperCase();
    const type = String(cols[iType] || "").trim();
    const scheduled = String(cols[iScheduled] || "").trim().toLowerCase();

    if (!iata || iata.length !== 3) continue;
    if (!city || !cc) continue;

    // keep airports that likely matter (can adjust)
    const okType =
      type === "large_airport" || type === "medium_airport" || type === "small_airport";
    if (!okType) continue;

    // if you want only scheduled_service = "yes" uncomment:
    // if (scheduled !== "yes") continue;

    const key = `${cc}|${normCity(city)}`;
    cityKeys.add(key);
    if (!cityIatas.has(key)) cityIatas.set(key, new Set());
    cityIatas.get(key).add(iata);
  }

  console.log("✓ airport city keys:", cityKeys.size);
  return { cityKeys, cityIatas };
}

async function mapCitiesToGeonames(cities15000ZipPath, cityKeys, cityIatas) {
  // cities15000.zip contains cities15000.txt (same columns as allCountries)
  const stream = await streamZipTxt(cities15000ZipPath, "cities15000.txt");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const picked = new Map(); // geoname_id -> city row
  // also keep reverse key->geoname_id for matching best
  const keyToGeo = new Map();

  for await (const line of rl) {
    // tab separated, 19 cols
    const p = line.split("\t");
    if (p.length < 19) continue;

    const geonameid = Number(p[0]);
    const name = p[1];
    const asciiname = p[2];
    const alternatenames = p[3] || "";
    const lat = p[4];
    const lon = p[5];
    const featureClass = p[6];
    const featureCode = p[7];
    const countryCode = (p[8] || "").toUpperCase();
    const admin1 = p[10] || "";
    const population = Number(p[14] || 0);
    const timezone = p[17] || "";
    const modDt = p[18] || "";

    // cities15000 is already populated places, but keep safe:
    if (featureClass !== "P") continue;

    const key1 = `${countryCode}|${normCity(asciiname)}`;
    const key2 = `${countryCode}|${normCity(name)}`;

    let key = null;
    if (cityKeys.has(key1)) key = key1;
    else if (cityKeys.has(key2)) key = key2;
    else continue;

    // if multiple, keep the one with larger population
    const prevGeo = keyToGeo.get(key);
    if (prevGeo) {
      const prev = picked.get(prevGeo);
      if (prev && prev.population >= population) continue;
      picked.delete(prevGeo);
    }

    keyToGeo.set(key, geonameid);
    picked.set(geonameid, {
      geoname_id: geonameid,
      country_code: countryCode,
      name_en: asciiname || name,
      population: Number.isFinite(population) ? population : 0,
      iata_codes: Array.from(cityIatas.get(key) || []),
      // keep alternatenames for search_text too
      alternatenames,
    });
  }

  console.log("✓ matched cities15000 to airport cities:", picked.size);
  return picked;
}

async function loadRuUzAltNames(alternateNamesZipPath, targetGeonameIds) {
  // alternateNamesV2.zip contains alternateNamesV2.txt
  const stream = await streamZipTxt(alternateNamesZipPath, "alternateNamesV2.txt");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const ru = new Map(); // geoname_id -> best ru name
  const uz = new Map(); // geoname_id -> best uz name
  const ruPref = new Set();
  const uzPref = new Set();

  for await (const line of rl) {
    // columns: altId, geonameId, isoLang, altName, isPreferred, isShort, isColloquial, isHistoric, from, to
    const p = line.split("\t");
    if (p.length < 4) continue;

    const geonameId = Number(p[1]);
    if (!targetGeonameIds.has(geonameId)) continue;

    const lang = String(p[2] || "").trim().toLowerCase();
    if (!lang) continue;

    const altName = String(p[3] || "").trim();
    if (!altName) continue;

    const isPreferred = String(p[4] || "").trim() === "1";

    if (lang === "ru") {
      if (isPreferred) {
        if (!ruPref.has(geonameId)) {
          ru.set(geonameId, altName);
          ruPref.add(geonameId);
        }
      } else if (!ru.has(geonameId)) {
        ru.set(geonameId, altName);
      }
    } else if (lang === "uz" || lang.startsWith("uz")) {
      if (isPreferred) {
        if (!uzPref.has(geonameId)) {
          uz.set(geonameId, altName);
          uzPref.add(geonameId);
        }
      } else if (!uz.has(geonameId)) {
        uz.set(geonameId, altName);
      }
    }
  }

  console.log("✓ RU names:", ru.size, "✓ UZ names:", uz.size);
  return { ru, uz };
}

async function upsertAirportCities(db, picked, ru, uz) {
  // one transaction, batched inserts
  const rows = Array.from(picked.values()).map((c) => {
    const nameRu = ru.get(c.geoname_id) || null;
    const nameUz = uz.get(c.geoname_id) || null;

    const slug = slugify(`${c.country_code}-${c.name_en}`);
    const iatas = c.iata_codes && c.iata_codes.length ? c.iata_codes : [];
    const searchText = [
      c.name_en,
      nameRu,
      nameUz,
      c.country_code,
      ...iatas,
      c.alternatenames,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      geoname_id: c.geoname_id,
      slug,
      country_code: c.country_code,
      name_en: c.name_en,
      name_ru: nameRu,
      name_uz: nameUz,
      iata_codes: iatas,
      population: c.population || 0,
      search_text: searchText,
    };
  });

  console.log("→ upsert rows:", rows.length);

  await db.query("BEGIN");
  try {
    // optional: clear old dataset if you want full refresh
    await db.query("TRUNCATE airport_cities");

    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);

      const values = [];
      const params = [];
      let k = 1;

      for (const r of part) {
        values.push(
          `($${k++},$${k++},$${k++},$${k++},$${k++},$${k++},$${k++},$${k++},$${k++})`
        );
        params.push(
          r.geoname_id,
          r.slug,
          r.country_code,
          r.name_en,
          r.name_ru,
          r.name_uz,
          r.iata_codes,
          r.population,
          r.search_text
        );
      }

      await db.query(
        `
        INSERT INTO airport_cities
          (geoname_id, slug, country_code, name_en, name_ru, name_uz, iata_codes, population, search_text)
        VALUES ${values.join(",")}
        ON CONFLICT (geoname_id) DO UPDATE SET
          slug = EXCLUDED.slug,
          country_code = EXCLUDED.country_code,
          name_en = EXCLUDED.name_en,
          name_ru = EXCLUDED.name_ru,
          name_uz = EXCLUDED.name_uz,
          iata_codes = EXCLUDED.iata_codes,
          population = EXCLUDED.population,
          search_text = EXCLUDED.search_text
        `,
        params
      );
    }

    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

  await mkdirp(WORKDIR);

  const airportsCsv = path.join(WORKDIR, "airports.csv");
  const citiesZip = path.join(WORKDIR, "cities15000.zip");
  const altZip = path.join(WORKDIR, "alternateNamesV2.zip");

  // Sources
  await download("https://ourairports.com/data/airports.csv", airportsCsv);
  await download("https://download.geonames.org/export/dump/cities15000.zip", citiesZip);
  await download("https://download.geonames.org/export/dump/alternateNamesV2.zip", altZip);

  const db = new Client({
    connectionString: DATABASE_URL,
    keepAlive: true,
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 30000,
  });
  await db.connect();

  await ensureSchema(db);

  const { cityKeys, cityIatas } = await loadAirportCityKeys(airportsCsv);
  const picked = await mapCitiesToGeonames(citiesZip, cityKeys, cityIatas);

  const targetIds = new Set(picked.keys());
  const { ru, uz } = await loadRuUzAltNames(altZip, targetIds);

  await upsertAirportCities(db, picked, ru, uz);

  console.log("🎉 DONE: airport_cities imported");
  await db.end();
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e);
  process.exit(1);
});
