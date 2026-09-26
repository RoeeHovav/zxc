# PrintForge

Self-hosted business management for a small 3D-printing, 3D-modeling and 3D-scanning business in
Israel. It handles customers, quotations and multi-item orders, exact pricing, filament inventory,
printers and production, modeling/scanning projects, payments, finance reports, files, backups and
exports. Everything runs on your own server: no paid services and no third-party data sharing.

> **Not a tax invoicing system.** PrintForge produces quotations, order confirmations, delivery notes and
> payment acknowledgements. They are clearly marked as _not_ tax invoices or receipts
> (חשבונית מס / קבלה). Issue tax documents with certified invoicing software.

## What it does

| Area                    | Highlights                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customers**           | Duplicate detection (normalized phone/email), history and balance, archive, privacy export, anonymization that keeps accounting records                                                                                                                                                                                   |
| **Quotes → orders**     | Multi-item builder with live pricing and a per-line price breakdown, revisions, recorded customer approval, conversion that keeps the price snapshot, PDFs in English/Hebrew with ₪                                                                                                                                       |
| **Pricing engine**      | Decimal arithmetic. Material + support + purge + waste, machine cost (depreciation, electricity, maintenance, consumables), labour, modeling/scanning, markup _or_ margin policies, discounts, minimum order, shipping, VAT, deposits. Missing inputs are errors, never silent zeros ([docs/PRICING.md](docs/PRICING.md)) |
| **Slicer import**       | Fill grams, print time and units per plate from a Bambu Studio / OrcaSlicer `.3mf`. The file is read in the browser, and you review everything before it's applied                                                                                                                                                        |
| **Inventory**           | Individual spools with landed cost, reservations on order confirmation, consumption from print jobs, waste, weigh-to-reconcile, low-stock alerts that flag estimates                                                                                                                                                      |
| **Production**          | Kanban board and per-printer queues, jobs per plate, failures and reprints, QC. Order status follows the jobs, so an order can't show as printed early. Maintenance schedules                                                                                                                                             |
| **Modeling & scanning** | Design projects with time tracking by category, included revisions and billing for extra ones, re-orders without re-charging the design fee                                                                                                                                                                               |
| **Money**               | Payments, deposits, refunds and voids, balances, expenses. Revenue vs cash and gross vs net are labelled separately. Profitability by order, customer, material and printer, and estimate vs actual. CSV exports                                                                                                          |
| **Files**               | STL/3MF/STEP/OBJ/images/PDF with type sniffing, quotas, an in-browser 3D preview with dimensions                                                                                                                                                                                                                          |
| **Operations**          | Global search (Ctrl K), dashboard alerts, audit log, full ZIP export, scheduled backups with a tested restore                                                                                                                                                                                                             |

It works on phone, tablet and desktop, in light and dark themes. English UI; Hebrew documents; RTL-ready
layout ([docs/I18N.md](docs/I18N.md)).

## Quick start (local development)

Requirements: Node.js 22+, PostgreSQL 16.

```bash
npm ci                                   # also generates the Prisma client
cp .env.example .env                     # then edit DATABASE_URL etc.
npm run db:migrate                       # apply migrations
npm run dev                              # http://localhost:3000 → first-run setup
```

The first visit opens **/setup**. There you create the owner account and business profile; if
`SETUP_TOKEN` is set, you must enter it. After that, `/setup` is closed.

### Demo data (optional)

Demo data goes into a **separate** database only. The script refuses to run in production, or against a
database that already holds real data.

```bash
DATABASE_URL=postgresql://…/printforge_demo npm run db:migrate
DATABASE_URL=postgresql://…/printforge_demo DEMO_PASSWORD='choose-one' npm run db:seed:demo
```

A banner marks demo databases in the app. The demo login is `demo@printforge.local`.

## Production

Use Docker Compose (PostgreSQL, one-shot migrations, the app on `127.0.0.1`, and scheduled backups). Put an
HTTPS reverse proxy in front of it. Step-by-step: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Backups and
restore: **[docs/BACKUP.md](docs/BACKUP.md)**.

```bash
cp .env.production.example .env.production   # set POSTGRES_PASSWORD and SETUP_TOKEN
docker compose --env-file .env.production up -d --build
```

## Configuration

| Variable                                | Purpose                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | PostgreSQL connection string (required)                                                                                                                                |
| `APP_ENV`                               | `production` enables `Secure`/`__Host-` cookies and HSTS, so it requires HTTPS. `development` for local HTTP                                                           |
| `SETUP_TOKEN`                           | Required to use first-run setup when set. Recommended on any reachable server                                                                                          |
| `UPLOAD_DIR`                            | Where uploaded files are stored (default `./storage/uploads`, outside the web root)                                                                                    |
| `BACKUP_DIR`                            | Lets Settings → Data show the latest backup                                                                                                                            |
| `TRUST_PROXY`                           | `1` only behind your own reverse proxy: per-IP rate limiting then uses the address the proxy appends to `X-Forwarded-For`. Otherwise only per-account limiting applies |
| `TZ`                                    | Business time zone (default `Asia/Jerusalem`). Month boundaries and dates use it                                                                                       |
| `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | Disposable databases for tests (**wiped** on every run)                                                                                                                |

Business settings live in the app (**Settings**): business details and logo, VAT mode and rate, cost rates,
pricing policies, document defaults and upload limits.

## Scripts

| Command                                               | What it does                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev` / `build` / `start:standalone`          | Develop, build, run the production build (as Docker does)           |
| `npm run verify`                                      | Typecheck, lint, format check, unit and integration tests, build    |
| `npm run test:unit` / `test:integration` / `test:e2e` | Test suites ([TEST_PLAN.md](TEST_PLAN.md))                          |
| `npm run test:backup`                                 | Back up, restore into a throwaway database, compare every table     |
| `npm run db:migrate`                                  | Apply migrations                                                    |
| `npm run user:reset-password -- owner@example.com`    | Reset a password from the server shell (there is no email recovery) |
| `scripts/backup.sh`, `scripts/restore.sh`             | Manual backup and restore ([docs/BACKUP.md](docs/BACKUP.md))        |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): stack, layering, data model, invariants, security
- [REQUIREMENTS.md](REQUIREMENTS.md): requirement checklist with evidence
- [TEST_PLAN.md](TEST_PLAN.md): what is tested, and how
- [docs/PRICING.md](docs/PRICING.md): how prices, costs and rounding work, with a worked example
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/BACKUP.md](docs/BACKUP.md), [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [docs/I18N.md](docs/I18N.md): Hebrew/RTL status and plan
- [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md): hands-on walkthrough with screenshots
- [CHANGELOG.md](CHANGELOG.md), [PROGRESS.md](PROGRESS.md): history and handoff notes

## Privacy & safety

- Customer data stays in your database and upload folder. Nothing is sent to outside services, and the app
  never messages customers on its own.
- Secrets come only from environment variables. `.env*` files are git-ignored.
- Destructive actions ask for confirmation. Customers with history can't be hard-deleted, only
  archived or anonymized. Payments are voided, never deleted.
