# Travella Staging

## URLs

- Frontend: https://travella-staging.vercel.app
- Backend: https://travella-backend-staging-staging.up.railway.app

## Railway

- Project: `jubilant-prosperity`
- Environment: `staging`
- Backend service: `travella-backend-staging`
- Database service: `Postgres-6pdg`

## Vercel

- Project: `travella-fullstack`
- Staging alias: `travella-staging.vercel.app`
- Current staging deployment target: preview deployment aliased with `vercel alias set`
- Staging frontend is built with empty `VITE_API_BASE_URL`, so browser API calls use same-origin `/api/*`.
- `frontend/api/proxy.js` proxies `/api/*` to `BACKEND_URL`.

## Common Commands

From `backend`:

```powershell
railway environment staging
railway deployment list --service travella-backend-staging --environment staging
railway logs --service travella-backend-staging --environment staging --tail 120
```

Apply the minimal staging schema:

```powershell
$pg = (railway variable list --service Postgres-6pdg --environment staging --kv | Where-Object { $_ -like 'DATABASE_PUBLIC_URL=*' } | ForEach-Object { $_.Substring('DATABASE_PUBLIC_URL='.Length) })
$env:DATABASE_URL = $pg
node scripts\ensure-staging-payme-schema.js
node scripts\ensure-staging-marketplace-schema.js
```

Run Payme tests against staging DB:

```powershell
$pg = (railway variable list --service Postgres-6pdg --environment staging --kv | Where-Object { $_ -like 'DATABASE_PUBLIC_URL=*' } | ForEach-Object { $_.Substring('DATABASE_PUBLIC_URL='.Length) })
$env:DATABASE_URL = $pg
node scripts\ensure-staging-payme-schema.js
npm run test:payme
```

From repo root, deploy frontend preview and refresh the staging alias:

```powershell
vercel deploy --yes --force --build-env VITE_API_BASE_URL= --build-env VITE_API_URL= --env BACKEND_URL=https://travella-backend-staging-staging.up.railway.app
vercel alias set <deployment-host>.vercel.app travella-staging.vercel.app
```

## Notes

- Do not copy production secrets or customer data into staging.
- Production `travella.uz` should not be promoted until staging checks pass.
- The staging database currently has a minimal schema and test marketplace rows.
