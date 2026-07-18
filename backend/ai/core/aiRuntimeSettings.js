// backend/ai/core/aiRuntimeSettings.js

const pool = require("../../db");

const AI_VIDEO_ENABLED_KEY = "ai_video_enabled";
const AI_VIDEO_PROFILE_KEY = "ai_video_profile";
let settingsTableReadyPromise = null;
let cachedAiVideoEnabled = null;
let cachedVideoProfile = null;

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

function getEnvVideoProfile() {
  return {
    avatarId: cleanId(process.env.HEYGEN_AVATAR_ID),
    voiceId: cleanId(process.env.HEYGEN_VOICE_ID),
  };
}

function applyVideoProfile(profile = {}) {
  const envProfile = getEnvVideoProfile();
  const next = {
    avatarId: cleanId(profile.avatarId) || envProfile.avatarId,
    voiceId: cleanId(profile.voiceId) || envProfile.voiceId,
  };
  cachedVideoProfile = next;
  if (next.avatarId) process.env.HEYGEN_AVATAR_ID = next.avatarId;
  if (next.voiceId) process.env.HEYGEN_VOICE_ID = next.voiceId;
  return next;
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

module.exports = {
  getAiVideoEnabledSetting,
  setAiVideoEnabledSetting,
  getAiVideoProfileSetting,
  setAiVideoProfileSetting,
};
