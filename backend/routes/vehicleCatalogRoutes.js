const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const pool = require("../db");
const { ensureVehicleCatalog, normalizeVehicleName, upsertVehicle } = require("../utils/vehicleCatalog");

const router = express.Router();
const externalCache = new Map();

const normalized = (value) => normalizeVehicleName(value).toLocaleLowerCase("en-US");
const tokensMatch = (candidate, query) => normalized(query).split(" ").filter(Boolean).every((token) => normalized(candidate).includes(token));

async function nhtsaSuggestions(query) {
  const key = normalized(query);
  const cached = externalCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const makeHint = normalizeVehicleName(query).split(" ")[0];
  if (makeHint.length < 2) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(makeHint)}?format=json`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "Travella/1.0" } });
    if (!response.ok) return [];
    const data = await response.json();
    const seen = new Set();
    const items = (Array.isArray(data?.Results) ? data.Results : [])
      .map((item) => ({
        make: normalizeVehicleName(item.Make_Name),
        model: normalizeVehicleName(item.Model_Name),
        display_name: normalizeVehicleName(`${item.Make_Name || ""} ${item.Model_Name || ""}`),
        seats: null,
        source: "nhtsa",
      }))
      .filter((item) => item.display_name && tokensMatch(item.display_name, query))
      .filter((item) => {
        const itemKey = normalized(item.display_name);
        if (seen.has(itemKey)) return false;
        seen.add(itemKey);
        return true;
      })
      .slice(0, 30);
    externalCache.set(key, { items, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return items;
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("vehicle catalog NHTSA lookup failed:", error?.message || error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

router.get("/suggestions", authenticateToken, async (req, res) => {
  try {
    const query = normalizeVehicleName(req.query.q);
    const limit = Math.max(5, Math.min(50, Number(req.query.limit) || 25));
    if (query.length < 2) return res.json({ items: [] });
    await ensureVehicleCatalog();
    const local = await pool.query(
      `SELECT display_name,seats,source,usage_count
         FROM vehicle_catalog
        WHERE display_name ILIKE $1
        ORDER BY usage_count DESC,display_name ASC
        LIMIT $2`,
      [`%${query}%`, limit]
    );
    const external = await nhtsaSuggestions(query);
    const combined = [];
    const seen = new Set();
    for (const item of [...local.rows, ...external]) {
      const key = normalized(item.display_name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
      if (combined.length >= limit) break;
    }
    return res.json({ items: combined });
  } catch (error) {
    console.error("GET /api/vehicles/suggestions error:", error);
    return res.status(500).json({ message: "Не удалось загрузить справочник автомобилей" });
  }
});

router.post("/catalog", authenticateToken, async (req, res) => {
  try {
    const saved = await upsertVehicle({ displayName: req.body?.display_name || req.body?.model, seats: req.body?.seats, source: "provider" });
    if (!saved) return res.status(400).json({ message: "Укажите модель автомобиля" });
    return res.status(201).json(saved);
  } catch (error) {
    console.error("POST /api/vehicles/catalog error:", error);
    return res.status(500).json({ message: "Не удалось сохранить автомобиль" });
  }
});

module.exports = router;