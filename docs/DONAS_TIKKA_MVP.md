# DONA’S TIKKA: Business Concept and Product Bible MVP

## Verified source and boundaries

Implementation date: 28 November 2026, Asia/Tashkent.

Source: `akhmedovkb/travella-fullstack`, `main`, commit
`1ed7cbebe33a074760b04fb5a9844dd3d85a3424` (28 November 2026), updated
from the initial baseline `7076d559` before release. The two intervening login/SSO
changes were fast-forwarded without overwriting this feature.
The original checkout was found at `D:/1/travella/travella-fullstack`.
The initial Dona’s Dosas workspace was empty. This workspace's `app` directory
is a local clone of the verified source, rather than the February archive.
An existing uncommitted change to `frontend/src/pages/SsoAuthorize.jsx` in the
original checkout was excluded from this working copy and must be preserved.

Reviewed current source paths:

| Area | Existing implementation and observations |
| --- | --- |
| Ingredients | `backend/routes/adminDonasIngredientsRoutes.js`: `donas_ingredients`, units and pack prices, `slug=donas-dosas`. |
| Recipes | `backend/controllers/donasRecipeController.js`: legacy `donas_recipe_norms`; `backend/routes/adminDonasMenuItemsRoutes.js`: menu components in `donas_menu_item_components`. These are distinct existing paths. |
| COGS | `backend/controllers/donasCogsController.js`: persisted `donas_cogs` snapshots. |
| Inventory | `backend/controllers/donasInventoryController.js`: items, purchases, purchase lines and ledger; some tables are created by existing runtime code. |
| Sales | `backend/controllers/donasSalesController.js`: component-based stock movements and sales audit. A new product must not cause duplicate raw-material deductions. |
| Finance | `donasFinanceMonthsController`, `donasSalesMonthAggregator`, `donasFinanceAutoSync`: month snapshots and synchronization from operational data. |
| UI | `frontend/src/App.jsx`, `Header.jsx`, existing menu and finance layouts. |
| Access | Existing `authenticateToken` and `requireAdmin`, matching existing admin/moderator policy. Database provider flags override stale JWT admin claims. |

Live production schema was inspected on 28 November 2026 through Railway's public
Postgres endpoint, after verifying that the running backend uses that same database.
The initial connection failure was caused by a three-character placeholder in the
local `backend/.env`, not a missing production database. No credentials were copied
into source or printed. The audit found 25 existing Dona objects, 240 columns and
53 constraints, including the parallel legacy recipe/COGS paths listed above.

The additive migration was rehearsed against the live schema inside a transaction,
fully rolled back and verified absent, then applied. Both initial documents were
created as revision 1 by `system:donas-tikka-launch`: Concept 2.0 / Draft / ten sections;
Bible 1.0 / R&D / eleven sections. Existing documents are never overwritten by seeding.
All 25 pre-existing objects retained identical row counts and row fingerprints after
the migration and initialization. The schema audit records are retained in the
workspace outputs rather than adding database exports to the application repository.

No operational controller, recipe table, stock ledger, financial formula,
existing slug, historical sale or public route is changed by this feature.
No production-operations module is included. Releasing the two document modules
was explicitly requested after the initial MVP review.

## MVP behavior

- `/admin/donas-dosas/business-concept`: Concept 2.0, ten editable sections, initially Draft.
- `/admin/donas-dosas/product-bible`: Bible 1.0, eleven editable sections, initially R&D.
- Both routes use the existing frontend authentication and admin guards.
- Desktop and mobile admin dropdowns link to both modules.
- Section and document statuses: `draft`, `rd` (displayed as R&D), `approved`.
- Each save appends an immutable snapshot with edition, revision number, sections,
  statuses, author, timestamp and required change note.
- Edition (e.g. 2.0) is editable; revision is a monotonically increasing integer.
- Approving a document requires all its sections to be approved.
- Approved documents are read-only until an explicit new draft is created.
  Old approved revisions remain available in history.
- Expected-revision checking and a transactional row lock reject concurrent stale saves.
- Version history is paginated in groups of 50. Older versions are read-only.
- Initial content creation is an explicit admin action, repeat-safe and never overwrites an existing document.
- Content is rendered as safe text with headings and tables; stored HTML is not executed.
- API errors retain unsaved edits; browser refresh/close warns about unsaved changes.

Content source: the linked conversation `698c380c-d290-8390-80de-df42f50f36c2`,
Business Concept 2.0 and Product Bible 1.0 discussion of 28 November 2026.
Competitor prices and targets are preserved as historical hypotheses, not verified
current market data. Unavailable interactive marinade quantities and investment
allocations were not invented. Sauce and paratha quantities that survived in the
text are documentary R&D only. Storage periods and yields require validation.
Future production integration described in the Bible is a proposal, not implemented behavior.

## New database objects

- `donas_knowledge_documents`: one head per existing slug and document kind.
- `donas_knowledge_versions`: append-only JSONB section snapshots.
- `donas_knowledge_immutable_version` function and `donas_knowledge_no_rewrite`
  trigger: reject UPDATE and DELETE of historical revisions.

The migration creates only these new objects. It is not run automatically by startup
or GET requests. A missing migration returns a useful HTTP 503 message.

## API

Base: `/api/admin/donas/knowledge/:kind`, where kind is `business-concept` or `product-bible`.
All routes require the existing authentication and admin/moderator middleware.

| Method | Suffix | Result |
| --- | --- | --- |
| GET | (none) | Current document, or `?revision=N` for history |
| GET | `/history` | Metadata only; optional `?before=N` pagination |
| POST | `/initialize` | Create initial content once |
| POST | `/versions` | Validate and append revision using `expectedRevision` |

HTTP 400: invalid input or incomplete approval; 401/403: access denied;
404: unknown document/kind/revision; 409: stale revision, duplicate initialization
or attempt to modify approved content without a new draft; 503: migration missing.

## Rollout procedure and completed database step

1. Verify deployment source and intended database, and run from `backend`:
   `node scripts/audit-donas-schema.js` (read-only).
2. Review `migrations/20261128_donas_knowledge.sql` against that schema.
3. In the chosen test/staging database, run `node scripts/ensure-donas-knowledge.js`.
4. Start the updated backend/frontend; initialize the two documents from admin UI.
5. Verify authorization, save/reload, history, approvals and existing financial screens.
6. Apply the reviewed additive migration to the intended production database only
   as part of an explicitly authorized deployment. This migration and the initial
   document creation have now completed in production, with unchanged existing data.

If the UI/API feature must be rolled back, revert its code while retaining the new
tables and history. Do not delete document data to roll back a UI release.

## Validation

Unit and integration test file: `backend/tests/donasKnowledge.test.js`.
Without a test database, validation and seed tests run and the PostgreSQL test is skipped.
Set `DONAS_TEST_PGLITE=1` with `@electric-sql/pglite` available to Node to run the
isolated embedded PostgreSQL test, or set `DONAS_TEST_DATABASE_URL` to a **fresh,
dedicated, disposable test database**. Never point that test variable at production.

The integration test checks repeated migration, both initial documents, validation,
immutable history, transactional failure rollback, optimistic concurrency, document
approval, draft creation, history pagination and protected route behavior.
An operational sentinel retains its exact value throughout the test.

The workspace also contains a browser test harness under `validation`, using
the production frontend build, real route handlers, real authentication middleware
and an isolated PostgreSQL engine. External network requests are blocked. Its
screenshots and report are in the workspace `outputs` directory. No production
credentials or provider data are used by this harness.

`npm run build` is the existing frontend production build command. The local host
has Node 24 while the project declares Node 22; verification in the declared CI
runtime remains recommended. Existing large-bundle warnings do not fail the build.
