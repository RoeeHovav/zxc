# Progress log & handoff

Concise log so another session can continue. Newest first.

## Budget note
API spend is not visible from inside this environment, so it cannot be tracked precisely. Work is kept
lean (no sub-agent swarms, no repeated full reviews). Checkpoints are noted below.

## Milestones
| # | Milestone | State |
|---|---|---|
| M0 | Environment inspection, stack decision, scaffold | done |
| M1 | Data model, pricing engine, state machines, core docs | done |
| M2 | Auth, app shell, customers | next |
| M3 | Quotes (multi-item builder, live pricing, snapshots, PDF) → orders | |
| M4 | Orders, payments, production jobs (vertical slice complete + E2E) | |
| M5 | Materials/spools/inventory, printers/maintenance | |
| M6 | Design projects (modeling/scanning) | |
| M7 | Finance, expenses, reports, CSV | |
| M8 | Files, global search, dashboard alerts | |
| M9 | Settings, backups/restore, exports, privacy | |
| M10 | 3MF import, responsive/a11y QA, final audit & walkthrough | |

## Log
- **M1** — Schema + migration `init`; `src/domain` pricing engine and status machines; 90 unit tests green.
- **M0** — Repo contained only an empty Flutter skeleton; removed per owner. PostgreSQL 16 available
  locally (`service postgresql start`). Databases: `printforge_dev`, `printforge_test`, `printforge_demo`
  (role `printforge`, local dev password in `.env`, not committed).
