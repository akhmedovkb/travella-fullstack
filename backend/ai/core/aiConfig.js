// backend/ai/core/aiConfig.js

function requireEnv(name) {
  const value = process.env[name];

  if (!value || String(value).trim() === "") {
    throw new Error(`[ai-config] Missing required ENV: ${name}`);
  }

  return String(value).trim();
}

function getAiConfig() {
  return {
    video: {
      enabled: String(process.env.AI_VIDEO_ENABLED || "false") === "true",

      heygen: {
        apiKey: requireEnv("HEYGEN_API_KEY"),
        avatarId: requireEnv("HEYGEN_AVATAR_ID"),
        voiceId: requireEnv("HEYGEN_VOICE_ID"),
        baseUrl: process.env.HEYGEN_BASE_URL || "https://api.heygen.com",
      },
    },
  };
}

module.exports = {
  getAiConfig,
};
