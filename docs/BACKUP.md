# Backups and restore

A backup is two files with the same timestamp:

| File                               | Contents                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `printforge-YYYYMMDDTHHMMSSZ.dump` | The whole database (PostgreSQL custom format). `backup.sh` checks it with `pg_restore --list` before publishing it |
| `uploads-YYYYMMDDTHHMMSSZ.tar.gz`  | Every uploaded file (models, photos, PDFs, logo)                                                                   |

Settings → **Data & backups** shows the newest backup and warns when it is more than two days old.

## Automatic backups (Docker Compose)

The `backup` service runs `scripts/backup.sh` every `BACKUP_INTERVAL_HOURS` (default 24), writes into
`BACKUP_HOST_DIR` on the host (default `./backups`), and deletes backups older than
`BACKUP_RETENTION_DAYS` (default 30). The logs print `BACKUP FAILED` when a run fails:

```bash
docker compose --env-file .env.production logs backup | tail
```

**Copy backups off the machine.** A backup on the same disk won't survive disk failure, theft or
ransomware. For example, a nightly cron on another machine:

```bash
rsync -a --delete you@server:/path/to/printforge/backups/ /mnt/nas/printforge-backups/
```

Or copy them to encrypted cloud storage you already use. Keep at least one copy offline. Backups contain
customer personal data, so store them as carefully as the server itself.

## Manual / bare-metal backups

```bash
DATABASE_URL=postgresql://… BACKUP_DIR=/var/backups/printforge UPLOAD_DIR=/var/lib/printforge/uploads \
  sh scripts/backup.sh
```

Requires `pg_dump`/`pg_restore` (PostgreSQL 16 client). Cron example, daily at 02:30:

```cron
30 2 * * * cd /opt/printforge && DATABASE_URL=… BACKUP_DIR=/var/backups/printforge sh scripts/backup.sh >> /var/log/printforge-backup.log 2>&1
```

## Restore: Docker Compose

Steps 1–4 were run end to end against the Compose stack (data deleted, restored, app healthy, login
working). Replace the timestamps with the backup you want.

```bash
E="--env-file .env.production"
D=printforge-20260101T020000Z.dump
U=uploads-20260101T020000Z.tar.gz

# 0. Take a backup of the current state first, in case you need to undo:
docker compose $E exec -T db pg_dump -Fc -U printforge printforge > backups/before-restore.dump

# 1. Stop the app and the backup job
docker compose $E stop app backup

# 2. Database (replaces all tables in the printforge database)
docker compose $E exec -T db pg_restore --clean --if-exists --no-owner --no-privileges \
  --exit-on-error -U printforge -d printforge < backups/$D

# 3. Uploaded files (replaces the uploads volume contents)
docker compose $E run --rm --no-deps --entrypoint sh app \
  -c "find /data/uploads -mindepth 1 -delete && tar -xzf /backups/$U -C /data"

# 4. Start again
docker compose $E start app backup
```

Restoring an **older** backup into a **newer** app version is fine: the next `docker compose up` runs any
missing migrations. Restoring a backup from a _newer_ version into an older app isn't supported.

## Restore: bare metal / another server

`scripts/restore.sh` never guesses the target. You name it explicitly, and it refuses to overwrite a
database that already has tables unless you pass `--yes`:

```bash
TARGET_DATABASE_URL=postgresql://printforge:…@localhost:5432/printforge \
UPLOAD_DIR=/var/lib/printforge/uploads \
  bash scripts/restore.sh printforge-….dump uploads-….tar.gz --yes
```

The uploads archive holds a folder named after the original upload folder (`uploads/`), and it is
extracted into `UPLOAD_DIR`'s parent, so keep the last path component `uploads`.

## Proving that backups restore

```bash
npm run test:backup
```

This backs up `DATABASE_URL` (or `BACKUP_TEST_SOURCE_URL`), restores it into a temporary database,
compares the row count of every table, compares the number of uploaded files, and then drops the
temporary database. Last run: 31 tables restored with identical row counts. Run it after upgrades, and
occasionally restore a real backup onto a spare machine and click through it.

## What is not in a backup

- `.env.production` (your secrets): keep a copy in your password manager.
- The Docker images: they are rebuilt from the code.
