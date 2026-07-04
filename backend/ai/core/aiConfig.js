// backend/ai/core/aiConfig.js

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function hasEnv(name) {
  return readEnv(name) !== "";
}

function getBoolEnv(name, fallback = false) {
  const raw = readEnv(name, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function getAiConfig() {
  const heygenBaseUrl = readEnv("HEYGEN_BASE_URL", "https://api.heygen.com").replace(/\/+$/, "");

  return {
    platform: {
      enabled: getBoolEnv("AI_PLATFORM_ENABLED", true),
      environment: readEnv("NODE_ENV", "development"),
    },
    video: {
      enabled: getBoolEnv("AI_VIDEO_ENABLED", false),
      heygen: {
        ready: hasEnv("HEYGEN_API_KEY") && hasEnv("HEYGEN_AVATAR_ID") && hasEnv("HEYGEN_VOICE_ID"),
        apiKey: readEnv("HEYGEN_API_KEY"),
        avatarId: readEnv("HEYGEN_AVATAR_ID"),
        voiceId: readEnv("HEYGEN_VOICE_ID"),
        baseUrl: heygenBaseUrl,
        defaultAspectRatio: readEnv("HEYGEN_DEFAULT_ASPECT_RATIO", "9:16"),
        defaultResolution: readEnv("HEYGEN_DEFAULT_RESOLUTION", "1080p"),
        defaultEngine: readEnv("HEYGEN_DEFAULT_ENGINE", "avatar_iv"),
      },
    },
  };
}

function getPublicAiStatus() {
  const config = getAiConfig();
  return {
    ok: true,
    platform: {
      enabled: config.platform.enabled,
      environment: config.platform.environment,
    },
    video: {
      enabled: config.video.enabled,
      heygenReady: config.video.heygen.ready,
      hasApiKey: hasEnv("HEYGEN_API_KEY"),
      hasAvatarId: hasEnv("HEYGEN_AVATAR_ID"),
      hasVoiceId: hasEnv("HEYGEN_VOICE_ID"),
      baseUrl: config.video.heygen.baseUrl,
      defaultAspectRatio: config.video.heygen.defaultAspectRatio,
      defaultResolution: config.video.heygen.defaultResolution,
      defaultEngine: config.video.heygen.defaultEngine,
    },
  };
}

module.exports = {
  getAiConfig,
  getPublicAiStatus,
};
