# PrintForge — Requirements checklist

Living document. Status legend: ✅ verified (evidence column) · 🟡 implemented, verification partial ·
⬜ not started · ⏸ deferred (reason given).

Evidence keys: **U** unit test · **I** integration test (real Postgres) · **E** Playwright E2E ·
**M** manual walkthrough recorded in `docs/WALKTHROUGH.md`.

## Foundation
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F1 | Next.js + TS + Postgres + Prisma migrations, pinned versions | 🟡 | `package.json`, `prisma/migrations` |
| F2 | Business logic separated from UI (domain / services / app) | 🟡 | ARCHITECTURE.md |
| F3 | Demo data only in a clearly flagged demo database | ⬜ | |
| F4 | README, env template, setup, troubleshooting | ⬜ | |

## Module 1 — Customers
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| C1 | Create / edit / archive / search / filter customers | ⬜ | |
| C2 | Fields: name, company, phone, email, address, notes, preferred contact, tax details | ⬜ | |
| C3 | Customer history: quotes, orders, payments, outstanding balance | ⬜ | |
| C4 | Duplicate detection (email / phone / name) | ⬜ | |
| C5 | Prevent loss of linked records (no hard delete with history) | ⬜ | |
| C6 | Privacy: per-customer export and anonymization respecting accounting retention | ⬜ | |

## Module 2 — Quotes & orders
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| Q1 | Multiple independent line items per quote/order | ⬜ | |
| Q2 | Line fields: part, description, category, qty, material/brand/color, printer, grams, support, machine time, files, deadline, instructions | ⬜ | |
| Q3 | Service types: print-only, modeling+printing, modeling-only, scanning-only, scanning+printing | 🟡 | U (engine) |
| Q4 | Line & order discounts, shipping, VAT, deposit, payment terms | 🟡 | U (engine) |
| Q5 | Quote revisions with history; customer approval record; notes | ⬜ | |
| Q6 | Separate quote and order status models with explicit transitions | 🟡 | U (`status.test.ts`) |
| Q7 | Convert accepted quote to order preserving snapshot | ⬜ | |
| Q8 | PDFs: quotation, order confirmation, delivery note, payment acknowledgement (not tax docs) | ⬜ | |
| Q9 | Documents configurable: branding, logo, business info, terms, numbering; no internal cost | ⬜ | |

## Module 3 — Pricing engine
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| P1 | Cost vs price vs profit distinguished | 🟡 | U |
| P2 | Material cost from price/kg, grams, support, purge, waste, quantity | 🟡 | U |
| P3 | Machine cost: depreciation, energy×tariff, maintenance, consumables, override | 🟡 | U |
| P4 | Labor: setup, post-processing, modeling, scanning; packing, shipping, fees, failure, contingency | 🟡 | U |
| P5 | Modeling hourly or fixed, one-time (not × qty), waivable for reorders | 🟡 | U |
| P6 | Policies: markup or margin, minimum order, minimum margin warning, rounding, manual override with reason | 🟡 | U |
| P7 | Correct order of discounts / shipping / VAT; Decimal arithmetic; defined rounding | 🟡 | U, docs/PRICING.md |
| P8 | Breakdown of every number shown in UI | ⬜ | |
| P9 | Historical snapshots survive configuration changes | ⬜ | |
| P10 | Estimated vs actual cost comparison | ⬜ | |
| P11 | Missing inputs are errors/warnings, never silent zeros | 🟡 | U |

## Module 4 — Materials & inventory
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| M1 | Material types (PLA/PETG/ABS/ASA + custom), brands, variants, colors, diameter, density | ⬜ | |
| M2 | Pricing: purchase price, price/kg, tax & shipping allocation, supplier | ⬜ | |
| M3 | Individual spools, stock movements ledger, storage location, thresholds | ⬜ | |
| M4 | Reserve on confirmation, deduct actual consumption, record waste/failed jobs | ⬜ | |
| M5 | Manual reconciliation (weigh spool) | ⬜ | |
| M6 | Low-stock alerts that account for estimate uncertainty | ⬜ | |
| M7 | Concurrency-safe stock changes | ⬜ | |

## Module 5 — Printers & production
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Printer registry with cost data, nozzle config, supported materials, status | ⬜ | |
| R2 | Maintenance schedule (hours/days) and log | ⬜ | |
| R3 | Print jobs linked to order items; batches/copies; reprints | ⬜ | |
| R4 | Estimated vs actual times and grams, failures, QC, completion | ⬜ | |
| R5 | Kanban board + printer queue view | ⬜ | |
| R6 | Order status distinct from job status (no premature "printed") | 🟡 | U (`syncProductionStatus`) |
| R7 | Bambu Studio 3MF metadata import (verified structure, fixtures, manual fallback) | ⬜ | |

## Module 6 — Modeling & scanning
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| D1 | Design projects: complexity, est/actual hours, revisions, approval, files, license notes | ⬜ | |
| D2 | Reusable designs across orders without re-charging the design fee | ⬜ | |
| D3 | Included revision limit and chargeable additional work | ⬜ | |
| D4 | Scan, cleanup and reverse-engineering time tracked separately | ⬜ | |

## Module 7 — Finance
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FN1 | Dashboard: revenue, cash received, unpaid, deposits, est./actual costs, material spend, gross profit | ⬜ | |
| FN2 | Revenue ≠ cash; gross ≠ net profit, clearly labeled | ⬜ | |
| FN3 | Expenses, supplier purchases, refunds, partial payments, payment methods | ⬜ | |
| FN4 | Daily / monthly / yearly reports; profitability by order/material/printer/customer; variance | ⬜ | |
| FN5 | CSV exports | ⬜ | |

## Module 8 — Files, search, notifications
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FS1 | Attach STL/STEP/3MF/OBJ/images/PDF to customers, orders, items, designs | ⬜ | |
| FS2 | Type & size validation, safe serving, storage limits | ⬜ | |
| FS3 | Previews for images/PDF (and 3D where feasible) | ⬜ | |
| FS4 | Global search + filters | ⬜ | |
| FS5 | Dashboard alerts: deadlines, overdue, low stock, approvals, unpaid, maintenance | ⬜ | |
| FS6 | No automatic customer messaging | ✅ | No messaging integration exists |

## Module 9 — Settings, security, data integrity
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| S1 | Owner authentication, sessions, password change, recovery procedure | ⬜ | |
| S2 | Authorization on every operation; rate limiting; security headers | ⬜ | |
| S3 | Client + server validation | ⬜ | |
| S4 | Backups (deployable), restore procedure tested on throwaway DB | ⬜ | |
| S5 | CSV exports + full human-readable export | ⬜ | |
| S6 | Migration strategy; confirmations for destructive operations | ⬜ | |
| S7 | Roles-ready design (OWNER/STAFF) | 🟡 | schema `UserRole` |

## UX
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| UX1 | Sidebar (desktop) + mobile navigation; all 10 areas | ⬜ | |
| UX2 | Light/dark themes, keyboard nav, focus & error states | ⬜ | |
| UX3 | Responsive phone/tablet/desktop without overflow | ⬜ | |
| UX4 | Loading, empty, success, failure states | ⬜ | |
| UX5 | Fast order entry | ⬜ | |

## Optional (after core)
| ID | Feature | Status |
|---|---|---|
| O1 | Product catalog / saved designs for one-click reorder | ⬜ |
| O2 | QR order labels | ⬜ |
| O3 | PWA install | ⬜ |
| O4 | Hebrew RTL (fully verified) | ⬜ |
| O5 | Payment processor integration | ⏸ requires your approval and credentials |
| O6 | Email/WhatsApp messaging | ⏸ opt-in only, requires your approval |
