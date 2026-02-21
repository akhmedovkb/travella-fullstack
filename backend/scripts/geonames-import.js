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

  // ✅ фильтр: если внутри строки есть лишние табы, пытаемся “починить”
  // Правило: в GeoNames должно быть (cols.length - 1) табов.
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

        // если табов больше — заменяем лишние табы на пробел, пока не станет ровно
        if (tabCount > expectedTabs) {
          let parts = line.replace(/\r?\n$/, "").split("\t");
          // склеиваем хвост лишних колонок обратно в последнюю колонку
          while (parts.length > cols.length) {
            parts[cols.length - 1] =
              parts[cols.length - 1] + " " + parts.pop();
          }
          const repaired = parts.join("\t") + "\n";
          const repairedTabs = (repaired.match(/\t/g) || []).length;

          if (repairedTabs === expectedTabs) {
            fixed++;
            this.push(repaired);
          } else {
            skipped++;
            // пропускаем совсем битую строку
          }
          continue;
        }

        // если табов меньше — пропускаем (крайне редко)
        skipped++;
      }
      cb();
    },
    flush(cb) {
      if (buf) {
        // последняя строка без \n
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

  // raw allCountries
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

  // raw alternateNames (берём только первые 8 колонок, без from/to)
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

  // 🔥 скачиваем напрямую с GeoNames
  await download(
    "https://download.geonames.org/export/dump/cities15000.zip", allZip    
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
