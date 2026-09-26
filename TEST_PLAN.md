# PrintForge — Test plan

## Commands

| Command                                       | What it runs                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`                           | Vitest unit tests (`src/**/*.test.ts`): pricing, state machines, CSV, file validation, 3MF parser, proxy IP parsing |
| `npm run test:integration`                    | Vitest against a real PostgreSQL test database (`TEST_DATABASE_URL`, wiped per file)                                |
| `npm run test:e2e`                            | Playwright against the **standalone production build** (`npm run build` first) and a disposable `E2E_DATABASE_URL`  |
| `npm run typecheck` / `lint` / `format:check` | Static analysis                                                                                                     |
| `npm run test:backup`                         | Backup, restore into a throwaway database, compare every table's row count and the uploaded files                   |
| `npm run verify`                              | typecheck, lint, format check, unit and integration tests, build                                                    |

Last full run: **145 unit, 26 integration, 18 E2E, all passing**. The backup test restored 31 tables
with identical counts.

## Coverage matrix

| Area                                                                                                                                                                    | Unit          | Integration                 | E2E                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- | ------------------------------ |
| Pricing: quantity, plates, rounding, modeling allocation, markup/margin, fees, VAT order, discounts, minimums, overrides, missing inputs, large quantities, float drift | ✅            | snapshot preservation       | quote builder, price breakdown |
| Order / quote / job / design state machines and guards                                                                                                                  | ✅            | guards enforced in services | status buttons                 |
| Customers: duplicates, delete guard vs anonymize, privacy export                                                                                                        |               | ✅                          | duplicate warning, JSON export |
| Quote → order conversion, revisions, approval                                                                                                                           |               | ✅                          | vertical slice                 |
| Payments: partial, deposit, refund ≤ paid, void, overpayment race, idempotent double submit                                                                             | ✅            | ✅                          | record payment                 |
| Inventory: reservations, consumption, failures, release on cancel, **concurrent deductions**                                                                            |               | ✅                          | receive spools, finish jobs    |
| Design revisions: allowance, chargeable extras, **billed once under concurrent clicks**                                                                                 | ✅            | ✅                          | design approval flow           |
| Auth: wrong password, lockout, **parallel burst capped**, generic errors, protected routes, API 401                                                                     | ✅ (proxy IP) | ✅                          | ✅                             |
| Files: allow-list, magic bytes, markup rejection, inline-safe types, quota                                                                                              | ✅            |                             | upload + 3D preview            |
| Customer PDFs: **rendered text** contains the not-a-tax-document disclaimer and page footer, no cost/margin/notes, Hebrew                                               |               | ✅                          | download                       |
| Bambu 3MF import: current and v01.04 formats, unsliced, missing weight/time, malformed, not a zip, zip bomb, case-insensitive paths, thumbnails                         | ✅ (23)       |                             | ✅ apply to quote line         |
| Responsive layout (375 / 768 / 1280, no horizontal overflow)                                                                                                            |               |                             | ✅                             |
| Backup & restore                                                                                                                                                        |               | `test:backup` script        | Compose procedure run by hand  |

## Edge cases the brief required

Invalid input · empty states · large quantities · missing prices · duplicate submissions (idempotency
keys, tested under true concurrency) · file upload failures · concurrent inventory changes · canceled
orders · partial refunds · order revisions · authentication failures: each is covered in the matrix above.

## Manual checks

Before each release: build, run the standalone server against the demo database, and look at the main
pages at phone and desktop widths, in light and dark themes, with the browser console open. The latest
pass is in [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md). It found and fixed a missing PDF footer and several
layout issues.

## Known test-environment notes

- E2E uses the Chromium at `PW_CHROMIUM_PATH` (or `/opt/pw-browsers/chromium`) when set.
- The 3MF fixtures are hand-written from the slicer source code, not real exports. Add real exports when
  you have them (tests/fixtures/bambu/README.md).
- `pg` prints a deprecation warning from inside Prisma's adapter. It is harmless and upstream.
