#!/usr/bin/env bash
# Proves backups are restorable: backup DATABASE_URL, restore into a throwaway database,
# compare row counts of every table, then drop the throwaway database.
set -euo pipefail
cd "$(dirname "$0")/.."
PRE_UPLOAD_DIR="${UPLOAD_DIR:-}"
set -a; [ -f .env ] && . ./.env; set +a
UPLOAD_DIR="${PRE_UPLOAD_DIR:-${UPLOAD_DIR:-./storage/uploads}}"
SOURCE="${BACKUP_TEST_SOURCE_URL:-$DATABASE_URL}"
SOURCE="${SOURCE%%\?*}"
BASE="${SOURCE%/*}"
SCRATCH="printforge_restore_test_$(date +%s)"
WORK="$(mktemp -d)"
trap 'psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

echo "1/4 backup $(printf %s "$SOURCE" | sed -E "s#//([^:/@]+):[^@]*@#//\1:***@#")"
DATABASE_URL="$SOURCE" BACKUP_DIR="$WORK" UPLOAD_DIR="$UPLOAD_DIR" sh scripts/backup.sh
DUMP=$(ls "$WORK"/printforge-*.dump)
echo "2/4 create throwaway database $SCRATCH"
psql "$BASE/postgres" -qc "CREATE DATABASE $SCRATCH"
echo "3/4 restore"
TARGET_DATABASE_URL="$BASE/$SCRATCH" UPLOAD_DIR="$WORK/restored/uploads" bash scripts/restore.sh "$DUMP" $(ls "$WORK"/uploads-*.tar.gz 2>/dev/null | head -1) --yes
echo "4/4 compare row counts"
Q="select string_agg(t || '=' || c, ' ' order by t) from (select tablename t, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I', tablename), false, true, '')))[1]::text c from pg_tables where schemaname='public') s"
A=$(psql "$SOURCE" -Atc "$Q")
B=$(psql "$BASE/$SCRATCH" -Atc "$Q")
if [ "$A" != "$B" ]; then
  echo "MISMATCH"; echo "source:   $A"; echo "restored: $B"; exit 1
fi
echo "OK — $(echo "$A" | wc -w) tables restored with identical row counts"
if [ -d "$UPLOAD_DIR" ]; then
  SRC_FILES=$(find "$UPLOAD_DIR" -type f | wc -l)
  DST_FILES=$(find "$WORK/restored" -type f 2>/dev/null | wc -l)
  [ "$SRC_FILES" = "$DST_FILES" ] || { echo "FILE MISMATCH: $SRC_FILES source vs $DST_FILES restored"; exit 1; }
  echo "OK — $SRC_FILES uploaded file(s) restored"
fi
