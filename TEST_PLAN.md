# PrintForge — Test plan

## Commands

| Command                                                       | What it runs                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run test:unit`                                           | Vitest unit tests (`src/**/*.test.ts`) — pricing, state machines, validation, parsers  |
| `npm run test:integration`                                    | Vitest against a real PostgreSQL test DB (`TEST_DATABASE_URL`), reset before each file |
| `npm run test:e2e`                                            | Playwright against a production build with a seeded E2E database                       |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | Static analysis                                                                        |
| `npm run build`                                               | Production build                                                                       |
| `npm run test:backup`                                         | Backup → restore into a throwaway DB → verify row counts                               |
| `npm run verify`                                              | All of the above in sequence                                                           |

## Coverage matrix

| Area                                                                                                                                                                     | Unit | Integration                   | E2E                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----------------------------- | -------------------- |
| Pricing: quantity, batches, rounding, modeling allocation, markup/margin, fees, VAT order, discounts, minimums, overrides, missing inputs, large quantities, float drift | ✅   | snapshot preservation         | quote builder totals |
| Order/quote/job/design state machines and guards                                                                                                                         | ✅   | guard enforcement in services | status buttons       |
| Customers: CRUD, duplicate detection, archive vs delete, anonymize                                                                                                       |      | ✅                            | create + search      |
| Quote → order conversion, revisions                                                                                                                                      |      | ✅                            | vertical slice       |
| Payments: partial, deposit, refund > paid rejected, void, balance derivation                                                                                             | ✅   | ✅                            | record payment       |
| Inventory: reservation on confirm, consumption, failed prints, release on cancel, reconciliation, concurrent decrements                                                  |      | ✅                            |                      |
| Auth: bad password, lockout/rate limit, session expiry, protected routes, API 401s                                                                                       |      | ✅                            | ✅                   |
| Files: type/size validation, magic bytes, unsafe names                                                                                                                   | ✅   | ✅                            | upload               |
| PDFs: render with realistic data, no cost/margin leakage                                                                                                                 |      | ✅                            | download             |
| Responsive layouts (375 / 768 / 1280)                                                                                                                                    |      |                               | ✅ screenshots       |
| Backup & restore                                                                                                                                                         |      | script                        |                      |

## Edge cases explicitly required by the brief

invalid input · empty states · large quantities · missing prices · duplicate submissions (idempotent
actions, disabled submit while pending) · file upload failures · concurrent inventory changes · canceled
orders · partial refunds · order revisions · authentication failures.

## Manual checks per milestone

Render each changed page at phone and desktop widths in light and dark themes, tab through forms,
trigger validation errors, and check the browser console for errors.
