#!/usr/bin/env bash
# Restores a PrintForge backup. Destructive for the TARGET database: existing objects are replaced.
# Usage: TARGET_DATABASE_URL=postgresql://... scripts/restore.sh <printforge-*.dump> [uploads-*.tar.gz] [--yes]
# Uploads are extracted into UPLOAD_DIR's parent directory (default ./storage).
set -euo pipefail
DUMP="${1:?Usage: scripts/restore.sh <dump> [uploads.tar.gz] [--yes]}"
FILES="${2:-}"
[ "$FILES" = "--yes" ] && FILES=""
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL explicitly (restoring never defaults to DATABASE_URL)}"
DB_URL="${TARGET_DATABASE_URL%%\?*}"
UPLOAD_DIR="${UPLOAD_DIR:-./storage/uploads}"

TABLES=$(psql "$DB_URL" -Atc "select count(*) from pg_tables where schemaname='public'" 2>/dev/null || echo 0)
if [ "$TABLES" != "0" ] && [[ " $* " != *" --yes "* ]]; then
  echo "Target database already has $TABLES tables. Re-run with --yes to replace its contents." >&2
  exit 1
fi
pg_restore --list "$DUMP" > /dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$DB_URL" "$DUMP"
echo "database restored from $DUMP"
if [ -n "$FILES" ]; then
  mkdir -p "$(dirname "$UPLOAD_DIR")"
  tar -xzf "$FILES" -C "$(dirname "$UPLOAD_DIR")"
  echo "uploads restored into $(dirname "$UPLOAD_DIR")"
fi
