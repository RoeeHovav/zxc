# PrintForge — Architecture

PrintForge is a self-hosted business management application for a small 3D-printing,
3D-modeling and 3D-scanning business. It is a single full-stack TypeScript application.

## Stack (pinned in `package.json`)

| Concern          | Choice                                                                                  | Why                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Framework        | Next.js 16.3 (App Router, Server Components, Server Actions), React 19.2                | One deployable, server-rendered pages keep customer data server-side, no separate API tier to secure. |
| Language         | TypeScript 5.9 (strict)                                                                 | TS 7 (native) is too new for Next's type-check integration.                                           |
| Database         | PostgreSQL 16                                                                           | Relational integrity, transactions, `NUMERIC` for money.                                              |
| ORM / migrations | Prisma 7.10 (`prisma-client` generator + `@prisma/adapter-pg`)                          | Type-safe queries, versioned SQL migrations.                                                          |
| Validation       | Zod 4                                                                                   | Same schemas on client and server.                                                                    |
| Money            | `decimal.js` (isolated clone, 40 digits, HALF_UP)                                       | No floating point in accounting paths.                                                                |
| UI               | Tailwind CSS 4, Radix primitives (`radix-ui`), lucide icons, sonner toasts, next-themes | Accessible primitives, no heavy component framework lock-in.                                          |
| PDF              | `@react-pdf/renderer` 4                                                                 | Pure JS, runs in route handlers, no headless browser needed.                                          |
| Auth             | Custom session auth (argon2id via `@node-rs/argon2`, DB-backed sessions, hashed tokens) | Small, auditable, no third-party identity service or recurring cost.                                  |
| Tests            | Vitest 5 (unit + DB integration), Playwright 1.63 (E2E)                                 |                                                                                                       |

## Layering

```
src/
  domain/          Pure business logic. No I/O, no framework. 100% unit-testable.
    money.ts         Decimal helpers and rounding boundaries
    pricing/         Pricing engine (types, engine, context builder)
    status/          State machines for orders, quotes, jobs, designs
    schemas/         Zod input schemas shared by forms and server actions
  server/          Server-only code (imports "server-only").
    db.ts            Prisma client (created lazily, so builds need no database)
    auth/            Password hashing, sessions, rate limiting, `requireUser()`
    services/        Business operations: every DB write lives here, inside transactions
  app/             Next.js routes. Pages read via services; mutations call Server Actions
    (auth)/          login, first-run setup
    (app)/           authenticated shell + modules
    api/             file download/upload, PDF, CSV/ZIP export route handlers
  components/      UI primitives (components/ui) and feature components
  lib/             Client-safe utilities: formatting, labels, i18n
prisma/            schema.prisma + migrations + seed scripts
tests/             integration (Vitest + Postgres) and e2e (Playwright)
scripts/           backup / restore / maintenance scripts
```

Rules:

1. UI components never talk to Prisma. Pages call `server/services/*` read functions; mutations go
   through Server Actions in `app/**/actions.ts`, which do: `requireUser()` → Zod parse → service call →
   `revalidatePath`.
2. Every service function that writes more than one row uses `prisma.$transaction`.
3. The pricing engine is the only place prices are computed. The browser runs the same engine for
   live previews; the server recomputes authoritatively on save and never trusts client totals.

## Data model (summary)

See `prisma/schema.prisma` for full detail.

- **Identity**: `User` (role OWNER/STAFF), `Session` (id = SHA-256 of cookie token), `LoginAttempt`, `AuditLog`.
- **Configuration**: `Settings` (singleton: business profile, tax, cost rates, billing rates, defaults),
  `PricingPolicy` (markup or margin method, minimums, rounding), `NumberSequence` (document numbering).
- **Customers**: `Customer` (normalized email/phone for duplicate detection, archive/anonymize flags).
- **Catalog & inventory**: `MaterialType` → `Material` (brand/line/color/price per kg) → `Spool`
  (individual physical spools with landed cost and remaining weight) → `StockMovement` (signed ledger),
  `MaterialReservation` (grams reserved for confirmed order items), `Supplier`.
- **Printers**: `Printer` (cost components), `MaintenanceTask` (interval schedule), `MaintenanceLog`.
- **Sales**: `Quote` (+ `QuoteItem`) with revisions chained by `previousId`; `Order` (+ `OrderItem`);
  `Payment` (payments and refunds, voidable, never deleted).
- **Production**: `PrintJob` with `PrintJobItem` (a job can print several items and/or several copies),
  reprints linked via `reprintOfId`.
- **Design**: `DesignProject` (modeling / scanning / scan-to-CAD, reusable for re-orders),
  `DesignTimeEntry` (time by category: modeling, scanning, cleanup, reverse engineering…), `DesignRevision`.
- **Finance**: `Expense` (categorized, optional supplier/printer/order link, VAT portion).
- **Files**: `FileAttachment` (stored outside the web root, linked to any entity).

## Business invariants

| #   | Invariant                                                                                                                                                                                 | Enforced by                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| I1  | Money is computed with Decimal and rounded only at documented boundaries.                                                                                                                 | `domain/money.ts`, `domain/pricing/engine.ts`, unit tests                      |
| I2  | A price is never produced from missing inputs; the line is flagged incomplete.                                                                                                            | Engine `error` issues; quotes cannot be sent while incomplete                  |
| I3  | Quotes and orders store a pricing context + per-line resolved inputs; later changes to materials, printers, rates or VAT never change them unless the user explicitly re-prices a draft.  | `pricingContext`, `pricingInput` JSON snapshots; integration test              |
| I4  | Sent quotes are immutable. Changes create a new revision; the old one becomes `REVISED`.                                                                                                  | Quote service + `checkQuoteTransition`                                         |
| I5  | Order status changes only along `ORDER_TRANSITIONS`, with guards against payment and production facts.                                                                                    | `domain/status/order.ts`                                                       |
| I6  | Production-band order status (Queued → Printing → Post-processing → QC → Ready) is derived from print jobs, so an order cannot be "printed" while any unit is unprinted.                  | `syncProductionStatus`, called after every job event                           |
| I7  | Payment state is derived from the payment ledger (never stored as a flag). `Order.amountPaid` is a cache updated in the same transaction as the ledger row.                               | Payment service + reconciliation test                                          |
| I8  | Refunds cannot exceed net amount paid. Payments are voided, never deleted.                                                                                                                | Payment service                                                                |
| I9  | Material stock = Σ spool remaining; available = stock − active reservations. Spool remaining changes only together with a `StockMovement` row in one transaction using atomic decrements. | Inventory service; concurrency test                                            |
| I10 | Reservations are created on order confirmation, reduced by actual consumption, released on cancellation.                                                                                  | Inventory + order services                                                     |
| I11 | Customers with linked financial records cannot be hard-deleted; they can be archived or anonymized (PII erased, financial records retained).                                              | Customer service                                                               |
| I12 | Customer-facing documents never include internal cost, margin or notes.                                                                                                                   | PDF components only receive a `CustomerDocument` DTO without cost fields; test |
| I13 | Every data operation requires an authenticated, active user.                                                                                                                              | `requireUser()` in every action/route/page loader                              |
| I14 | Document numbers are allocated atomically and never reused.                                                                                                                               | `NumberSequence` increment inside transaction                                  |

## Security

- Passwords: argon2id (OWASP parameters). Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax`,
  `Secure` (in production) cookie; only its SHA-256 is stored. Sliding 30-day expiry; logout deletes the row;
  password change revokes other sessions.
- Login rate limiting per account (5 failures / 15 min) and per IP (20). Each attempt is recorded _before_
  it is checked, so parallel bursts can't slip past the limit (integration test). Rejected attempts are
  removed, so they can't extend the lockout. Error messages are generic. The client IP comes only from
  the last `X-Forwarded-For` entry, and only when `TRUST_PROXY=1` (set behind your own reverse proxy).
- Double submissions are harmless: quotes, orders and payments carry a client idempotency key backed by
  a unique column. When two requests race, the loser returns the winner's record.
- Server Actions are POST-only with Next.js origin checks; route handlers that mutate check `Origin`.
- `proxy.ts` redirects unauthenticated requests early; real authorization happens server-side on every
  request (`requireUser()`), never only in the proxy.
- Security headers: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS in production.
- Uploads: extension allow-list + magic-byte sniffing, size limits, random storage keys outside `public/`,
  served with `Content-Disposition: attachment` (inline only for images/PDF) and `nosniff`.
- Secrets only via environment variables; `.env*` is git-ignored; `.env.example` has placeholders only.

## Localization

English UI. Navigation and status/enum labels come from the `src/lib/i18n.ts` dictionary; page copy is
still inline. Layouts use logical CSS properties only, so `dir="rtl"` mirrors correctly (screenshot in
docs/WALKTHROUGH.md). Numbers, currency and dates go through `Intl`. Customer PDFs embed Heebo for
Hebrew. See `docs/I18N.md` for the path to a full Hebrew UI.

## Slicer import and 3D preview

- `src/domain/slicer/bambu-3mf.ts` reads Bambu Studio / OrcaSlicer `.3mf`. It is isomorphic and runs in the
  browser, so the file is never uploaded. The format was checked against the slicers' writer source; see the
  file header and `tests/fixtures/bambu/README.md`.
- `src/components/files/model-viewer.tsx` lazy-loads three.js to preview STL/OBJ/3MF attachments. It
  reports the bounding box in mm.

## Deployment model

Single Node.js process (Next.js `output: "standalone"`) + PostgreSQL. Docker Compose runs db, one-shot
migrations, the app (bound to 127.0.0.1, behind your HTTPS proxy) and scheduled backups. No paid services
are required. See `docs/DEPLOYMENT.md` and `docs/BACKUP.md`.
