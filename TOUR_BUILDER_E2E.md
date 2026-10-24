# Tour Builder E2E

The staging E2E exercises the complete DMC lifecycle through public APIs:

1. Authenticate a DMC admin and a supplier.
2. Create a tour package and supplier booking component.
3. Quote and confirm the supplier component.
4. Publish and accept the client proposal.
5. Confirm the sale, traveler, supplier operations, and client payment.
6. Verify persisted state and the audit trail.
7. Cancel and settle both refunds, releasing the supplier calendar.

## Safety

The runner rejects known production hosts. `ALLOW_PRODUCTION_E2E=true` is an explicit emergency override and must not be configured in CI.

## GitHub configuration

Create a `staging` environment and add these environment secrets:

- `STAGING_E2E_DMC_EMAIL`
- `STAGING_E2E_DMC_PASSWORD`
- `STAGING_E2E_SUPPLIER_EMAIL`
- `STAGING_E2E_SUPPLIER_PASSWORD`

The DMC fixture must have `is_admin=true`; the supplier must be a separate guide, transport, hotel, or agent provider. The workflow can be started manually and also runs on weekdays.

The accounts can be created or rotated idempotently inside the Railway staging service with:

```powershell
npm run seed:e2e:tour-builder
```

Railway staging may set `SEED_TOUR_BUILDER_E2E=true` for one deployment. The `prestart` hook then seeds through Railway's private database network. Production skips the hook unless that explicit flag is present.

## Local run

```powershell
$env:E2E_BASE_URL = "https://travella-backend-staging-staging.up.railway.app"
$env:E2E_DMC_EMAIL = "..."
$env:E2E_DMC_PASSWORD = "..."
$env:E2E_SUPPLIER_EMAIL = "..."
$env:E2E_SUPPLIER_PASSWORD = "..."
npm --prefix backend run test:e2e:tour-builder
```
