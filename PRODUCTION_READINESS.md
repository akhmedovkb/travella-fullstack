# Travella AI OS Production Readiness

Date: 2026-07-16
Scope: Publishing Manager / Telegram fallback / AI OS staging to production.

## Current Status

- Staging browser QA passed for Publishing Manager.
- PR #28 is open and mergeable.
- Vercel check is green on the PR head commit.
- `travella-staging.vercel.app` points to the validated staging deployment.
- Railway staging backend responds with `200 Travella API OK`.
- Railway production backend service is identified as `travella-fullstack`.
- Railway production backend root responds with `200 Travella API OK`.
- Production frontend API proxy smoke returns `401` for unauthenticated `/api/admin/ai-platform/status`, as expected.
- Production has not been changed.

## Release Size

This is not only a small Telegram fallback patch. The PR includes Publishing Manager UI, Telegram scheduler/status work, Vercel proxy configuration, and related admin UI changes.

Changed areas:

- `backend/routes/adminAiPlatformRoutes.js`
- `backend/jobs/aiPublishingSchedulerJob.js`
- `backend/index.js`
- `backend/utils/telegramServiceCard.js`
- `backend/telegram/bot.js`
- `backend/controllers/telegramClientController.js`
- `frontend/src/pages/admin/AdminAiPlatform.jsx`
- `frontend/src/pages/admin/AdminRefusedActual.jsx`
- `api/proxy.js`
- `vercel.json`
- `.github/workflows/gitleaks.yml`

## Production Blockers

1. Production backend AI publishing env vars are not configured yet.
2. Confirm production backend env vars before enabling automated Telegram publishing.
3. Add an explicit scheduler safety flag before the first production deploy.

Resolved:

- Railway production environment is accessible.
- Production backend service is `travella-fullstack`.
- Latest listed production backend deployment was `SUCCESS`.
- Production backend public URL is `https://travella-fullstack-production.up.railway.app`.

## Required Production Env Review

Frontend / Vercel:

- `BACKEND_URL`
- `VITE_API_BASE_URL`
- `VITE_TELEGRAM_PROVIDER_BOT_USERNAME`

Backend / Railway:

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `FRONTEND_URL`
- `SITE_PUBLIC_URL`
- `TELEGRAM_CLIENT_BOT_TOKEN`
- `AI_PUBLISH_TELEGRAM_CHAT_ID`
- `DISABLE_AI_PUBLISHING_SCHEDULER`
- `AI_PUBLISHING_SCHEDULER_BATCH_LIMIT`
- `AI_VIDEO_ENABLED`
- `HEYGEN_API_KEY`
- `HEYGEN_AVATAR_ID`
- `HEYGEN_VOICE_ID`
- `R2_BUCKET`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_URL`

Observed production backend env names on 2026-07-16:

- Present: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `TELEGRAM_CLIENT_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PUBLIC_CHANNEL_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `API_PUBLIC_URL`, `API_BASE_URL`.
- Missing or not observed: `AI_PUBLISH_TELEGRAM_CHAT_ID`, `DISABLE_AI_PUBLISHING_SCHEDULER`, `AI_VIDEO_ENABLED`, `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `R2_PUBLIC_URL`.

## Recommended First Production Rollout

Use a guarded first release:

1. Set `DISABLE_AI_PUBLISHING_SCHEDULER=true` in production backend before deploying.
2. Keep `AI_VIDEO_ENABLED=false` unless production HeyGen cost controls and approval flow are confirmed.
3. Merge PR #28 only after Railway production env/service is verified.
4. Deploy backend production.
5. Deploy frontend production.
6. Open production `/admin/ai-platform`.
7. Confirm status endpoint reports:
   - `telegramReady` as expected.
   - `schedulerReadyReason=disabled_by_env`.
   - no due Telegram auto-run.
8. Manually test one safe admin read flow.
9. Enable scheduler later by changing `DISABLE_AI_PUBLISHING_SCHEDULER=false` only after confirming target Telegram chat/channel.

## Rollback Plan

- Frontend: promote or alias the previous Vercel production deployment.
- Backend: redeploy the previous Railway production deployment.
- Immediate safety switch: set `DISABLE_AI_PUBLISHING_SCHEDULER=true`.
- If Telegram bot polling conflicts appear, set `DISABLE_TG_BOT=1` while keeping API online.

## Post-Deploy Smoke

- Production root loads.
- Login/admin token works.
- `/admin/ai-platform` loads.
- Publishing Manager shows queue.
- Telegram delivery counts render.
- Scheduler block shows disabled or ready state intentionally.
- No unexpected Telegram messages are published.
