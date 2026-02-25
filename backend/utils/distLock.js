// backend/utils/distLock.js
const redis = require("./redisClient");

async function acquireLock(key, ttlMs = 8000) {
  const res = await redis.set(key, "1", "PX", ttlMs, "NX");
  return res === "OK";
}

async function releaseLock(key) {
  try {
    await redis.del(key);
  } catch {}
}

module.exports = { acquireLock, releaseLock };
