# Changelog

All notable changes to PrintForge. Format: [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-09-26

First complete version. See [REQUIREMENTS.md](REQUIREMENTS.md) for the requirement-by-requirement status.

### Added

- **Foundation:** Next.js 16.3, React 19.2, TypeScript 5.9, Tailwind 4, Prisma 7.10 on PostgreSQL 16. Full
  relational data model and forward-only migrations.
- **Pricing engine:** Decimal arithmetic with documented rounding; material, machine, labour,
  modeling/scanning, packing, shipping and fee costs; markup or margin policies; discounts; minimum order;
  VAT; deposits; per-line explanations ([docs/PRICING.md](docs/PRICING.md)).
- **Customers:** duplicate detection, history and balances, archive, privacy export, anonymization that
  keeps accounting records.
- **Quotes & orders:** multi-item editor with live pricing, snapshots, revisions, approvals, conversion,
  separate status machines with guards, and a production status derived from print jobs.
- **Customer documents (PDF):** quotation, order confirmation, delivery note, payment acknowledgement, with
  Hebrew support and a "not a tax invoice" disclaimer.
- **Payments:** deposits, partial payments, refunds, voids, derived balances.
- **Inventory:** spools with landed cost, reservations, consumption, waste, weigh-to-reconcile, low-stock
  alerts that are honest about estimates.
- **Printers & production:** cost data, maintenance, Kanban board, printer queues, failures, reprints, QC.
- **Modeling & scanning:** design projects, time tracking, revision allowance and billing, re-orders.
- **Finance & reports:** revenue vs cash, gross vs net, expenses, profitability by several dimensions,
  estimate vs actual, CSV exports and a full ZIP export.
- **Files:** validated uploads with quotas, image/PDF previews, and an in-browser **3D preview** (STL/OBJ/3MF)
  with dimensions.
- **Bambu Studio / OrcaSlicer 3MF import:** fills grams, print time and units per plate from sliced files,
  parsed in the browser. Checked against the slicers' source code, with a manual fallback.
- **Operations:** global search, dashboard alerts, audit history, first-run setup protected by
  `SETUP_TOKEN`, password reset CLI, Docker Compose deployment, scheduled and verified backups, a tested
  restore procedure, and a demo database seeder.
- **Docs:** README, ARCHITECTURE, REQUIREMENTS, TEST_PLAN, and docs/ (PRICING, DEPLOYMENT, BACKUP,
  TROUBLESHOOTING, I18N, WALKTHROUGH with screenshots).

### Fixed, found by the final tests and walkthrough

- Customer PDFs lost their footer (disclaimer and page numbers) because of a react-pdf `lineHeight`
  behaviour. The test now checks the rendered PDF text.
- A double-submitted payment or quote could fail with a constraint error instead of returning the first
  record.
- A parallel burst of login attempts could exceed the attempt limit.
- Two clicks could bill the same design revisions twice.
- Per-IP rate limiting trusted a client-controlled `X-Forwarded-For` entry.
- `next build` traced the whole project, including local `.env` files, into the standalone output.
- Layout issues in the quote editor and the order's jobs table; wording and pluralization.

### Removed

- The leftover empty Flutter project skeleton, at the owner's request. It is still in git history.
