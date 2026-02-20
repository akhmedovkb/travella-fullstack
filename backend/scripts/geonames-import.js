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
  return path.join(outDir, txt);
}

async function copyFile(client, table, cols, filePath) {
  console.log("COPY →", table);
  await client.query(`TRUNCATE ${table}`);
  const stream = client.query(
    copyFrom(`COPY ${table} (${cols.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', NULL '')`)
  );
  await pipeline(fs.createReadStream(filePath), stream);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  await fs.promises.mkdir(TMP, { recursive: true });

  // === скачиваем напрямую ===
  const allZip = path.join(TMP, "allCountries.zip");
  const altZip = path.join(TMP, "alternateNamesV2.zip");

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

  console.log("✅ Files ready");

  // дальше — COPY как мы делали
  // (если хочешь — я пришлю полный production вариант)

  await db.end();
  console.log("🎉 Import finished");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
