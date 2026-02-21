// backend/scripts/geonames-import.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const unzipper = require("unzipper");
const { Client } = require("pg");
const { from: copyFrom } = require("pg-copy-streams");
const { pipeline } = require("stream/promises");

const TMP = "/tmp/geonames";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log("↓ downloading", url);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error("Download failed: " + res.statusCode));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function unzip(zipPath, outDir) {
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: outDir })).promise();

  const files = await fs.promises.readdir(outDir);
  const txt = files.find((f) => f.endsWith(".txt"));
  if (!txt) throw new Error("TXT not found after unzip");
  return path.join(outDir, txt);
}

async function copyFile(client, table, cols, filePath) {
  console.log("COPY →", table);
  await client.query(`TRUNCATE ${table}`);

  const copySql = `COPY ${table} (${cols.join(",")})
    FROM STDIN WITH (
      FORMAT csv,
      DELIMITER E'\\t',
      NULL '',
      QUOTE E'\\b',
      ESCAPE E'\\b'
    )`;

  const stream = client.query(copyFrom(copySql));
  stream.on("error", (err) => {
    // чтобы не было Unhandled 'error' event
    console.error("COPY stream error:", err?.message || err);
  });

  // ожидаем табов = кол-во колонок - 1
  const expectedTabs = cols.length - 1;

  const { Transform } = require("stream");
  let buf = "";
  let fixed = 0;
  let skipped = 0;

  const fixer = new Transform({
    transform(chunk, enc, cb) {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx + 1);
        buf = buf.slice(idx + 1);

        const tabCount = (line.match(/\t/g) || []).length;
        if (tabCount === expectedTabs) {
          this.push(line);
          continue;
        }

        if (tabCount > expectedTabs) {
          let parts = line.replace(/\r?\n$/, "").split("\t");
          while (parts.length > cols.length) {
            parts[cols.length - 1] = parts[cols.length - 1] + " " + parts.pop();
          }
          const repaired = parts.join("\t") + "\n";
          const repairedTabs = (repaired.match(/\t/g) || []).length;
          if (repairedTabs === expectedTabs) {
            fixed++;
            this.push(repaired);
          } else {
            skipped++;
          }
          continue;
        }

        // tabCount < expectedTabs
        skipped++;
      }
      cb();
    },
    flush(cb) {
      if (buf) {
        const line = buf + "\n";
        const tabCount = (line.match(/\t/g) || []).length;
        if (tabCount === expectedTabs) this.push(line);
      }
      cb();
    },
  });

  try {
    await pipeline(fs.createReadStream(filePath), fixer, stream);
  } catch (e) {
    console.error(`COPY FAILED: ${table}`, e?.message || e);
    throw e;
  }

  console.log(`✓ COPY done: ${table} (fixed=${fixed}, skipped=${skipped})`);
}

async function ensureSchema(db) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

  // raw (cities/allCountries)
  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_allcountries_raw (
      geonameid BIGINT,
      name TEXT,
      asciiname TEXT,
      alternatenames TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      feature_class TEXT,
      feature_code TEXT,
      country_code TEXT,
      cc2 TEXT,
      admin1_code TEXT,
      admin2_code TEXT,
      admin3_code TEXT,
      admin4_code TEXT,
      population BIGINT,
      elevation TEXT,
      dem TEXT,
      timezone TEXT,
      modification_dt DATE
    );
  `);

  // raw alternateNames: флаги делаем TEXT (в файле бывают пустые/пробелы)
  await db.query(`
    DROP TABLE IF EXISTS geo_altnames_raw;
    CREATE TABLE geo_altnames_raw (
      alt_id BIGINT,
      geoname_id BIGINT,
      iso_language TEXT,
      alt_name TEXT,
      is_preferred TEXT,
      is_short TEXT,
      is_colloquial TEXT,
      is_historic TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_cities (
      geoname_id BIGINT PRIMARY KEY,
      name TEXT,
      asciiname TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      feature_class TEXT,
      feature_code TEXT,
      country_code TEXT,
      admin1_code TEXT,
      population BIGINT,
      timezone TEXT,
      modification_dt DATE,
      name_ru TEXT,
      name_uz TEXT,
      search_text TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_alt_names (
      alt_id BIGINT PRIMARY KEY,
      geoname_id BIGINT,
      iso_language TEXT,
      alt_name TEXT,
      is_preferred BOOLEAN,
      is_short BOOLEAN,
      is_colloquial BOOLEAN,
      is_historic BOOLEAN
    );
  `);
}

async function createIndexes(db) {
  // индексы для скорости автокомплита
  await db.query(`CREATE INDEX IF NOT EXISTS geo_cities_cc_idx ON geo_cities(country_code);`);
  await db.query(`CREATE INDEX IF NOT EXISTS geo_cities_pop_idx ON geo_cities(population DESC);`);

  // быстрый LIKE/ILIKE/триграмм по search_text
  await db.query(
    `CREATE INDEX IF NOT EXISTS geo_cities_search_trgm_idx ON geo_cities USING gin (search_text gin_trgm_ops);`
  );

  await db.query(`CREATE INDEX IF NOT EXISTS geo_alt_names_gid_idx ON geo_alt_names(geoname_id);`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS geo_alt_names_lang_idx ON geo_alt_names(iso_language);`
  );
}

function boolFromTextExpr(col) {
  // SQL-выражение: пусто/пробел -> 0, иначе int -> boolean
  return `(COALESCE(NULLIF(trim(${col}), ''), '0')::int = 1)`;
}

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    keepAlive: true,
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 30000,
  });
  await db.connect();

  await fs.promises.mkdir(TMP, { recursive: true });

  const allZip = path.join(TMP, "allCountries.zip");
  const altZip = path.join(TMP, "alternateNamesV2.zip");

  // ✅ ВАРИАНТ А (сейчас у тебя так): cities15000 (быстро, но не все города)
  const CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip";

  // ✅ ВАРИАНТ Б (все населённые пункты мира): allCountries (тяжелее)
  // const CITIES_URL = "https://download.geonames.org/export/dump/allCountries.zip";

  await download(CITIES_URL, allZip);
  await download("https://download.geonames.org/export/dump/alternateNamesV2.zip", altZip);

  const allTxt = await unzip(allZip, path.join(TMP, "all"));
  const altTxt = await unzip(altZip, path.join(TMP, "alt"));

  await ensureSchema(db);

  await copyFile(
    db,
    "geo_allcountries_raw",
    [
      "geonameid",
      "name",
      "asciiname",
      "alternatenames",
      "latitude",
      "longitude",
      "feature_class",
      "feature_code",
      "country_code",
      "cc2",
      "admin1_code",
      "admin2_code",
      "admin3_code",
      "admin4_code",
      "population",
      "elevation",
      "dem",
      "timezone",
      "modification_dt",
    ],
    allTxt
  );

  await copyFile(
    db,
    "geo_altnames_raw",
    [
      "alt_id",
      "geoname_id",
      "iso_language",
      "alt_name",
      "is_preferred",
      "is_short",
      "is_colloquial",
      "is_historic",
    ],
    altTxt
  );

  // 1) Нормализуем alt names (важно для ru/uz)
  console.log("BUILD → geo_alt_names");
  await db.query(`TRUNCATE geo_alt_names;`);
  await db.query(`
    INSERT INTO geo_alt_names (
      alt_id, geoname_id, iso_language, alt_name,
      is_preferred, is_short, is_colloquial, is_historic
    )
    SELECT
      alt_id,
      geoname_id,
      iso_language,
      alt_name,
      ${boolFromTextExpr("is_preferred")} AS is_preferred,
      ${boolFromTextExpr("is_short")} AS is_short,
      ${boolFromTextExpr("is_colloquial")} AS is_colloquial,
      ${boolFromTextExpr("is_historic")} AS is_historic
    FROM geo_altnames_raw
    WHERE alt_id IS NOT NULL
    ON CONFLICT (alt_id) DO NOTHING;
  `);

  // 2) Строим cities (только населённые пункты)
  console.log("BUILD → geo_cities");
  await db.query(`TRUNCATE geo_cities;`);
  await db.query(`
    INSERT INTO geo_cities (
      geoname_id, name, asciiname, latitude, longitude,
      feature_class, feature_code, country_code, admin1_code,
      population, timezone, modification_dt, search_text
    )
    SELECT
      geonameid, name, asciiname, latitude, longitude,
      feature_class, feature_code, country_code, admin1_code,
      population, timezone, modification_dt,
      concat_ws(' | ', name, asciiname, alternatenames)
    FROM geo_allcountries_raw
    WHERE feature_class = 'P';
  `);

  // 3) Подтягиваем RU/UZ имена (лучшее по приоритету)
  // RU: iso_language='ru'
  // UZ: в GeoNames чаще всего 'uz', иногда встречаются вариации. Держим основной 'uz'.
  console.log("UPDATE → name_ru/name_uz");

  await db.query(`
    WITH ru_pick AS (
      SELECT DISTINCT ON (geoname_id)
        geoname_id,
        alt_name
      FROM geo_alt_names
      WHERE iso_language = 'ru'
        AND alt_name IS NOT NULL
        AND trim(alt_name) <> ''
        AND NOT is_historic
      ORDER BY geoname_id,
        is_preferred DESC,
        is_short DESC,
        length(alt_name) ASC
    ),
    uz_pick AS (
      SELECT DISTINCT ON (geoname_id)
        geoname_id,
        alt_name
      FROM geo_alt_names
      WHERE iso_language IN ('uz','uzb')
        AND alt_name IS NOT NULL
        AND trim(alt_name) <> ''
        AND NOT is_historic
      ORDER BY geoname_id,
        is_preferred DESC,
        is_short DESC,
        length(alt_name) ASC
    )
    UPDATE geo_cities c
    SET
      name_ru = ru.alt_name,
      name_uz = uz.alt_name,
      search_text = concat_ws(' | ', c.name, c.asciiname, c.search_text, ru.alt_name, uz.alt_name)
    FROM ru_pick ru
    FULL JOIN uz_pick uz ON uz.geoname_id = ru.geoname_id
    WHERE c.geoname_id = COALESCE(ru.geoname_id, uz.geoname_id);
  `);

  await createIndexes(db);

  console.log("🎉 GeoNames import DONE");
  await db.end();
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e);
  process.exit(1);
});
