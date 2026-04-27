# Travella Project Map

Last reviewed: 2026-04-27

Travella is a fullstack operational platform for travella.uz. It combines a public marketplace, provider and client cabinets, an admin area, hotel/tour tooling, payments, Telegram workflows, and a separate Donas Dosas finance/admin module.

## Stack

- Backend: Node.js, Express, PostgreSQL, JWT, CORS, node-cron.
- Frontend: React 18, Vite, Tailwind CSS, React Router, i18next.
- Integrations: Payme, Telegram/Telegraf, GeoNames, OCR/MRZ passport parsing, PDF/Excel export.
- Deployment hints: frontend points to `VITE_API_BASE_URL`; Vite dev proxy targets Railway backend.

## Repository Layout

- `backend/index.js` - Express app entrypoint, CORS setup, route mounting, scheduler and Telegram bot startup.
- `backend/db.js` - PostgreSQL pool using `DATABASE_URL`; SSL is selected by explicit env or cloud-host heuristics.
- `backend/routes/` - API route modules. Some are thin wrappers, some contain inline business logic.
- `backend/controllers/` - main backend business logic.
- `backend/jobs/` - scheduled jobs for reminders, service cleanup, Payme health, unlock nudges.
- `backend/telegram/` - large Telegraf bot implementation and Telegram-specific handlers/keyboards.
- `backend/utils/` - shared helpers for Telegram, Payme events, contact unlocks, Donas finance, Redis locks, seasons, monitoring.
- `frontend/src/App.jsx` - main React routing table.
- `frontend/src/api.js` - shared fetch wrapper, API base resolver, token/header handling.
- `frontend/src/pages/` - route-level React pages.
- `frontend/src/components/` - reusable and feature components.
- `frontend/src/api/` - narrower API helpers for hotels, inside, leads, reviews, provider favorites.
- `frontend/src/locales/` - `ru`, `uz`, `en` translation files.
- `frontend/public/` - static images and payment logos.

## Run Scripts

Backend:

```bash
cd backend
npm start
npm run test:payme
```

Frontend:

```bash
cd frontend
npm run dev
npm run build
npm run preview
```

Root `package.json` also defines Vite scripts, but the richer frontend dependency set is in `frontend/package.json`.

## Environment

Root example:

- `VITE_API_BASE_URL`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`

Backend example:

- `PORT`, `TZ`, `JWT_SECRET`
- `DATABASE_URL`
- `GEONAMES_USERNAME`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_CLIENT_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_IDS`, `TELEGRAM_MANAGER_CHAT_ID`
- `SITE_PUBLIC_URL`, `TG_IMAGE_BASE`
- `PAYME_MERCHANT_LOGIN`, `PAYME_MERCHANT_KEY`
- `DONAS_PUBLIC_KEY`

Do not paste real `.env` values into chat or docs.

## Main Product Areas

### Marketplace and Services

- Frontend: `frontend/src/pages/Marketplace.jsx`, `frontend/src/components/ServiceCard.jsx`.
- Backend: `backend/routes/marketplaceRoutes.js`, `backend/controllers/marketplaceController.js`, `backend/routes/marketplaceSectionsRoutes.js`.
- Related: wishlist, service stats, provider favorites, contact unlock.

### Providers

- Frontend: provider dashboard pages under `frontend/src/pages/Provider*` and shared provider components.
- Backend: `backend/routes/providerRoutes.js`, `backend/controllers/providerController.js`, `backend/routes/providerServices.js`.
- Includes profile, services, availability/calendar, bookings, favorites, deleted service restore/purge.

### Clients

- Frontend: `ClientRegister`, `ClientLogin`, `ClientDashboard`, `ClientBalance`, `ClientBookings`.
- Backend: `backend/routes/clientRoutes.js`, `backend/controllers/clientController.js`, `backend/routes/clientBillingRoutes.js`.
- Includes balance, wishlist, requests, bookings, inside participation, profile.

### Requests and Bookings

- Requests: `backend/routes/requestRoutes.js`, `backend/controllers/requestController.js`.
- Bookings: `backend/routes/bookingRoutes.js`, `backend/controllers/bookingController.js`.
- Telegram notifications are centralized mostly in `backend/utils/telegram.js`.

### Admin

- Frontend: `frontend/src/pages/admin/*` plus `AdminModeration.jsx`, `AdminEntryFees.jsx`.
- Backend: many `backend/routes/admin*Routes.js` and `backend/controllers/admin*Controller.js`.
- Covers moderation, providers, clients, billing, Payme health/lab, leads, hotels, CMS, operations, broadcast, unlock funnel/nudge.

### Hotels

- Frontend: `Hotels.jsx`, `HotelDetails.jsx`, `HotelInspections.jsx`, admin hotel pages/components.
- Backend: `backend/routes/hotelRoutes.js`, `backend/controllers/hotelsController.js`, `backend/routes/hotelSeasons.js`, `backend/routes/hotelInspectionRoutes.js`.

### Telegram

- Legacy/webhook routes: `backend/routes/telegramRoutes.js`.
- New client bot: `backend/telegram/bot.js`, launched from `backend/index.js`.
- Helpers: `backend/utils/telegram.js`, `backend/utils/telegramServiceCard.js`.
- Web auth: `backend/routes/telegramWebAuthRoutes.js`, `backend/controllers/telegramWebAuthController.js`.

### Payme and Balance

- Merchant RPC: `backend/routes/paymeMerchantRoutes.js`, `backend/controllers/paymeMerchantController.js`.
- Admin health/lab/events/payments: `adminPayme*Routes.js`, `adminPayme*Controller.js`.
- Balance/contact unlock: `clientBillingController.js`, `adminBillingController.js`, `contactUnlock.js`.

### India / Inside

- Frontend landing: `frontend/src/pages/landing/*`.
- Inside flow: `frontend/src/api/inside.js`, `frontend/src/pages/admin/AdminInsideRequests.jsx`, `frontend/src/components/admin/InsideParticipantsBlock.jsx`.
- Backend: `backend/routes/insideRoutes.js`, `backend/controllers/insideController.js`.

### Donas Dosas

- Frontend admin finance/menu/inventory pages under `frontend/src/pages/admin/Donas*`.
- Backend routes/controllers: `adminDonas*Routes.js`, `donas*Controller.js`.
- Utilities: `donasFinanceAutoSync.js`, `donasFinanceGuardrails.js`, `donasSalesMonthAggregator.js`.
- Public sharing: `donasShareRoutes.js`, `publicDonasRoutes.js`, `donasShareTokenController.js`.

### Tour Builder and Templates

- Frontend: `TourBuilder.jsx`, `TemplateCreator.jsx`, `components/tourbuilder/*`.
- Backend: `backend/routes/TBtemplatesRoutes.js`.

### Passport Parser

- Frontend: `frontend/src/pages/PassportParser.jsx`.
- Backend: `backend/routes/passportRoutes.js`.
- Uses multer, sharp, tesseract.js, and MRZ parsing.

## Large Files to Treat Carefully

- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/ProviderServicesMarketplace.jsx`
- `frontend/src/pages/TourBuilder.jsx`
- `frontend/src/pages/ClientDashboard.jsx`
- `frontend/src/components/ServiceCard.jsx`
- `backend/controllers/providerController.js`
- `backend/controllers/bookingController.js`
- `backend/controllers/hotelsController.js`
- `backend/controllers/telegramProviderController.js`
- `backend/controllers/paymeMerchantController.js`
- `backend/telegram/bot.js`

These files carry a lot of behavior and should be edited in small, focused patches.

## Known Architectural Notes

- The backend is mostly CommonJS; frontend is ESM.
- API base handling is mixed: many newer calls use `frontend/src/api.js`, while older code still uses direct `axios`, `fetch`, or `import.meta.env.VITE_API_BASE_URL`.
- Auth tokens are stored under multiple localStorage keys: `token`, `providerToken`, `clientToken`, `adminToken`, plus some role/id hints.
- Some duplicate or compatibility routes exist, especially around provider services and requests.
- `backend/index.js` mounts some routes late, including `/api/passport` and `/api/service-stats`; order matters if adding overlapping routes.
- Telegram has two concepts: old bot/webhook via `TELEGRAM_BOT_TOKEN`, and client bot via `TELEGRAM_CLIENT_BOT_TOKEN`.

## Suggested Next Checks

- Run frontend build and note compile warnings/errors.
- Run backend Payme test with `npm run test:payme`.
- Start backend locally with scheduler/Telegram disabled if needed.
- Start frontend locally and test primary flows: marketplace, login, provider dashboard, client dashboard.
- Review high-risk payment/contact unlock flows before production changes.

