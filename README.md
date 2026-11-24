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

## Deploy (free Cloudflare plan)
1. `npx wrangler d1 create midsouthhauling-db` and paste the `database_id` into `wrangler.jsonc`.
2. `npx wrangler r2 bucket create midsouthhauling-files`
3. `npm run deploy`

## Brand
Colors are the variables at the top of `web/src/styles.css` (`--brand`, `--accent`). The logo is `web/public/icon.svg`.

## Coming next
1. Claude in Chrome reads new jobs from NetSuite Employee Center into the pipeline.
2. AI checks of the happy sheet and serial plate, pricing from the price sheets, and an expense-report draft for approval.
3. Accounting: expensed totals, driver pay, fuel, truck costs, mileage, Excel export.
