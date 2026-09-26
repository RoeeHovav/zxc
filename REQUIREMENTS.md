# PrintForge — Requirements checklist

Status legend: ✅ implemented and verified (evidence given) · 🟡 implemented, verification or scope partial
(reason given) · ⏸ deferred (reason given).

Evidence keys:

- **U**: unit test (`src/**/*.test.ts`)
- **I**: integration test against real PostgreSQL (`tests/integration`)
- **E**: Playwright E2E test (`tests/e2e`)
- **W**: hands-on walkthrough with screenshots ([docs/WALKTHROUGH.md](docs/WALKTHROUGH.md))
- **D**: Docker Compose run (see WALKTHROUGH, "Also verified")

## Foundation

| ID  | Requirement                                                  | Status | Evidence                                                                           |
| --- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| F1  | Next.js + TS + Postgres + Prisma migrations, pinned versions | ✅     | `package.json` (exact pins), 3 migrations, `npm run verify` green                  |
| F2  | Business logic separated from UI (domain / services / app)   | ✅     | ARCHITECTURE.md. `src/domain` is pure and unit-tested                              |
| F3  | Demo data only in a clearly flagged demo database            | ✅     | `scripts/seed-demo.ts` refuses production and non-demo databases; DEMO banner (W1) |
| F4  | README, env template, setup, troubleshooting                 | ✅     | README.md, `.env.example`, `.env.production.example`, docs/TROUBLESHOOTING.md      |

## Module 1: Customers

| ID  | Requirement                                                                 | Status | Evidence                                                                                        |
| --- | --------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| C1  | Create / edit / archive / search / filter customers                         | ✅     | E (`02-workflow`), list filters, global search                                                  |
| C2  | Name, company, phone, email, address, notes, preferred contact, tax details | ✅     | `customerSchema`, customer form                                                                 |
| C3  | Customer history: quotes, orders, payments, outstanding balance             | ✅     | Customer detail page (orders, quotations, payments, designs, balance cards), `customerBalances` |
| C4  | Duplicate detection (email / phone / name)                                  | ✅     | I (`guards.test.ts`: normalized phone and email), E (duplicate blocks creation)                 |
| C5  | Prevent loss of linked records                                              | ✅     | I: hard delete refused with history, allowed without                                            |
| C6  | Privacy: per-customer export; anonymization that keeps accounting records   | ✅     | I (anonymize keeps orders and payments, wipes PII and delivery address), E (JSON export)        |

## Module 2: Quotes & orders

| ID  | Requirement                                                                                                                          | Status | Evidence                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Multiple independent line items                                                                                                      | ✅     | E (two-item quote), I                                                                                                                                  |
| Q2  | Line fields: part, description, category, qty, material/colour, printer, grams, support, machine time, files, deadline, instructions | 🟡     | Line editor (W3) has every field except files: files attach to the order, customer or design, not to an individual line                                |
| Q3  | Service types: print-only, modeling+printing, modeling-only, scanning-only, scanning+printing                                        | ✅     | U (engine), I (quote with modeling and scanning lines)                                                                                                 |
| Q4  | Line and order discounts, shipping, VAT, deposit, payment terms                                                                      | ✅     | U (engine), I                                                                                                                                          |
| Q5  | Quote revisions with history; customer approval record; notes                                                                        | ✅     | I (`guards.test.ts`: revision chain, revised quote can't be accepted), E (approval note)                                                               |
| Q6  | Separate quote and order status models, explicit transitions                                                                         | ✅     | U (`status.test.ts`), I (guards enforced in services), E                                                                                               |
| Q7  | Convert accepted quote to order, preserving the snapshot                                                                             | ✅     | I (snapshot survives price/VAT changes; conversion), E                                                                                                 |
| Q8  | PDFs: quotation, order confirmation, delivery note, payment acknowledgement, clearly **not** tax documents                           | ✅     | I (rendered PDF text: disclaimer, page footer, no internals), W16                                                                                      |
| Q9  | Configurable branding, logo, business info, terms; no internal cost on documents                                                     | ✅     | Settings; `CustomerDocument` DTO allow-list; I asserts no cost/margin/notes in DTO **and** rendered text. Numbering format is fixed (not configurable) |

## Module 3: Pricing engine

| ID  | Requirement                                                                                             | Status | Evidence                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| P1  | Cost vs price vs profit distinguished                                                                   | ✅     | U, order profitability panel (W5)                                                   |
| P2  | Material cost from price/kg, grams, support, purge, waste, quantity                                     | ✅     | U                                                                                   |
| P3  | Machine cost: depreciation, energy × tariff, maintenance, consumables, override                         | ✅     | U (`machineRateBreakdown`)                                                          |
| P4  | Labour: setup, post-processing, modeling, scanning; packing, shipping, fees, failure, contingency       | ✅     | U                                                                                   |
| P5  | Modeling hourly or fixed, one-time (not × qty), waivable for re-orders                                  | ✅     | U, I                                                                                |
| P6  | Markup or margin policies, minimum order, minimum-margin warning, rounding, manual override with reason | ✅     | U                                                                                   |
| P7  | Order of discounts / shipping / VAT; Decimal arithmetic; defined rounding                               | ✅     | U (worked example), docs/PRICING.md                                                 |
| P8  | Breakdown of every number shown                                                                         | ✅     | Per-line breakdown dialog (E), order profitability panel                            |
| P9  | Historical snapshots survive configuration changes                                                      | ✅     | I                                                                                   |
| P10 | Estimated vs actual cost comparison                                                                     | ✅     | I (`computeActualCost`), reports "By order & variance"                              |
| P11 | Missing inputs are errors/warnings, never silent zeros                                                  | ✅     | U, W3 ("Nothing is guessed"), slicer import treats empty weight/time as missing (U) |

## Module 4: Materials & inventory

| ID  | Requirement                                                                                                 | Status | Evidence                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| M1  | Material types (PLA/PETG/ABS/ASA/TPU/PC/PA/CF blends/PVA/HIPS + custom), brands, colours, diameter, density | ✅     | Reference data, catalog page, E                                                     |
| M2  | Purchase price, price/kg, reclaimable-VAT and shipping allocation (landed cost), supplier                   | ✅     | `receiveSpools`, E (receive spools)                                                 |
| M3  | Individual spools, stock-movement ledger, location, thresholds                                              | ✅     | W7, E                                                                               |
| M4  | Reserve on confirmation, deduct actual consumption, record waste and failed jobs                            | ✅     | I (reservations, consumption, cancellation release), E                              |
| M5  | Manual reconciliation (weigh spool)                                                                         | ✅     | `reconcileSpool` and the Weigh dialog                                               |
| M6  | Low-stock alerts that account for estimates                                                                 | ✅     | Alerts flag "(estimated)", "≈" marks (W1, W7)                                       |
| M7  | Concurrency-safe stock changes                                                                              | ✅     | I: 6 parallel 30 g deductions from a 100 g spool leave exactly 3 successes and 10 g |

## Module 5: Printers & production

| ID  | Requirement                                                                               | Status | Evidence                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Printer registry with cost data, nozzle, supported materials, status                      | ✅     | E (add printer with cost data)                                                                                                                                                                                                                                        |
| R2  | Maintenance schedule (hours / days) and log                                               | ✅     | Maintenance page, dashboard alert (W1)                                                                                                                                                                                                                                |
| R3  | Print jobs linked to order items; plates; copies; reprints                                | ✅     | I, E (4 jobs from 2 items)                                                                                                                                                                                                                                            |
| R4  | Estimated vs actual time and grams, failures, QC, completion                              | ✅     | I, E (finish dialog records filament used)                                                                                                                                                                                                                            |
| R5  | Kanban board + printer queues                                                             | ✅     | E, W6                                                                                                                                                                                                                                                                 |
| R6  | Order status separate from job status (no premature "printed")                            | ✅     | U (`syncProductionStatus`), I (can't be Ready while units unprinted), W5 guard messages                                                                                                                                                                               |
| R7  | Bambu Studio 3MF import: verified structure, fixtures, graceful versions, manual fallback | ✅     | Checked against the BambuStudio (master, v01.04.00.17) and OrcaSlicer writer source. U (23 tests incl. old/new versions, unsliced, malformed, zip bomb), E, W2. Fixtures are **hand-written from the source code, not real exports** (tests/fixtures/bambu/README.md) |

## Module 6: Modeling & scanning

| ID  | Requirement                                                                               | Status | Evidence                                                                         |
| --- | ----------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| D1  | Design projects: complexity, est./actual hours, revisions, approval, files, licence notes | ✅     | Design pages, E (approval releases order)                                        |
| D2  | Reusable designs across orders without re-charging the design fee                         | ✅     | "Repeat" / new order from design (fee waived with reason), U (waiver)            |
| D3  | Included revision limit and chargeable extra work                                         | ✅     | I: revisions 2–3 chargeable, billed exactly once even with two concurrent clicks |
| D4  | Scan, cleanup and reverse-engineering time tracked separately                             | ✅     | Time-entry categories; separate engine inputs (U)                                |

## Module 7: Finance

| ID  | Requirement                                                                                | Status | Evidence                                                              |
| --- | ------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| FN1 | Revenue, cash, unpaid, deposits, est./actual costs, material spend, gross profit           | ✅     | W8                                                                    |
| FN2 | Revenue ≠ cash; gross ≠ net, clearly labelled                                              | ✅     | W1, W8 labels and definitions                                         |
| FN3 | Expenses, supplier purchases, refunds, partial payments, methods                           | ✅     | I (partial, deposit, refund ≤ paid, void, concurrent overpayment), W8 |
| FN4 | Daily / monthly / yearly; profitability by order / material / printer / customer; variance | ✅     | Reports tabs (W9)                                                     |
| FN5 | CSV exports                                                                                | ✅     | U (`csv.test.ts`: formula-injection guard, BOM), E / D (CSV download) |

## Module 8: Files, search, notifications

| ID  | Requirement                                                                     | Status | Evidence                                                                                                 |
| --- | ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| FS1 | Attach STL/STEP/3MF/OBJ/images/PDF to customers, orders, designs                | ✅     | E (upload)                                                                                               |
| FS2 | Type and size validation, safe serving, storage limits                          | ✅     | U (`files.test.ts`: allow-list, magic bytes, markup rejection, inline-safe types), quota in `saveUpload` |
| FS3 | Previews for images/PDF, and 3D where feasible                                  | ✅     | Image thumbnails, inline PDF, 3D preview for STL/OBJ/3MF with dimensions (E, W10)                        |
| FS4 | Global search + filters                                                         | ✅     | Ctrl K palette, list filters                                                                             |
| FS5 | Dashboard alerts: deadlines, overdue, low stock, approvals, unpaid, maintenance | ✅     | W1                                                                                                       |
| FS6 | No automatic customer messaging                                                 | ✅     | No messaging integration exists                                                                          |

## Module 9: Settings, security, data integrity

| ID  | Requirement                                                  | Status | Evidence                                                                                                                           |
| --- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Owner authentication, sessions, password change, recovery    | ✅     | E (auth), CLI reset tested through the Docker `migrate` image (D)                                                                  |
| S2  | Authorization everywhere; rate limiting; security headers    | ✅     | E (401s, redirects), I (lockout; a parallel burst can't exceed 5 checked attempts), U (proxy IP parsing), D (CSP, X-Frame-Options) |
| S3  | Client + server validation                                   | ✅     | Shared Zod schemas; E (validation keeps input)                                                                                     |
| S4  | Deployable backups; restore tested on a throwaway DB         | ✅     | `npm run test:backup` (31 tables identical), Compose backup + restore procedure (D)                                                |
| S5  | CSV exports + full export                                    | ✅     | CSV per entity, full ZIP export (D)                                                                                                |
| S6  | Migration strategy; confirmations for destructive operations | ✅     | Forward-only migrations run by `migrate` before the app starts; ConfirmDialog; restore requires `--yes`                            |
| S7  | Roles-ready (OWNER / STAFF)                                  | 🟡     | Schema and permission checks (`can()`) exist; there is no UI yet for inviting staff                                                |

## UX

| ID  | Requirement                                                    | Status | Evidence                                                                                  |
| --- | -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| UX1 | Sidebar (desktop) + mobile navigation, all areas               | ✅     | W1, W13                                                                                   |
| UX2 | Light/dark themes, keyboard navigation, focus and error states | ✅     | W11; keyboard: Ctrl K, Ctrl S in editors, arrow keys in search; E uses role/label queries |
| UX3 | Responsive phone/tablet/desktop without overflow               | ✅     | E (`03-responsive`: 375/768/1280 across main pages), W13–15                               |
| UX4 | Loading, empty, success, failure states                        | ✅     | W (empty states, toasts, inline errors)                                                   |
| UX5 | Fast order entry                                               | ✅     | Keyboard-friendly editor, live pricing, duplicate line, slicer import                     |

## Optional

| ID  | Feature                              | Status                                                                                                                    |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| O1  | Saved designs for one-click re-order | ✅ via design projects (D2)                                                                                               |
| O2  | QR order labels                      | ⏸ not built; low priority compared with core correctness                                                                  |
| O3  | PWA install                          | 🟡 web manifest and icon only. No service worker or offline mode                                                          |
| O4  | Hebrew RTL                           | 🟡 Hebrew data and PDFs are supported and the layout is RTL-ready (W12), but the UI copy is English. Plan in docs/I18N.md |
| O5  | Payment processor integration        | ⏸ needs your approval and credentials                                                                                     |
| O6  | Email / WhatsApp messaging           | ⏸ opt-in only, needs your approval                                                                                        |
