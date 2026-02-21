// backend/scripts/airport-cities-enrich.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const unzipper = require("unzipper");
const readline = require("readline");
const { Client } = require("pg");

const TMP = process.env.GEONAMES_TMP || "/tmp/geonames_airports";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log("↓ downloading", url);
    const req = https.get(url, (res) => {
      // follow redirects (301/302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode} ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", reject);
  });
}

async function unzipToTxt(zipPath, outDir) {
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: outDir })).promise();

  const files = await fs.promises.readdir(outDir);
  const txt = files.find((f) => f.endsWith(".txt"));
  if (!txt) throw new Error("TXT not found after unzip: " + zipPath);
  return path.join(outDir, txt);
}

function toInt(x) {
  const n = Number(String(x || "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toFloat(x) {
  const n = Number(String(x || "").trim());
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const db = new Client({
    connectionString: DATABASE_URL,
    keepAlive: true,
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 30000,
  });
  await db.connect();

  // 1) берём нужные geoname_id из airport_cities
  const idsRes = await db.query(`SELECT geoname_id FROM airport_cities WHERE geoname_id IS NOT NULL`);
  const neededIds = new Set(idsRes.rows.map((r) => String(r.geoname_id)));
  console.log("airport_cities rows:", neededIds.size);

  if (neededIds.size === 0) {
    console.log("Nothing to enrich: airport_cities has 0 geoname_id");
    await db.end();
    return;
  }

  await fs.promises.mkdir(TMP, { recursive: true });

  const citiesZip = path.join(TMP, "cities15000.zip");
  const altZip = path.join(TMP, "alternateNamesV2.zip");

  // 2) качаем датасеты
  await download("https://download.geonames.org/export/dump/cities15000.zip", citiesZip);
  await download("https://download.geonames.org/export/dump/alternateNamesV2.zip", altZip);

  const citiesTxt = await unzipToTxt(citiesZip, path.join(TMP, "cities"));
  const altTxt = await unzipToTxt(altZip, path.join(TMP, "alt"));

  // 3) парсим cities15000: country_code + population + name/ascii
  // Формат GeoNames: geonameid, name, asciiname, alternatenames, lat, lon, feature class, feature code, country, cc2, admin1..4, population, elevation, dem, timezone, modification date
  const cityMeta = new Map(); // id -> { name_en, country_code, population }
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(citiesTxt, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    let cnt = 0;
    for await (const line of rl) {
      if (!line) continue;
      const parts = line.split("\t");
      const id = parts[0];
      if (!neededIds.has(id)) continue;

      const name = parts[1] || null;
      const country = parts[8] || null;
      const pop = toInt(parts[14]);

      cityMeta.set(id, { name_en: name, country_code: country, population: pop });
      cnt++;
    }
    console.log("matched in cities15000:", cnt);
  }

  // 4) парсим alternateNamesV2: выбираем лучшие ru/uz для нужных geoname_id
  // Формат (V2): altNameId, geonameid, isolanguage, alternate name, isPreferredName, isShortName, isColloquial, isHistoric, from, to
  const bestRu = new Map(); // id -> { name, score }
  const bestUz = new Map();
  function scoreAlt(isPref, isShort) {
    // предпочитаем preferred, потом short, потом просто первое
    return (isPref === "1" ? 10 : 0) + (isShort === "1" ? 1 : 0);
  }

  {
    const rl = readline.createInterface({
      input: fs.createReadStream(altTxt, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    let scanned = 0;
    let picked = 0;

    for await (const line of rl) {
      scanned++;
      if (!line) continue;

      const p = line.split("\t");
      // safety
      if (p.length < 8) continue;

      const geonameId = p[1];
      if (!neededIds.has(geonameId)) continue;

      const lang = (p[2] || "").toLowerCase(); // 'ru', 'uz', ...
      if (lang !== "ru" && lang !== "uz") continue;

      const altName = p[3] || "";
      if (!altName.trim()) continue;

      const isPref = p[4] || "0";
      const isShort = p[5] || "0";
      const sc = scoreAlt(isPref, isShort);

      const map = lang === "ru" ? bestRu : bestUz;
      const prev = map.get(geonameId);
      if (!prev || sc > prev.score) {
        map.set(geonameId, { name: altName.trim(), score: sc });
      }
      picked++;
    }

    console.log("altNames scanned:", scanned, "picked ru/uz:", picked);
  }

  // 5) апдейтим airport_cities пачками
  const rows = [];
  for (const id of neededIds) {
    const meta = cityMeta.get(id) || {};
    const ru = bestRu.get(id)?.name ?? null;
    const uz = bestUz.get(id)?.name ?? null;

    // если вообще ничего нет — можно пропустить
    if (!meta.country_code && !meta.population && !ru && !uz) continue;

    rows.push({
      geoname_id: id,
      country_code: meta.country_code ?? null,
      population: meta.population ?? null,
      name_ru: ru,
      name_uz: uz,
    });
  }

  console.log("to update:", rows.length);

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    // VALUES list
    const values = [];
    const params = [];
    let k = 1;
    for (const r of chunk) {
      values.push(`($${k++}::bigint,$${k++}::text,$${k++}::bigint,$${k++}::text,$${k++}::text)`);
      params.push(r.geoname_id, r.country_code, r.population, r.name_ru, r.name_uz);
    }

    await db.query(
      `
      UPDATE airport_cities ac
      SET
        country_code = COALESCE(v.country_code, ac.country_code),
        population = COALESCE(v.population, ac.population),
        name_ru = COALESCE(v.name_ru, ac.name_ru),
        name_uz = COALESCE(v.name_uz, ac.name_uz)
      FROM (VALUES ${values.join(",")})
        AS v(geoname_id, country_code, population, name_ru, name_uz)
      WHERE ac.geoname_id = v.geoname_id
      `,
      params
    );
  }

  // 6) пересобираем search_text (чтобы поиск работал по en/ru/uz + iata)
  await db.query(`
    UPDATE airport_cities
    SET search_text = lower(concat_ws(' | ',
      NULLIF(trim(name_en), ''),
      NULLIF(trim(name_ru), ''),
      NULLIF(trim(name_uz), ''),
      NULLIF(trim(country_code), ''),
      array_to_string(iata_codes, ' ')
    ));
  `);

  console.log("✅ airport_cities enrich DONE");
  await db.end();
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e);
  process.exit(1);
});
