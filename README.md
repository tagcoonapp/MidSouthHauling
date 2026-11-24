# Midsouth Hauling

Scheduling and job-photo app for the shed-hauling crew.

- **Drivers** (phone): their own daily/weekly schedule, customer details and PDF, job type, up to 4 photos, notes, submit. A job log grouped This week / This month / Older (60 days). Never sees money, the pipeline, or other drivers.
- **Scheduler**: everything. Pipeline + week calendar with drag and drop, driver colors, call status and call log, pending review (approve / send back), team management.
- **Owners**: calendar (can edit), pipeline, completed jobs. No pending expenses, no team management.

Access rules live in `shared/domain.ts` (`permissionsFor`) and are enforced by the API; the web app only hides buttons.

## Run it locally
Requires Node 22.
```bash
npm install
npm run db:migrate:local   # create the local database
npm run dev                # build the web app and serve everything at http://localhost:8787
npm run check              # typecheck + tests
```
The first visit asks you to create the scheduler account. Add drivers and owners on the **Team** page.

## Layout
- `worker/` – Cloudflare Worker API (Hono): auth, team, jobs, photos
- `web/` – React app (drivers' phone screens and office screens)
- `shared/` – job types, call statuses, roles and permissions used by both
- `migrations/` – database schema (Cloudflare D1)
- `test/` – access-rule tests
- `scripts/embed-assets.mjs` – packs the built web app into the Worker

## Live
https://midsouthhauling.tagcoon.workers.dev (Cloudflare free plan: Worker `midsouthhauling`, D1 `midsouthhauling-db`, R2 `midsouthhauling-files`).

Deploy: `npm run deploy` (builds, runs tests, applies new migrations, uploads). The web app is embedded into the
Worker at build time (`scripts/embed-assets.mjs`) so a deploy is a single script upload; Claude cloud sessions
can't use Wrangler's separate static-asset upload because their proxy replaces its one-time upload token.

## Photo reading (Claude Haiku)
When a driver submits, the Worker sends the job's photos to Claude Haiku (`worker/photo-reader.ts`), which reads the
happy sheet (serial, customer name, the "LOT - NAME - TYPE - MILES" top line, signature) and the serial on the building.
`shared/photo-read.ts` checks that against the job and the driver's answers; a Moody lot ticks Moody automatically.
Needs the secret `ANTHROPIC_API_KEY` (Cloudflare → Workers & Pages → midsouthhauling → Settings → Variables and Secrets).
Without it, Pending says photo reading isn't set up and everything else works.

## Brand
Colors are the variables at the top of `web/src/styles.css` (`--brand`, `--accent`). The logo is `web/public/icon.svg`.

## Coming next
1. Claude in Chrome reads new jobs from NetSuite Employee Center into the pipeline.
3. Accounting: expensed totals, driver pay, fuel, truck costs, mileage, Excel export.
