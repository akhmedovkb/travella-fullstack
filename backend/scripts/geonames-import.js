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
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error("Download failed: " + res.statusCode));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

async function unzip(zipPath, outDir) {
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: outDir }))
    .promise();

  const files = await fs.promises.readdir(outDir);
  const txt = files.find((f) => f.endsWith(".txt"));
  if (!txt) throw new Error("TXT not found after unzip");

  return path.join(outDir, txt);
}

async function copyFile(client, table, cols, filePath) {
  console.log("COPY →", table);
  await client.query(`TRUNCATE ${table}`);

  const stream = client.query(
    copyFrom(
      `COPY ${table} (${cols.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', NULL '')`
    )
  );

  await pipeline(fs.createReadStream(filePath), stream);
  console.log("✓ COPY done:", table);
}

async function ensureSchema(db) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_altnames_raw (
      alt_id BIGINT,
      geoname_id BIGINT,
      iso_language TEXT,
      alt_name TEXT,
      is_preferred SMALLINT,
      is_short SMALLINT,
      is_colloquial SMALLINT,
      is_historic SMALLINT,
      "from" TEXT,
      "to" TEXT
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

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  await fs.promises.mkdir(TMP, { recursive: true });

  const allZip = path.join(TMP, "allCountries.zip");
  const altZip = path.join(TMP, "alternateNamesV2.zip");

  // 🔥 скачиваем напрямую с GeoNames
  await download(
    "https://download.geonames.org/export/dump/allCountries.zip",
    allZip
  );

  await download(
    "https://download.geonames.org/export/dump/alternateNamesV2.zip",
    altZip
  );

  const allTxt = await unzip(allZip, path.join(TMP, "all"));
  const altTxt = await unzip(altZip, path.join(TMP, "alt"));

  await ensureSchema(db);

  // raw import
  await copyFile(
    db,
    "geo_allcountries_raw",
    [
      "geonameid","name","asciiname","alternatenames","latitude","longitude",
      "feature_class","feature_code","country_code","cc2","admin1_code",
      "admin2_code","admin3_code","admin4_code","population","elevation",
      "dem","timezone","modification_dt",
    ],
    allTxt
  );

  await copyFile(
    db,
    "geo_altnames_raw",
    [
      "alt_id","geoname_id","iso_language","alt_name",
      "is_preferred","is_short","is_colloquial","is_historic","from","to"
    ],
    altTxt
  );

  // только населённые пункты
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
    WHERE feature_class = 'P'
    ON CONFLICT (geoname_id) DO NOTHING;
  `);

  console.log("🎉 GeoNames import DONE");
  await db.end();
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e);
  process.exit(1);
});
