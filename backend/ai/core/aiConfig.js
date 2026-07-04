// backend/ai/core/aiConfig.js

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function boolEnv(name, fallback = false) {
  const v = readEnv(name, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(v);
}

function getAiConfig() {
  const heygenApiKey = readEnv("HEYGEN_API_KEY");
  const heygenAvatarId = readEnv("HEYGEN_AVATAR_ID");
  const heygenVoiceId = readEnv("HEYGEN_VOICE_ID");

  return {
    video: {
      enabled: boolEnv("AI_VIDEO_ENABLED", false),
      format: readEnv("AI_VIDEO_FORMAT", "9:16"),
      resolution: readEnv("AI_VIDEO_RESOLUTION", "1080p"),
      heygen: {
        apiKey: heygenApiKey,
        avatarId: heygenAvatarId,
        voiceId: heygenVoiceId,
        baseUrl: readEnv("HEYGEN_BASE_URL", "https://api.heygen.com"),
        ready: Boolean(heygenApiKey && heygenAvatarId && heygenVoiceId),
      },
    },
  };
}

module.exports = { getAiConfig };
