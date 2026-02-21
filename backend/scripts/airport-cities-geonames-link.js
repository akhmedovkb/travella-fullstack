// backend/scripts/airport-cities-geonames-link.js
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
      // redirects
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

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019\u2018']/g, "")     // апострофы
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, " ") // латиница+кириллица+цифры
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(x) {
  const n = Number(String(x || "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
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

  // берём текущие города из airport_cities
  const acRes = await db.query(`
    SELECT slug, name_en, country_code, geoname_id
    FROM airport_cities
  `);

  const rows = acRes.rows;
  console.log("airport_cities total:", rows.length);

  // отберём только те, где нет geoname_id
  const need = rows.filter((r) => !r.geoname_id);
  console.log("need geoname_id:", need.length);

  if (need.length === 0) {
    console.log("✅ Nothing to link: all rows already have geoname_id");
    await db.end();
    return;
  }

  // качаем cities15000
  await fs.promises.mkdir(TMP, { recursive: true });
  const citiesZip = path.join(TMP, "cities15000.zip");
  await download("https://download.geonames.org/export/dump/cities15000.zip", citiesZip);
  const citiesTxt = await unzipToTxt(citiesZip, path.join(TMP, "cities"));

  // строим map: (country|norm(name)) -> best {id, population}
  // (берём самый “крупный” по population, если несколько совпадений)
  const wantSet = new Set(
    need.map((r) => `${String(r.country_code || "").toUpperCase()}|${normName(r.name_en)}`)
  );

  const best = new Map(); // key -> { geonameid, population }
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(citiesTxt, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    let matched = 0;
    for await (const line of rl) {
      if (!line) continue;
      const p = line.split("\t");
      // GeoNames cities15000.txt:
      // 0 geonameid
      // 1 name
      // 2 asciiname
      // 8 country_code
      // 14 population
      const geonameid = p[0];
      const name = p[1];
      const asciiname = p[2];
      const country = String(p[8] || "").toUpperCase();
      const pop = toInt(p[14]);

      // пробуем по name и по asciiname
      const key1 = `${country}|${normName(name)}`;
      const key2 = `${country}|${normName(asciiname)}`;

      const checkKey = (k) => {
        if (!wantSet.has(k)) return;
        const prev = best.get(k);
        if (!prev || (pop ?? 0) > (prev.population ?? 0)) {
          best.set(k, { geonameid: toInt(geonameid), population: pop });
        }
        matched++;
      };

      checkKey(key1);
      if (key2 !== key1) checkKey(key2);
    }
    console.log("cities15000 potential matches:", matched);
  }

  // обновляем airport_cities пачками
  const updates = [];
  for (const r of need) {
    const key = `${String(r.country_code || "").toUpperCase()}|${normName(r.name_en)}`;
    const hit = best.get(key);
    if (!hit?.geonameid) continue;
    updates.push({
      slug: r.slug,
      geoname_id: hit.geonameid,
      population: hit.population,
    });
  }

  console.log("linked rows:", updates.length);

  const chunkSize = 500;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);

    const values = [];
    const params = [];
    let k = 1;
    for (const u of chunk) {
      values.push(`($${k++}::text,$${k++}::bigint,$${k++}::bigint)`);
      params.push(u.slug, u.geoname_id, u.population);
    }

    await db.query(
      `
      UPDATE airport_cities ac
      SET
        geoname_id = v.geoname_id,
        population = COALESCE(v.population, ac.population)
      FROM (VALUES ${values.join(",")})
        AS v(slug, geoname_id, population)
      WHERE ac.slug = v.slug
      `,
      params
    );
  }

  // пересоберём search_text (пока без ru/uz — они появятся после enrich)
  await db.query(`
    UPDATE airport_cities
    SET search_text = lower(concat_ws(' | ',
      NULLIF(trim(name_en), ''),
      NULLIF(trim(country_code), ''),
      array_to_string(iata_codes, ' ')
    ));
  `);

  console.log("✅ geoname link DONE");
  await db.end();
}

main().catch((e) => {
  console.error("LINK FAILED:", e);
  process.exit(1);
});
