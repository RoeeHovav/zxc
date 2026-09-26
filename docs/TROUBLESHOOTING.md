# Troubleshooting

## Sign-in and setup

| Symptom                                                          | Cause and fix                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| After signing in you land on the login page again, with no error | `APP_ENV=production` over plain HTTP: the browser drops the `Secure` cookie. Use HTTPS, or set `APP_ENV=development` for a localhost-only trial      |
| "Too many failed attempts"                                       | Five wrong passwords for one account within 15 minutes (or 20 from one IP behind the proxy). Wait 15 minutes. Further attempts don't extend the wait |
| Forgot the password                                              | There is no email reset. Run `npm run user:reset-password -- you@example.com` on the server (Docker: see DEPLOYMENT.md → Security checklist)         |
| `/setup` says the setup token is wrong                           | It must match `SETUP_TOKEN` exactly as set in the environment of the running app. Restart after changing it                                          |
| "Password is too common"                                         | The password contains a common word (e.g. "password", "123456"). Choose another                                                                      |

## Database

| Symptom                                   | Cause and fix                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL is not set`                 | Copy `.env.example` to `.env` (development) or set the variable in the environment                                                       |
| `P1001` / connection refused              | PostgreSQL isn't running or the host/port is wrong. Docker: `docker compose ps db`                                                       |
| `The table … does not exist`              | Migrations weren't applied: `npm run db:migrate` (Docker: the `migrate` service runs automatically; check `docker compose logs migrate`) |
| Password in `DATABASE_URL` breaks the URL | Characters like `@ / : ?` must be URL-encoded. Easiest is a hex password (`openssl rand -hex 24`)                                        |
| `pg_dump: server version mismatch`        | Use a PostgreSQL 16 client. The Compose backup service already does                                                                      |

## Pricing and documents

| Symptom                                                               | Cause and fix                                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A line shows "—" instead of a price, and the quote can't be sent      | Something the price depends on is missing (material price per kg, print time, printer cost data…). Open the line's breakdown (ⓘ) to see exactly what. PrintForge never substitutes zero |
| An old quote's price didn't change after you updated a material price | Intended: quotes and orders keep the prices they were created with. On a draft, use **Re-price with current rates**                                                                     |
| Numbers differ by ₪0.01 from a spreadsheet                            | Rounding happens at documented points (per line, then VAT once per document). See docs/PRICING.md                                                                                       |
| Hebrew text in a PDF looks wrong                                      | PDFs embed the Heebo font. If you replaced `src/assets/fonts`, restore it                                                                                                               |

## Inventory and production

| Symptom                                               | Cause and fix                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Spool … has only ≈N g recorded" when finishing a job | The recorded remainder is an estimate. Weigh the spool (Materials → the material → **Weigh** next to the spool) to correct it, or split the usage across spools |
| Low-stock alert says "(estimated)"                    | At least one spool's remainder is calculated, not weighed. Weigh it for a reliable figure                                                                       |
| An order won't move to Ready                          | Every unit must pass QC with no open print jobs. Check the order's production panel                                                                             |
| Can't complete an order                               | There is an outstanding balance. Record the payment, or override with a reason                                                                                  |

## Slicer import and 3D preview

| Symptom                               | Cause and fix                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This 3MF has no sliced plates"       | The project was saved without slicing. In Bambu Studio / OrcaSlicer: slice, then **File → Export → Export plate sliced file** (Ctrl+G), and import that `.gcode.3mf` |
| "No slicer results"                   | The 3MF came from another program or is a plain model export. Type grams and time manually                                                                           |
| 3D preview is blank or shows an error | Very large files (>150 MB) aren't previewed. Some unusual 3MF structures can't be displayed. Download the file and use your slicer                                   |

## Uploads

| Symptom                                         | Cause and fix                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| "Files of type … are not allowed"               | Only model, image, PDF, text and ZIP types are accepted. Zip other files first                                                |
| "The file content does not look like a valid …" | The content doesn't match the extension (e.g. a renamed file). Export it again from the source program                        |
| Upload fails with 413 behind a proxy            | The proxy's body-size limit is lower than Settings → max upload size. See DEPLOYMENT.md (`max_size` / `client_max_body_size`) |
| "Storage quota … would be exceeded"             | Delete old files or raise the quota in Settings                                                                               |

## Running the tests

| Symptom                                                                                             | Cause and fix                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration tests wipe data                                                                         | By design: `TEST_DATABASE_URL` must point at a disposable database, **never** your real one                                                      |
| Playwright can't find a browser                                                                     | Set `PW_CHROMIUM_PATH` to an installed Chromium, or run `npx playwright install chromium`                                                        |
| E2E fails to start the server                                                                       | Run `npm run build` first. E2E runs the standalone production server                                                                             |
| Log shows `DeprecationWarning: Calling client.query() when the client is already executing a query` | Comes from Prisma's PostgreSQL adapter internals with `pg` 8.x, not from PrintForge code. Harmless; it goes away when Prisma updates the adapter |
