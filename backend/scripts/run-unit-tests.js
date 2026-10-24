const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testsDir = path.join(__dirname, "..", "tests");
const excluded = new Set(["paymeMerchant.test.js"]);
const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js") && !excluded.has(name))
  .sort()
  .map((name) => path.join(testsDir, name));

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
