// backend/ai/core/aiRuntimeSettings.js

const pool = require("../../db");

const AI_VIDEO_ENABLED_KEY = "ai_video_enabled";
const AI_VIDEO_PROFILE_KEY = "ai_video_profile";
const AI_VIDEO_PRESETS_KEY = "ai_video_presets";
let settingsTableReadyPromise = null;
let cachedAiVideoEnabled = null;
let cachedVideoProfile = null;

const VIDEO_PROFILE_DEFAULTS = {
  engine: "avatar_iv",
  voiceSpeed: 1,
  expressiveness: "medium",
};

const DEFAULT_VIDEO_PRESETS = {
  avatars: [
    { label: "MY1", value: "563cee663c5a494a99a34f0867f6c0b2" },
    { label: "MY2", value: "9c8b04c737bc4f2bbc4bd7d42ec33281" },
  ],
  voices: [
    { label: "MY1", value: "ce04d2becc764610b4b3f89155285a45" },
    { label: "MY2", value: "2f5588e77acb4d3aa4482570c0390644" },
    { label: "MY3", value: "aaea0796357b4614a69e14e1d05fc185" },
    { label: "MY4", value: "e0e96bd5207449f8bd69a6ad0fb95a2d" },
    { label: "MY5", value: "4ef0fa222bcf488f9145db9a0c716de8" },
    { label: "MY6", value: "75d34e45780f44888ccaf49cb93222ee" },
  ],
};

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(raw).trim().toLowerCase());
}

function persistenceEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

async function ensureSettingsTable() {
  if (!persistenceEnabled()) return false;
  if (!settingsTableReadyPromise) {
    settingsTableReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS ai_runtime_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT
      )
    `).then(() => true).catch((err) => {
      settingsTableReadyPromise = null;
      console.warn("[ai-runtime-settings] table unavailable:", err?.message || err);
      return false;
    });
  }
  return settingsTableReadyPromise;
}

function applyAiVideoEnabled(enabled) {
  cachedAiVideoEnabled = Boolean(enabled);
  process.env.AI_VIDEO_ENABLED = cachedAiVideoEnabled ? "true" : "false";
  return cachedAiVideoEnabled;
}

function cleanId(value) {
  return String(value || "").trim();
}

function normalizeEngine(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "avatar_v" ? "avatar_v" : "avatar_iv";
}

function normalizeVoiceSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return VIDEO_PROFILE_DEFAULTS.voiceSpeed;
  return Math.max(0.5, Math.min(1.5, Math.round(n * 100) / 100));
}

function normalizeExpressiveness(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["low", "medium", "high"].includes(raw)) return raw;
  return VIDEO_PROFILE_DEFAULTS.expressiveness;
}

function getEnvVideoProfile() {
  return {
    avatarId: cleanId(process.env.HEYGEN_AVATAR_ID),
    voiceId: cleanId(process.env.HEYGEN_VOICE_ID),
    engine: normalizeEngine(process.env.HEYGEN_ENGINE || VIDEO_PROFILE_DEFAULTS.engine),
    voiceSpeed: normalizeVoiceSpeed(process.env.HEYGEN_VOICE_SPEED || VIDEO_PROFILE_DEFAULTS.voiceSpeed),
    expressiveness: normalizeExpressiveness(process.env.HEYGEN_EXPRESSIVENESS || VIDEO_PROFILE_DEFAULTS.expressiveness),
  };
}

function applyVideoProfile(profile = {}) {
  const envProfile = getEnvVideoProfile();
  const next = {
    avatarId: cleanId(profile.avatarId) || envProfile.avatarId,
    voiceId: cleanId(profile.voiceId) || envProfile.voiceId,
    engine: normalizeEngine(profile.engine || envProfile.engine),
    voiceSpeed: normalizeVoiceSpeed(profile.voiceSpeed ?? envProfile.voiceSpeed),
    expressiveness: normalizeExpressiveness(profile.expressiveness || envProfile.expressiveness),
  };
  cachedVideoProfile = next;
  if (next.avatarId) process.env.HEYGEN_AVATAR_ID = next.avatarId;
  if (next.voiceId) process.env.HEYGEN_VOICE_ID = next.voiceId;
  process.env.HEYGEN_ENGINE = next.engine;
  process.env.HEYGEN_VOICE_SPEED = String(next.voiceSpeed);
  process.env.HEYGEN_EXPRESSIVENESS = next.expressiveness;
  return next;
}

function normalizePresets(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label || "").trim().slice(0, 40),
      value: cleanId(item?.value).slice(0, 160),
    }))
    .filter((item) => item.label && item.value)
    .filter((item) => {
      const key = item.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

function normalizeVideoPresets(presets = {}) {
  const avatars = normalizePresets(presets.avatars);
  const voices = normalizePresets(presets.voices);
  return {
    avatars: avatars.length ? avatars : DEFAULT_VIDEO_PRESETS.avatars,
    voices: voices.length ? voices : DEFAULT_VIDEO_PRESETS.voices,
  };
}

async function getAiVideoEnabledSetting() {
  const envEnabled = boolEnv("AI_VIDEO_ENABLED", false);
  if (!(await ensureSettingsTable())) {
    return {
      enabled: cachedAiVideoEnabled ?? envEnabled,
      source: cachedAiVideoEnabled === null ? "env" : "memory",
    };
  }

  try {
    const result = await pool.query(
      "SELECT value, updated_at, updated_by FROM ai_runtime_settings WHERE key = $1 LIMIT 1",
      [AI_VIDEO_ENABLED_KEY]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      applyAiVideoEnabled(envEnabled);
      return { enabled: envEnabled, source: "env", updatedAt: null, updatedBy: null };
    }

    const enabled = Boolean(row.value?.enabled);
    applyAiVideoEnabled(enabled);
    return {
      enabled,
      source: "db",
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
      updatedBy: row.updated_by || null,
    };
  } catch (err) {
    console.warn("[ai-runtime-settings] read failed:", err?.message || err);
    return {
      enabled: cachedAiVideoEnabled ?? envEnabled,
      source: cachedAiVideoEnabled === null ? "env" : "memory",
      error: err?.message || String(err),
    };
  }
}

async function setAiVideoEnabledSetting(enabled, actor = {}) {
  const next = applyAiVideoEnabled(enabled);
  if (!(await ensureSettingsTable())) {
    return { enabled: next, source: "memory", updatedAt: new Date().toISOString(), updatedBy: actor?.id || null };
  }

  const result = await pool.query(
    `
      INSERT INTO ai_runtime_settings (key, value, updated_at, updated_by)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
      RETURNING value, updated_at, updated_by
    `,
    [AI_VIDEO_ENABLED_KEY, JSON.stringify({ enabled: next }), actor?.id || null]
  );
  const row = result.rows?.[0] || {};
  return {
    enabled: Boolean(row.value?.enabled),
    source: "db",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
    updatedBy: row.updated_by || null,
  };
}

async function getAiVideoProfileSetting() {
  const envProfile = getEnvVideoProfile();
  if (!(await ensureSettingsTable())) {
    return {
      ...applyVideoProfile(cachedVideoProfile || envProfile),
      source: cachedVideoProfile ? "memory" : "env",
    };
  }

  try {
    const result = await pool.query(
      "SELECT value, updated_at, updated_by FROM ai_runtime_settings WHERE key = $1 LIMIT 1",
      [AI_VIDEO_PROFILE_KEY]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      return {
        ...applyVideoProfile(envProfile),
        source: "env",
        updatedAt: null,
        updatedBy: null,
      };
    }

    const profile = applyVideoProfile(row.value || {});
    return {
      ...profile,
      source: "db",
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
      updatedBy: row.updated_by || null,
    };
  } catch (err) {
    console.warn("[ai-runtime-settings] profile read failed:", err?.message || err);
    return {
      ...applyVideoProfile(cachedVideoProfile || envProfile),
      source: cachedVideoProfile ? "memory" : "env",
      error: err?.message || String(err),
    };
  }
}

async function setAiVideoProfileSetting(profile = {}, actor = {}) {
  const next = applyVideoProfile(profile);
  if (!(await ensureSettingsTable())) {
    return { ...next, source: "memory", updatedAt: new Date().toISOString(), updatedBy: actor?.id || null };
  }

  const result = await pool.query(
    `
      INSERT INTO ai_runtime_settings (key, value, updated_at, updated_by)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
      RETURNING value, updated_at, updated_by
    `,
    [AI_VIDEO_PROFILE_KEY, JSON.stringify(next), actor?.id || null]
  );
  const row = result.rows?.[0] || {};
  const saved = applyVideoProfile(row.value || next);
  return {
    ...saved,
    source: "db",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
    updatedBy: row.updated_by || null,
  };
}

async function getAiVideoPresetsSetting() {
  if (!(await ensureSettingsTable())) {
    return { ...DEFAULT_VIDEO_PRESETS, source: "default" };
  }

  try {
    const result = await pool.query(
      "SELECT value, updated_at, updated_by FROM ai_runtime_settings WHERE key = $1 LIMIT 1",
      [AI_VIDEO_PRESETS_KEY]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      return { ...DEFAULT_VIDEO_PRESETS, source: "default", updatedAt: null, updatedBy: null };
    }

    return {
      ...normalizeVideoPresets(row.value || {}),
      source: "db",
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
      updatedBy: row.updated_by || null,
    };
  } catch (err) {
    console.warn("[ai-runtime-settings] presets read failed:", err?.message || err);
    return { ...DEFAULT_VIDEO_PRESETS, source: "default", error: err?.message || String(err) };
  }
}

async function setAiVideoPresetsSetting(presets = {}, actor = {}) {
  const next = normalizeVideoPresets(presets);
  if (!(await ensureSettingsTable())) {
    return { ...next, source: "memory", updatedAt: new Date().toISOString(), updatedBy: actor?.id || null };
  }

  const result = await pool.query(
    `
      INSERT INTO ai_runtime_settings (key, value, updated_at, updated_by)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
      RETURNING value, updated_at, updated_by
    `,
    [AI_VIDEO_PRESETS_KEY, JSON.stringify(next), actor?.id || null]
  );
  const row = result.rows?.[0] || {};
  return {
    ...normalizeVideoPresets(row.value || next),
    source: "db",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
    updatedBy: row.updated_by || null,
  };
}

module.exports = {
  getAiVideoEnabledSetting,
  setAiVideoEnabledSetting,
  getAiVideoProfileSetting,
  setAiVideoProfileSetting,
  getAiVideoPresetsSetting,
  setAiVideoPresetsSetting,
};
