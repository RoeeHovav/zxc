# Progress log & handoff

Concise notes so another session, or another developer, can continue. Newest first.

## Budget note

API spend isn't visible from inside this environment, so it couldn't be tracked. Work was kept lean: no
agent swarms, targeted reviews, and one full walkthrough.

## Milestones

| #   | Milestone                                                                 | State |
| --- | ------------------------------------------------------------------------- | ----- |
| M0  | Environment inspection, stack decision, scaffold                          | done  |
| M1  | Data model, pricing engine, state machines, core docs                     | done  |
| M2  | Auth, app shell, customers, files                                         | done  |
| M3  | Quote/order editor, live pricing, snapshots, PDFs                         | done  |
| M4  | Orders, payments, production jobs (vertical slice + E2E)                  | done  |
| M5  | Materials/spools/inventory, printers/maintenance                          | done  |
| M6  | Design projects (modeling/scanning)                                       | done  |
| M7  | Finance, expenses, reports, CSV                                           | done  |
| M8  | Global search, dashboard alerts                                           | done  |
| M9  | Settings, backups/restore, exports, privacy, Docker                       | done  |
| M10 | 3MF import, 3D preview, concurrency tests, docs, walkthrough, final audit | done  |

## Where to pick up next

1. **Hebrew UI:** follow docs/I18N.md (extract strings, add a `he` dictionary, add an RTL PDF variant).
2. **Staff users:** roles and permission checks exist, but there is no invite/manage UI yet.
3. **Per-line file attachments:** today files attach to orders, customers and designs.
4. **Real 3MF fixtures:** add real Bambu Studio exports to `tests/fixtures/bambu` (strip customer data).
5. **Optional:** QR job labels, PWA offline mode. Payment or messaging integrations only with the
   owner's approval.

## Environment notes for this repository

- Local PostgreSQL 16 (`service postgresql start`). Databases: `printforge_dev`, `printforge_test`,
  `printforge_e2e`, `printforge_demo`. Credentials live in `.env`, which is git-ignored.
- Playwright uses `PW_CHROMIUM_PATH` (the sandbox had `/opt/pw-browsers/chromium`).
- Docker was checked with a sandbox-only Dockerfile variant (extra CA and proxy for the sandbox network).
  The committed Dockerfile is the clean version, so run a normal build on your own machine once.

## Log

- **M10:**
  - Bambu 3MF parser (23 unit tests) and editor import.
  - 3D preview.
  - Concurrency tests found three races (idempotency, login burst, revision billing), all fixed.
  - Proxy IP hardening; build tracing scoped.
  - Walkthrough found and fixed the missing PDF footer and layout issues.
  - Compose backup/restore and password reset verified.
  - Docs completed.
- **M9:** Docker Compose stack verified (setup token, CRUD, exports, headers, backups). Backup/restore script
  test: 31 tables identical.
- **M1–M8:** see the git history (`git log`). Each milestone was committed with its tests.
- **M0:** the repo held only an empty Flutter skeleton, removed at the owner's request.
