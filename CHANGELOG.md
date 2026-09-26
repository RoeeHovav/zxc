# Changelog

All notable changes to PrintForge. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Project foundation: Next.js 16.3, React 19.2, TypeScript 5.9, Tailwind 4, Prisma 7.10 on PostgreSQL 16.
- Complete relational data model and initial migration (customers, quotes, orders, payments, materials,
  spools, stock movements, reservations, printers, maintenance, print jobs, design projects, expenses,
  files, settings, pricing policies, numbering, sessions, audit log).
- Pricing engine with Decimal arithmetic, explicit rounding boundaries, markup/margin policies, modeling and
  scanning services, discounts, minimum order charge, VAT, deposits, and itemized explanations (63 tests).
- State machines for orders (with payment/production guards and job-derived production status), quotes,
  print jobs and design projects (27 tests).
- ARCHITECTURE.md, REQUIREMENTS.md, TEST_PLAN.md, docs/PRICING.md.

### Removed
- Leftover empty Flutter project skeleton (at the owner's request; still available in git history).
