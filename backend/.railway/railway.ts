import { defineRailway, github, preserve, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "travella-fullstack";
export default defineRailway(() => {
  const travellaFullstack = service("travella-fullstack", {
    source: github("akhmedovkb/travella-fullstack", { checkSuites: false, rootDirectory: "/backend" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    replicas: { "europe-west4-drams3a": 1 },
    env: { ADMIN_JOB_TOKEN: preserve(), AI_PUBLISH_TELEGRAM_CHAT_ID: preserve(), AI_VIDEO_ENABLED: preserve(), API_BASE_URL: preserve(), API_PUBLIC_URL: preserve(), ASK_ACTUAL_IGNORE_DAYS: preserve(), ASK_ACTUAL_KEEP_DAYS: preserve(), CLICK_MERCHANT_ID: preserve(), CLICK_MERCHANT_USER_ID: preserve(), CLICK_SECRET_KEY: preserve(), CLICK_SERVICE_ID: preserve(), CLICK_TELEGRAM_PAYMENTS_ENABLED: preserve(), CONTACT_OPERATOR_1_CHAT_ID: preserve(), CONTACT_OPERATOR_1_NAME: preserve(), CONTACT_OPERATOR_1_URL: preserve(), CONTACT_OPERATOR_2_CHAT_ID: preserve(), CONTACT_OPERATOR_2_NAME: preserve(), CONTACT_OPERATOR_2_URL: preserve(), CONTACT_OPERATOR_3_CHAT_ID: preserve(), CONTACT_OPERATOR_3_NAME: preserve(), CONTACT_OPERATOR_3_URL: preserve(), CORS_ORIGINS: preserve(), DATABASE_URL: preserve(), DISABLE_AI_PUBLISHING_SCHEDULER: preserve(), DONAS_PUBLIC_KEY: preserve(), GOOGLE_PLACES_API_KEY: preserve(), HEYGEN_API_KEY: preserve(), HEYGEN_AVATAR_ID: preserve(), HEYGEN_VOICE_ID: preserve(), JWT_SECRET: preserve(), PAYME_TG_ENABLED: preserve(), PGPASSWORD: preserve(), POSTGRES_USER: preserve(), R2_ACCESS_KEY_ID: preserve(), R2_ACCOUNT_ID: preserve(), R2_BUCKET: preserve(), R2_ENDPOINT: preserve(), R2_SECRET_ACCESS_KEY: preserve(), TELEGRAM_ADMIN_CHAT_IDS: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_BOT_USERNAME: preserve(), TELEGRAM_CLIENT_BOT_TOKEN: preserve(), TELEGRAM_CLIENT_BOT_USERNAME: preserve(), TELEGRAM_LOGIN_BOT_TOKEN: preserve(), TELEGRAM_MANAGER_CHAT_ID: preserve(), TELEGRAM_PAYMENTS_PROVIDER_TOKEN: preserve(), TELEGRAM_PROVIDER_BOT_TOKEN: preserve(), TELEGRAM_PUBLIC_CHANNEL_ID: preserve(), TELEGRAM_WEBHOOK_SECRET: preserve(), TG_IMAGE_BASE: preserve(), VITE_TELEGRAM_PROVIDER_BOT_USERNAME: preserve() },
  });

  return project("jubilant-prosperity", {
    resources: [travellaFullstack],
  });
});
