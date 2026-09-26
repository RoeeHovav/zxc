#!/bin/sh
# PrintForge backup: PostgreSQL custom-format dump + uploaded files, with retention.
# Env: DATABASE_URL (required), BACKUP_DIR (./backups), UPLOAD_DIR (./storage/uploads), RETENTION_DAYS (30)
set -eu
# pipefail is not POSIX; enable it where the shell supports it (bash, busybox ash, dash >= 0.5.11).
(set -o pipefail) 2>/dev/null && set -o pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
DB_URL="${DATABASE_URL%%\?*}"            # pg_dump does not accept Prisma's ?schema= parameter
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_DIR="${UPLOAD_DIR:-./storage/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

DUMP="$BACKUP_DIR/printforge-$TS.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DB_URL" --file="$DUMP.partial"
# Verify the archive is readable before publishing it.
pg_restore --list "$DUMP.partial" > /dev/null
mv "$DUMP.partial" "$DUMP"
echo "database  -> $DUMP ($(du -h "$DUMP" | cut -f1))"

if [ -d "$UPLOAD_DIR" ]; then
  FILES="$BACKUP_DIR/uploads-$TS.tar.gz"
  tar -czf "$FILES.partial" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  mv "$FILES.partial" "$FILES"
  echo "uploads   -> $FILES ($(du -h "$FILES" | cut -f1))"
else
  echo "uploads   -> skipped ($UPLOAD_DIR does not exist)"
fi

find "$BACKUP_DIR" -maxdepth 1 \( -name 'printforge-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime "+$RETENTION_DAYS" -print -delete | sed 's/^/pruned    -> /'
