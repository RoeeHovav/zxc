# Deploying PrintForge

PrintForge runs as one Node.js process plus PostgreSQL. The supported path is **Docker Compose** on a
machine you control: a small VPS, a home server or a NAS with Docker. Nothing here buys services or
exposes anything publicly for you. Every step below is yours to take.

**Requirements:** Docker Engine 24+ with Compose v2, about 1 GB RAM, and disk for the database, uploads
and backups. For access from outside the machine you also need a domain name and HTTPS (step 4).

## 1. Get the code and create secrets

```bash
git clone <your repository URL> printforge && cd printforge
cp .env.production.example .env.production
openssl rand -hex 24   # use for POSTGRES_PASSWORD (hex keeps the database URL valid)
openssl rand -hex 16   # use for SETUP_TOKEN
```

Edit `.env.production`:

| Variable                                                            | Notes                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                                 | Long and random. Stick to URL-safe characters (hex is simplest), because it goes into a connection URL                                                |
| `SETUP_TOKEN`                                                       | Needed once, to create the owner account at `/setup`. Rotate or blank it afterwards                                                                   |
| `APP_ENV`                                                           | Keep `production`. Cookies then become `Secure`/`__Host-`, which **requires HTTPS**. Use `development` only for a trial over plain `http://localhost` |
| `APP_PORT`                                                          | Host port. The app binds to `127.0.0.1` only                                                                                                          |
| `BACKUP_HOST_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS` | See [BACKUP.md](BACKUP.md)                                                                                                                            |

`.env.production` holds secrets. It is git-ignored and excluded from the Docker build context, so never
commit it.

## 2. Start the stack

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps     # db healthy, migrate exited 0, app healthy
```

| Service   | Role                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| `db`      | PostgreSQL 16, data in the `pgdata` volume                                          |
| `migrate` | Runs `prisma migrate deploy` once, then exits. `app` waits for it to succeed        |
| `app`     | The web app (Next.js standalone, non-root user), on `127.0.0.1:${APP_PORT}`         |
| `backup`  | Dumps the database and uploads every `BACKUP_INTERVAL_HOURS` into `BACKUP_HOST_DIR` |

## 3. First-run setup

Open the app. Until step 4 is done that means an SSH tunnel, for example
`ssh -L 3000:127.0.0.1:3000 you@server` and then `http://localhost:3000`. With `APP_ENV=production` over
plain HTTP, the browser will reject the secure cookie, so do setup through HTTPS, or temporarily set
`APP_ENV=development` while you're on localhost.

Setup asks for the business name, your name, email, a password (at least 10 characters; common words such
as "password" are rejected) and the `SETUP_TOKEN`. Once the owner exists, `/setup` is closed for good.

Then go to **Settings**: business details and logo, VAT mode and rate, electricity tariff, labour rates, and
pricing policies.

## 4. HTTPS reverse proxy

The app must not face the internet directly. Put a TLS-terminating proxy in front and keep
`TRUST_PROXY=1` (the compose default). Rate limiting then uses the client address that **your** proxy
appends to `X-Forwarded-For`. Leave only one proxy between the internet and the app, and don't expose
port 3000.

**Caddy** (automatic Let's Encrypt certificates), `/etc/caddy/Caddyfile`:

```caddy
printforge.example.co.il {
    encode zstd gzip
    request_body {
        max_size 110MB   # a little above Settings → max upload size
    }
    reverse_proxy 127.0.0.1:3000
}
```

**nginx** equivalent:

```nginx
server {
    listen 443 ssl http2;
    server_name printforge.example.co.il;
    # ssl_certificate / ssl_certificate_key from certbot
    client_max_body_size 110m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Replace the example domain with yours; the DNS A record must point at the server. HSTS is sent
automatically in production mode.

**No public exposure at all?** Put the server on a private network (for example Tailscale or WireGuard)
and use the proxy with an internal certificate. That's often the simplest safe choice for a one-person
business.

## 5. Updating

```bash
./scripts/backup.sh   # or check that the scheduled backup is recent (Settings → Data)
git pull
docker compose --env-file .env.production up -d --build   # migrate runs before the new app starts
```

Migrations only move forward. If one fails, `app` stays on the old container, and you can see why in
`docker compose logs migrate`. Restore from the backup you just took if you need to roll back
([BACKUP.md](BACKUP.md)).

## Without Docker (bare metal)

Requirements: Node.js 22, PostgreSQL 16, and a process manager (systemd).

```bash
npm ci && npm run build          # build on a machine WITHOUT production .env files; see note
DATABASE_URL=… npm run db:migrate
DATABASE_URL=… APP_ENV=production SETUP_TOKEN=… TRUST_PROXY=1 PORT=3000 HOSTNAME=127.0.0.1 \
  UPLOAD_DIR=/var/lib/printforge/uploads npm run start:standalone
```

> **Note:** Next.js copies `.env*` files found at build time into `.next/standalone`. Build without secret
> files present, or delete `.next/standalone/.env*` before copying the build anywhere. Pass secrets as
> environment variables, for example with a systemd `EnvironmentFile=` readable only by the service user.

Schedule `scripts/backup.sh` with cron ([BACKUP.md](BACKUP.md)).

## Security checklist

- [ ] HTTPS in front, `APP_ENV=production`, port 3000 not reachable from outside
- [ ] Strong `POSTGRES_PASSWORD`. `SETUP_TOKEN` rotated or blanked after setup
- [ ] Backups copied **off the machine** regularly, and a restore tested ([BACKUP.md](BACKUP.md))
- [ ] OS and Docker images updated regularly (`docker compose pull`, rebuild)
- [ ] You know how to recover a password (there is no email reset). The `migrate` image contains the
      tooling, and this was tested:

  ```bash
  docker compose --env-file .env.production run --rm migrate \
    npm run user:reset-password -- you@example.com 'a-new-long-password'
  ```

  Leave the password argument out to have one generated and printed. The reset signs out every session.
